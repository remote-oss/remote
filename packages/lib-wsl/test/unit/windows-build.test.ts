import {deepStrictEqual} from 'node:assert';
import {multiDistroAllowed, windowsBuildFromRelease} from '../../src/index.ts';

describe('the Windows build', () => {
  it('F-6103.BR-1: the third part of the release is the build', () => {
    deepStrictEqual(
      [
        windowsBuildFromRelease('10.0.17763'),
        windowsBuildFromRelease('10.0.22631'),
      ],
      [17763, 22631],
    );
  });

  it('F-6103.BR-1: a fourth part is ignored', () => {
    deepStrictEqual(windowsBuildFromRelease('10.0.26200.1'), 26200);
  });

  for (const release of ['10.0', '', '10.0.abc', '10.0.', '10.0.19045-ge']) {
    it(`F-6103 7.E3: ${JSON.stringify(release)} gives no build`, () => {
      deepStrictEqual(windowsBuildFromRelease(release), undefined);
    });
  }

  it('F-6103.BR-1: several distros are allowed from build 18362', () => {
    deepStrictEqual(
      [multiDistroAllowed(18362), multiDistroAllowed(26200)],
      [true, true],
    );
  });

  it('F-6103.BR-1: several distros are not allowed below build 18362', () => {
    deepStrictEqual(
      [multiDistroAllowed(18361), multiDistroAllowed(17763)],
      [false, false],
    );
  });

  it('F-6103 7.E3: an unknown build allows several distros', () => {
    deepStrictEqual(multiDistroAllowed(undefined), true);
  });
});
