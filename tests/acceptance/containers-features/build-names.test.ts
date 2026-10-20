import {deepStrictEqual} from 'node:assert';
import {setUserSetting} from '../windows/folder-windows.ts';
import {environmentOf, featureBuilds, runFeature} from './features-support.ts';

describe('how a build names its Features (card containers-93)', function () {
  this.timeout(1_800_000);
  const {build, reopen} = featureBuilds();

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
