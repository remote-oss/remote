import {deepStrictEqual} from 'node:assert';
import type {AppendedEntry} from '../../../tools/script-file.ts';
import {
  appendScript,
  connectedWithin,
  isTrusted,
  openWindow,
  recordLines,
  signal,
  waitFor,
} from '../windows/harness.ts';
import {INSTALL_MILLISECONDS, setting} from '../windows/maintenance.ts';
import {answerDialog, waitForDialog} from '../windows/renderer.ts';

/** The buttons of core's trust request, in the order the page holds them (measured on the run's build). */
const REQUEST_BUTTONS = ['Manage', 'Cancel', 'Trust Folder & Continue'];

describe('the trust launch with core’s defaults (card tooling-33)', function () {
  this.timeout(300000);

  it('tooling-33: with core’s defaults a folder opens untrusted, with no question until the terminal-mode connect asks for trust', async () => {
    await openWindow('harness', 's3');
    const shown = await waitForDialog('s3');
    const progress = recordLines('progress', 's3').map(line => line.question);
    deepStrictEqual(
      [
        await isTrusted('s3'),
        shown.message,
        shown.buttons,
        progress.includes('Setting up SSH Host harness'),
        progress.includes('Setting up SSH tunnel'),
      ],
      [
        false,
        'Do you trust the authors of the files in this folder?',
        REQUEST_BUTTONS,
        true,
        false,
      ],
    );
  });

  it('F-2704 AC-21 (trust-retry): in the terminal mode with the trust question left open the connect times out and waits, and after the folder is trusted Retry asks for the platform again and connects', async () => {
    const window = 'tt21';
    await setting('remote.SSH.connectTimeout', 10);
    try {
      appendScript([
        {surface: 'platformPick', match: 'platform', answer: 'linux', window},
        {
          surface: 'failureDialog',
          match: 'Could not establish connection',
          answer: {button: 'Retry'},
          window,
          after: 'tt21-retry',
        },
        {surface: 'platformPick', match: 'platform', answer: 'linux', window},
      ] satisfies AppendedEntry[]);
      await openWindow('harness-bash', window);
      await waitFor(
        'the timeout dialog, held',
        () => recordLines('failureDialog', window).length > 0,
        120_000,
      );
      const timedOut = recordLines('failureDialog', window)[0]?.question;
      await answerDialog(window, 'Trust Folder & Continue');
      signal('tt21-retry');
      await waitFor(
        'the platform pick again',
        () => recordLines('platformPick', window).length >= 2,
        120_000,
      );
      await connectedWithin(window, INSTALL_MILLISECONDS);
      deepStrictEqual(
        timedOut?.startsWith('Could not establish connection'),
        true,
      );
    } finally {
      await setting('remote.SSH.connectTimeout', undefined);
    }
  });
});
