import {deepStrictEqual} from 'node:assert';
import type {AppendedEntry} from '../../../tools/script-file.ts';
import {
  appendScript,
  closeWindow,
  connectedWithin,
  openWindow,
  recordLines,
  signal,
  waitFor,
} from '../windows/harness.ts';
import {INSTALL_MILLISECONDS} from '../windows/maintenance.ts';
import {answerDialog, waitForDialog} from '../windows/renderer.ts';

/** The dialog of a connect that waited for the trust question for the whole connect timeout. */
const TIMED_OUT = 'Connecting with SSH timed out.';

describe('the connect of an untrusted folder in terminal mode (card coverage-98)', function () {
  this.timeout(300_000);

  it('F-2101 AC-29 (tw29): with the trust dialog left unanswered the attempt fails after the connect timeout, and after Trust Folder & Continue and Retry the window connects', async () => {
    const window = 'tw29';
    appendScript([
      {
        surface: 'failureDialog',
        match: 'Could not establish connection',
        answer: {button: 'Retry'},
        window,
        after: 'tw29-retry',
      },
    ] satisfies AppendedEntry[]);
    await openWindow('harness', window);
    await waitForDialog(window);
    const asked = Date.now();
    await waitFor(
      'the timeout dialog, held',
      () => recordLines('failureDialog', window).length > 0,
      120_000,
    );
    const seconds = (Date.now() - asked) / 1000;
    const timedOut = recordLines('failureDialog', window)[0]?.question;
    await answerDialog(window, 'Trust Folder & Continue');
    signal('tw29-retry');
    await connectedWithin(window, INSTALL_MILLISECONDS);
    deepStrictEqual(
      [timedOut, seconds >= 9 && seconds <= 16],
      [`Could not establish connection to "harness": ${TIMED_OUT}`, true],
    );
    await closeWindow(window);
  });
});
