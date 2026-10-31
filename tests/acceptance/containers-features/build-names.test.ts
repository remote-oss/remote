import {deepStrictEqual} from 'node:assert';
import {setUserSetting} from '../windows/folder-windows.ts';
import {
  environmentOf,
  featureBuilds,
  lockfileOf,
  metadataOf,
  runFeature,
} from './features-support.ts';

/** The ids of the Feature entries of the metadata, in order. */
function idsOf(entries: ReadonlyArray<Record<string, unknown>>): unknown[] {
  return entries
    .filter(entry => typeof entry.id === 'string')
    .map(entry => entry.id);
}

describe('how a build names its Features (card containers-93)', function () {
  this.timeout(1_800_000);
  const {build, reopen} = featureBuilds();

  it('F-0414 AC-28 (ruling-case-merge): a Feature named in features in mixed case and in defaultFeatures in lower case, with two values of one option, is installed once, with one lockfile entry under the mixed-case key', async () => {
    const mixed = runFeature('lab-options').replace(
      'remote-oss-run/features/lab-options',
      'Remote-OSS-Run/Features/Lab-Options',
    );
    await setUserSetting('dev.containers.defaultFeatures', {
      [runFeature('lab-options')]: {level: 'low'},
    });
    try {
      const built = await build('c93-ac28', {
        features: {[mixed]: {level: 'high'}},
      });
      deepStrictEqual(
        [
          idsOf(await metadataOf(built.containerId)),
          Object.keys(lockfileOf(built.folder)?.features ?? {}),
          (await environmentOf(built.containerId, 'lab-options')).LEVEL,
        ],
        [[mixed], [mixed], 'high'],
      );
    } finally {
      await setUserSetting('dev.containers.defaultFeatures', undefined);
    }
  });

  it('F-0414 AC-46 (default-everywhere): a defaultFeatures Feature is installed by two folders’ builds and by a rebuild of one', async () => {
    await setUserSetting('dev.containers.defaultFeatures', {
      [runFeature('lab-plain')]: {},
    });
    try {
      const first = await build('c93-ac46a', {});
      const second = await build('c93-ac46b', {});
      async function installed(containerId: string): Promise<boolean> {
        return (
          Object.keys(await environmentOf(containerId, 'lab-plain')).length > 0
        );
      }
      const before = await installed(first.containerId);
      const rebuilt = await reopen(first, true);
      deepStrictEqual(
        [
          before,
          await installed(second.containerId),
          await installed(rebuilt.containerId),
        ],
        [true, true, true],
      );
    } finally {
      await setUserSetting('dev.containers.defaultFeatures', undefined);
    }
  });
});
