import {deepStrictEqual} from 'node:assert';
import {cacheVolumeOf} from '../../src/lifecycle/cache-volume.ts';

describe('the vscode volume cache, from the user\u2019s settings', () => {
  it('F-0419 3.2: unset is true', () => {
    deepStrictEqual(cacheVolumeOf(undefined, undefined), true);
  });

  it('F-0419 AC-3: false is false', () => {
    deepStrictEqual(cacheVolumeOf(false, undefined), false);
  });

  it('F-0419 AC-10: the deprecated key when the current one is unset, per BR-8', () => {
    deepStrictEqual(cacheVolumeOf(undefined, false), false);
  });

  it('F-0419 BR-8: the current key wins over the deprecated one', () => {
    deepStrictEqual(cacheVolumeOf(true, false), true);
  });

  it('contracts: a non-boolean counts as unset', () => {
    deepStrictEqual(cacheVolumeOf('false', undefined), true);
  });
});
