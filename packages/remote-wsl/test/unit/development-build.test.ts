import {deepStrictEqual} from 'node:assert';
import {refusesDevelopmentBuild} from '../../src/activation/development-build.ts';

describe('the development-build guard (wsl.package)', () => {
  it('refuses an editor without a commit, and accepts one with a commit', () => {
    deepStrictEqual(
      [
        refusesDevelopmentBuild(undefined),
        refusesDevelopmentBuild(''),
        refusesDevelopmentBuild('bed945dd42ba59f994a249b12be656908e2c0ea1'),
      ],
      [true, true, false],
    );
  });
});
