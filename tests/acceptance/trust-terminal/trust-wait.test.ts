import {deepStrictEqual} from 'node:assert';
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import type {AppendedEntry} from '../../../tools/script-file.ts';
import {
  appendScript,
  closeWindow,
  connectedWithin,
  openWindow,
  readUserSettings,
  recordLines,
  restoreUserSettings,
  signal,
  userSettings,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {INSTALL_MILLISECONDS} from '../windows/maintenance.ts';
import {answerDialog, waitForDialog} from '../windows/renderer.ts';

/** The dialog of a connect that waited for the trust question for the whole connect timeout. */
const TIMED_OUT = 'Connecting with SSH timed out.';

/** The `Host harness` block of the run's ssh_config under the alias `cfghost`, with the keyword `ssh` rejects. */
function rejectedBlock(): string {
  const lines = readFileSync(variable('HARNESS_SSH_CONFIG'), 'utf8').split(
    '\n',
  );
  const start = lines.indexOf('Host harness');
  const end = lines.indexOf('', start);
  return `${['Host cfghost', '  Bogus yes', ...lines.slice(start + 1, end)].join('\n')}\n`;
}

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

  it('F-2201 AC-27 (tw27): with a file ssh rejects, the trust dialog left open fails the attempt with the timed-out detail, and the prompts answered at once fail it with the rejected-keyword dialog', async () => {
    const saved = readUserSettings();
    const file = path.join(variable('HARNESS_RUN_FOLDER'), 'cfg-rejected');
    writeFileSync(file, rejectedBlock());
    await userSettings({
      'remote.SSH.configFile': file,
      'remote.SSH.remotePlatform': {cfghost: 'linux'},
      'remote.SSH.connectTimeout': 10,
    });
    try {
      appendScript([
        {
          surface: 'failureDialog',
          match: 'Could not establish connection',
          answer: 'dismiss',
          window: 'tw27a',
        },
        {
          surface: 'failureDialog',
          match: 'Could not establish connection',
          answer: 'dismiss',
          window: 'tw27b',
        },
        {
          surface: 'mitigationPick',
          match: 'Pick an action',
          answer: 'dismiss',
          window: 'tw27b',
        },
      ] satisfies AppendedEntry[]);
      await openWindow('cfghost', 'tw27a');
      await waitForDialog('tw27a');
      const asked = Date.now();
      await waitFor(
        'the timeout dialog of the left-open window',
        () => recordLines('failureDialog', 'tw27a').length > 0,
        120_000,
      );
      const seconds = (Date.now() - asked) / 1000;
      const left = recordLines('failureDialog', 'tw27a')[0]?.question;
      await closeWindow('tw27a');
      await openWindow('cfghost', 'tw27b');
      await waitForDialog('tw27b');
      await answerDialog('tw27b', 'Trust Folder & Continue');
      await waitFor(
        'the dialog of the window answered at once',
        () => recordLines('failureDialog', 'tw27b').length > 0,
        120_000,
      );
      const answered = recordLines('failureDialog', 'tw27b')[0]?.question;
      await closeWindow('tw27b');
      deepStrictEqual(
        [left, seconds >= 9 && seconds <= 16, answered],
        [
          `Could not establish connection to "cfghost": ${TIMED_OUT}`,
          true,
          'Could not establish connection to "cfghost".',
        ],
      );
    } finally {
      restoreUserSettings(saved);
    }
  });
});
