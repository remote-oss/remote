import {deepStrictEqual} from 'node:assert';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';
import {
  closeWindow,
  containersLog,
  containersLogSince,
  devContainerFolder,
  devContainersOf,
  GLIBC_IMAGE,
  reopenStarted,
} from '../windows/harness.ts';
import {primaryButtonOf, waitForDialog} from '../windows/renderer.ts';
import {
  type Built,
  featureBuilds,
  lockfileOf,
  metadataOf,
  textInContainer,
  writeLocalFeature,
} from './features-support.ts';

const JAVA = 'ghcr.io/devcontainers/features/java:1';
const NODE = 'ghcr.io/devcontainers/features/node:1';
const PYTHON = 'ghcr.io/devcontainers/features/python:1';

/** The ids of the Feature entries of the metadata, in order. */
function idsOf(entries: ReadonlyArray<Record<string, unknown>>): unknown[] {
  return entries
    .filter(entry => typeof entry.id === 'string')
    .map(entry => entry.id);
}

/**
 * Where the stub `mvn` of the legacy-maven row writes what it is asked. The java Feature runs `mvn --version` only when
 * its `installMaven` option is true, and installs maven from SDKMAN (a third-party download that is not what AC-35 asks
 * of the row) only when that fails, so a `mvn` that answers and writes down the asking skips the download and shows the
 * option arrived.
 */
const MAVEN_ASKED_FILE = '/usr/local/share/mvn-asked';

/**
 * A row's own image, for a row whose Feature would otherwise reach a third-party host that is not what the row asks of
 * it: the run's glibc image with the shell `steps` run in it, the configuration that builds it, and the `prepare` that
 * writes its Dockerfile.
 */
function stubbedImage(...steps: string[]): {
  configuration: Readonly<Record<string, unknown>>;
  prepare: (folder: string) => void;
} {
  return {
    configuration: {image: undefined, build: {dockerfile: 'Dockerfile'}},
    prepare: (folder: string): void => {
      writeFileSync(
        path.join(folder, '.devcontainer', 'Dockerfile'),
        [`FROM ${GLIBC_IMAGE}`, ...steps.map(step => `RUN ${step}`), ''].join(
          '\n',
        ),
      );
    },
  };
}

/** The legacy-maven row's image: the run's glibc one with that `mvn`. */
const MAVEN_STUB = stubbedImage(
  `printf '#!/bin/sh\\necho "$@" >> ${MAVEN_ASKED_FILE}\\nexit 0\\n' > /usr/local/bin/mvn && chmod 755 /usr/local/bin/mvn`,
);

/**
 * The node-first row's image (card #3267): the run's glibc one with the folder the node Feature finds nvm installed in,
 * so that it fetches nvm from no host. The Feature then needs its three options at `none` (NODE_OFFLINE), which stop
 * its `git ls-remote` of nvm's tags, its `nvm install` and its pnpm and yarn steps. The stub depends on the Feature's
 * install script (`:1` floats to the newest 1.x): a release that changes it fails the row at its build, with the cause
 * named (connectedUnlessBuildFailed), and does not pass it.
 */
const NVM_STUB = stubbedImage(
  `mkdir -p /usr/local/share/nvm && printf 'nvm() { :; }\\n' > /usr/local/share/nvm/nvm.sh`,
);

/** The node Feature's options that keep it from installing node, and so from reaching github.com, nodejs.org and npm. */
const NODE_OFFLINE = {version: 'none', nvmVersion: 'none', pnpmVersion: 'none'};

