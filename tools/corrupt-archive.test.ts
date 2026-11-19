import {deepStrictEqual} from 'node:assert';
import {corruptArchiveLines} from '../tests/acceptance/windows/corrupt-archive.ts';

describe('the corrupt archive of a Feature download (card #2675)', () => {
  it('#2675: a log with SDKMAN’s verdict gives the download, the verdict and the attempts, trimmed', () => {
    deepStrictEqual(
      corruptArchiveLines([
        '#14 60.01 Installing java',
        '#14 64.43 Downloading: maven 3.10.1  ',
        '#14 64.59 Stop! The archive was corrupt and has been removed! Please try installing again.',
        '#14 64.95 (!) Installing maven  via SDKMAN failed after 5 attempts.',
      ]),
      [
        '#14 64.43 Downloading: maven 3.10.1',
        '#14 64.59 Stop! The archive was corrupt and has been removed! Please try installing again.',
        '#14 64.95 (!) Installing maven  via SDKMAN failed after 5 attempts.',
      ],
    );
  });

  it('#2675: a failed build without the verdict gives nothing, even with a download in it', () => {
    deepStrictEqual(
      corruptArchiveLines([
        '#14 64.43 Downloading: maven 3.10.1',
        '#14 64.95 ERROR: Feature "Java (via SDKMAN!)" failed to install!',
      ]),
      [],
    );
  });

  it('#2675: an empty log gives nothing', () => {
    deepStrictEqual(corruptArchiveLines([]), []);
  });
});
