import {deepStrictEqual} from 'node:assert';
import {
  corruptArchiveLines,
  corruptArchiveName,
} from '../tests/acceptance/windows/corrupt-archive.ts';

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

  it('#2675: a verdict that SDKMAN recovered from, followed by another failure, gives nothing', () => {
    deepStrictEqual(
      corruptArchiveLines([
        '#14 64.43 Downloading: maven 3.10.1',
        '#14 64.59 Stop! The archive was corrupt and has been removed! Please try installing again.',
        '#14 70.10 Downloading: maven 3.10.1',
        '#14 80.00 ERROR: Feature "Java (via SDKMAN!)" failed to install!',
      ]),
      [],
    );
  });

  it('#2675: an empty log gives nothing', () => {
    deepStrictEqual(corruptArchiveLines([]), []);
  });

  it('#2675: the fault is named for the reader of the red, with the candidate, its version and SDKMAN’s verdict', () => {
    deepStrictEqual(
      corruptArchiveName([
        '#14 64.43 Downloading: maven 3.10.1  ',
        '#14 64.59 Stop! The archive was corrupt and has been removed! Please try installing again.',
        '#14 64.95 (!) Installing maven  via SDKMAN failed after 5 attempts.',
      ]),
      'SDKMAN served a corrupt maven 3.10.1 archive (Stop! The archive was corrupt and has been removed!)',
    );
  });

  it('#2675: a log without the corrupt archive has no name', () => {
    deepStrictEqual(
      corruptArchiveName(['#14 64.43 Downloading: maven 3.10.1']),
      undefined,
    );
  });
});