// The rows of this file pull their Features from ghcr.io, so they are the only rows of the suite that need the network
// at row time. The Features install with apt, so the image is the run's glibc one.
describe('the legacy words and the Features of ghcr.io (card containers-93)', function () {
  this.timeout(2_400_000);
  const {build, buildAgainOnCorruptArchive} = featureBuilds();

  /**
   * Builds a folder whose only Feature is the legacy `word`, and gives what the log, the metadata and the lockfile say.
   * With `config`, the folder is built from its own Dockerfile and its `prepare` (see stubbedImage).
   */
  async function legacyJava(
    word: string,
    config: {
      configuration?: Readonly<Record<string, unknown>>;
      prepare?: (folder: string) => void;
    } = {},
  ): Promise<{built: Built & {mark: number}; facts: unknown[]}> {
    // The warning is read from the log of the build that connected, and not from an earlier one that came back corrupt.
    const built = await buildAgainOnCorruptArchive(
      `c93-ac35-${word}`,
      {
        image: GLIBC_IMAGE,
        features: {[word]: {}},
        ...config.configuration,
      },
      config.prepare,
    );
    return {
      built,
      facts: [
        containersLogSince(built.mark).some(line => /deprecated/i.test(line)),
        idsOf(await metadataOf(built.containerId)),
        Object.keys(lockfileOf(built.folder)?.features ?? {}),
      ],
    };
  }

  it('F-0414 AC-35 (legacy-maven): "maven" warns that the legacy feature is deprecated, and the metadata and the lockfile name the java Feature, never the word, and the Feature is asked to install maven', async () => {
    const {built, facts} = await legacyJava('maven', MAVEN_STUB);
    deepStrictEqual(
      [
        ...facts,
        await textInContainer(built.containerId, MAVEN_ASKED_FILE),
        containersLogSince(built.mark).some(line =>
          line.includes('Downloading: maven'),
        ),
      ],
      [true, [JAVA], [JAVA], '--version\n', false],
    );
  });

  it('F-0414 AC-35 (legacy-gradle): "gradle" warns that the legacy feature is deprecated, and the metadata and the lockfile name the java Feature, never the word', async () => {
    deepStrictEqual((await legacyJava('gradle')).facts, [true, [JAVA], [JAVA]]);
  });

  it('F-0414 AC-35 (legacy-jupyterlab): "jupyterlab" is the python Feature, whose own install script fails on this image as 7.E16 says, with the generic dialog and the python Feature named in the log', async () => {
    const folder = devContainerFolder('c93-ac35-jupyterlab', {
      image: GLIBC_IMAGE,
      features: {jupyterlab: {}},
    });
    const mark = containersLog().length;
    const name = await openFolderWindow(folder);
    try {
      await reopenStarted(name);
      const dialog = await waitForDialog(name, 600_000);
      const lines = containersLogSince(mark);
      deepStrictEqual(
        {
          saying: [dialog.message, dialog.details, [...dialog.buttons]],
          primary: await primaryButtonOf(name),
          warned: lines.some(line => /deprecated 'jupyterlab'/i.test(line)),
          resolved: lines.some(line => line.includes(`'${PYTHON}'`)),
          failed: lines.some(line =>
            line.includes(
              '(ghcr.io/devcontainers/features/python) failed to install',
            ),
          ),
          containers: await devContainersOf(folder),
        },
        {
          saying: [
            '',
            'An error occurred setting up the container.',
            ['Edit devcontainer.json Locally', 'More Actions...', 'Retry'],
          ],
          primary: 'Retry',
          warned: true,
          resolved: true,
          failed: true,
          containers: [],
        },
      );
    } finally {
      await closeWindow(name);
      await removeContainers(folder);
    }
  });

  it('F-0414 AC-41 (node-first): overrideFeatureInstallOrder naming the node Feature installs it before the local Features', async () => {
    const built = await build(
      'c93-ac41',
      {
        ...NVM_STUB.configuration,
        // The row asks for the order of the Features, not for node: NODE_OFFLINE keeps the Feature from fetching it.
        features: {'./local': {}, [NODE]: NODE_OFFLINE},
        overrideFeatureInstallOrder: [NODE],
      },
      folder => {
        NVM_STUB.prepare(folder);
        writeLocalFeature(folder, 'local');
      },
    );
    deepStrictEqual(idsOf(await metadataOf(built.containerId)), [
      NODE,
      './local',
    ]);
  });
});
