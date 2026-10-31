import {deepStrictEqual} from 'node:assert';
import {
  containersLog,
  containersLogSince,
  GLIBC_IMAGE,
} from '../windows/harness.ts';
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

  it('F-0414 AC-35 (legacy-jupyterlab): "jupyterlab" installs the python Feature with its JupyterLab option', async () => {
    const built = await build('c93-ac35-jupyterlab', {
      image: GLIBC_IMAGE,
      features: {jupyterlab: {}},
    });
    deepStrictEqual(
      [
        idsOf(await metadataOf(built.containerId)),
        Object.keys(lockfileOf(built.folder)?.features ?? {}),
      ],
      [[PYTHON], [PYTHON]],
    );
  });

  it('F-0414 AC-41 (node-first): overrideFeatureInstallOrder naming the node Feature installs it before the local Features', async () => {
    const built = await build(
      'c93-ac41',
      {
        image: GLIBC_IMAGE,
        features: {[NODE]: {}, './local': {}},
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
