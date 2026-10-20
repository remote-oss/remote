import {deepStrictEqual} from 'node:assert';
import {setUserSetting} from '../windows/folder-windows.ts';
import {
  environmentOf,
  featureBuilds,
  lockfileOf,
  runFeature,
} from './features-support.ts';

describe('how a build names its Features (card containers-93)', function () {
  this.timeout(1_800_000);
  const {build, reopen} = featureBuilds();

  it('F-0414 AC-28 (mixed-case-twice): a Feature named in features in mixed case and in defaultFeatures in lower case is installed once, keyed by the mixed-case string', async () => {
    const mixed = runFeature('lab-plain').replace(
      'remote-oss-run/features/lab-plain',
      'Remote-OSS-Run/Features/Lab-Plain',
    );
    await setUserSetting('dev.containers.defaultFeatures', {
      [runFeature('lab-plain')]: {},
    });
    try {
      const built = await build('c93-ac28', {features: {[mixed]: {}}});
      deepStrictEqual(
        [
          Object.keys(lockfileOf(built.folder)?.features ?? {}),
          Object.keys(await environmentOf(built.containerId, 'lab-plain'))
            .length > 0,
        ],
        [[mixed], true],
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
