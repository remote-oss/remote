import {deepStrictEqual} from 'node:assert';
import {s045EventOf} from '../../src/cli-control/progress.ts';

describe('the install progress from the CLI serverlog lines', () => {
  it('F-2103 5.0 step 6: the download line shows the progress', () => {
    deepStrictEqual(
      s045EventOf({
        text: 'Downloading VSCodium server -> /tmp/.tmpIropcf/68280b82',
        level: 2,
      }),
      {kind: 'show'},
    );
  });

  it('F-2103 5.0 step 6: a download line of another product shows the progress', () => {
    deepStrictEqual(
      s045EventOf({text: 'Downloading Code server -> /tmp/x', level: 2}),
      {kind: 'show'},
    );
  });

  it('F-2103 5.0 step 6: a download progress line gives its percentage', () => {
    deepStrictEqual(
      s045EventOf({
        text: 'server download progress: 2103263/88469322 (2%)',
        level: 0,
      }),
      {kind: 'percent', value: 2},
    );
  });

  it('F-2103 5.0 step 6: the last download progress line gives 100', () => {
    deepStrictEqual(
      s045EventOf({
        text: 'server download progress: 88469322/88469322 (100%)',
        level: 0,
      }),
      {kind: 'percent', value: 100},
    );
  });

  it('cli DownloadLogger: a download progress line with no total changes nothing', () => {
    deepStrictEqual(
      s045EventOf({text: 'server download progress: 512/0', level: 0}),
      undefined,
    );
  });

  it('cli DownloadLogger: a download progress line with a percentage but no closing bracket changes nothing', () => {
    deepStrictEqual(
      s045EventOf({text: 'server download progress: 5/10 (50%', level: 0}),
      undefined,
    );
  });

  it('F-2103 5.0 step 7: an inflate line holds the progress', () => {
    deepStrictEqual(
      s045EventOf({text: 'server inflate progress: 180/3581 (5%)', level: 0}),
      {kind: 'hold'},
    );
  });

  it('F-2103 5.0 step 7: the integrity line holds the progress', () => {
    deepStrictEqual(
      s045EventOf({
        text: 'Server integrity verified, version: 1.140.06729-insider / b9695 / arm64 / ',
        level: 0,
      }),
      {kind: 'hold'},
    );
  });

  it('F-2103 5.0 step 7: the setup line holds the progress', () => {
    deepStrictEqual(s045EventOf({text: 'Server setup complete', level: 1}), {
      kind: 'hold',
    });
  });

  it('F-2103 5.0 step 7: the start line holds the progress', () => {
    deepStrictEqual(s045EventOf({text: 'Starting server...', level: 2}), {
      kind: 'hold',
    });
  });

  it('V7a: the check line changes nothing', () => {
    deepStrictEqual(
      s045EventOf({
        text: 'Checking /home/harness/.vscodium-server/data/servers/Insiders-b9695/log.txt and /pid.txt for a running server...',
        level: 2,
      }),
      undefined,
    );
  });

  it('V7a: the listening line changes nothing', () => {
    deepStrictEqual(
      s045EventOf({
        text: 'Extension host agent listening on /tmp/codium-insiders-1234',
        level: 0,
      }),
      undefined,
    );
  });

  it('V7a: a line that only starts like the download line changes nothing', () => {
    deepStrictEqual(
      s045EventOf({text: 'Downloading VSCodium server', level: 2}),
      undefined,
    );
  });
});
