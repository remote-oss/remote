import {deepStrictEqual} from 'node:assert';
import {
  mountGitWorktreeCommonDirOf,
  workspaceMountConsistencyOf,
} from '../../src/connect/mount-settings.ts';

describe('the workspace mount settings, from the user\u2019s settings (card containers-28)', () => {
  it('F-0411 BR-7: the current key wins over the deprecated one', () => {
    deepStrictEqual(
      workspaceMountConsistencyOf('consistent', 'delegated'),
      'consistent',
    );
  });

  it('F-0411 BR-7: the deprecated key counts when the current one is unset', () => {
    deepStrictEqual(
      workspaceMountConsistencyOf(undefined, 'delegated'),
      'delegated',
    );
  });

  it('F-0411 3.2: neither key set is cached', () => {
    deepStrictEqual(
      workspaceMountConsistencyOf(undefined, undefined),
      'cached',
    );
  });

  it('F-0411 7.E5: a string outside the enum goes as written, not as the default', () => {
    deepStrictEqual(workspaceMountConsistencyOf('fast', 'delegated'), 'fast');
  });

  it('F-0411 BR-7: a value that is not a string counts as unset, for the current key and for the deprecated one', () => {
    deepStrictEqual(
      [
        workspaceMountConsistencyOf(7, 'delegated'),
        workspaceMountConsistencyOf(undefined, false),
        workspaceMountConsistencyOf(null, null),
      ],
      ['delegated', 'cached', 'cached'],
    );
  });

  it('F-0411 AC-37: the boolean true and the string "true" mount the common dir', () => {
    deepStrictEqual([true, 'true'].map(mountGitWorktreeCommonDirOf), [
      true,
      true,
    ]);
  });

  it('F-0411 3.2: false, "false", an unset value and a number do not', () => {
    deepStrictEqual(
      [false, 'false', undefined, 1].map(mountGitWorktreeCommonDirOf),
      [false, false, false, false],
    );
  });
});
