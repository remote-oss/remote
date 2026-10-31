import {deepStrictEqual} from 'node:assert';
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
  featureBuilds,
  lockfileOf,
  metadataOf,
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

// The rows of this file pull their Features from ghcr.io, so they are the only rows of the suite that need the network
// at row time. The Features install with apt, so the image is the run's glibc one.
describe('the legacy words and the Features of ghcr.io (card containers-93)', function () {
  this.timeout(2_400_000);
  const {build} = featureBuilds();

  for (const word of ['maven', 'gradle']) {
    it(`F-0414 AC-35 (legacy-${word}): "${word}" warns that the legacy feature is deprecated, and the metadata and the lockfile name the java Feature, never the word`, async () => {
      const mark = containersLog().length;
      const built = await build(`c93-ac35-${word}`, {
        image: GLIBC_IMAGE,
        features: {[word]: {}},
      });
      deepStrictEqual(
        [
          containersLogSince(mark).some(line => /deprecated/i.test(line)),
          idsOf(await metadataOf(built.containerId)),
          Object.keys(lockfileOf(built.folder)?.features ?? {}),
        ],
        [true, [JAVA], [JAVA]],
      );
    });
  }

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
        image: GLIBC_IMAGE,
        // Node 26, the Feature's default, needs libatomic, which this image lacks.
        features: {[NODE]: {version: '20'}, './local': {}},
        overrideFeatureInstallOrder: [NODE],
      },
      folder => {
        writeLocalFeature(folder, 'local');
      },
    );
    deepStrictEqual(idsOf(await metadataOf(built.containerId)), [
      NODE,
      './local',
    ]);
  });
});
