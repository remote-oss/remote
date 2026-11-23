import {deepStrictEqual} from 'node:assert';
import {
  multiDistroAllowed,
  pathTranslationAvailable,
  shareHostFor,
  windowsBuildFromRelease,
} from '../../src/index.ts';

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

describe('the path translation and the share host of a build', () => {
  it('F-6204 7.E3: the path translation is available from build 17063 and when the build is not known', () => {
    deepStrictEqual(
      [
        pathTranslationAvailable(17062),
        pathTranslationAvailable(17063),
        pathTranslationAvailable(undefined),
      ],
      [false, true, true],
    );
  });

  it('F-6203 (reading-2348-share-host): the share host is wsl.localhost from build 21354 and when the build is not known, else wsl$', () => {
    deepStrictEqual(
      [shareHostFor(21353), shareHostFor(21354), shareHostFor(undefined)],
      ['wsl$', 'wsl.localhost', 'wsl.localhost'],
    );
  });
});
