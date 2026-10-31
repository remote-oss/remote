import {deepStrictEqual} from 'node:assert';
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import type {AppendedEntry} from '../../../tools/script-file.ts';
import {
  appendScript,
  closeWindow,
  connectionLog,
  emptyWindows,
  onHostAs,
  openWindow,
  recordLines,
  variable,
  waitFor,
  windowEvents,
  windowState,
} from '../windows/harness.ts';
import {dismissals, setting} from '../windows/maintenance.ts';
import {
  failedOn,
  removeHomeFiles,
  freshServer,
  surfaceLines,
  taskEnvironment,
  withWindow,
  writeHomeFile,
} from './shell-support.ts';

/** The dialog of a connect that timed out, as the window shows it. */
const TIMED_OUT =
  'Could not establish connection to "harness-bash": Connecting with SSH timed out.';

/** The buttons of the failure dialog, in the order the editor lists them. */
const BUTTONS = ['Close Remote', 'Retry', 'More Actions...'];

/** The log lines written since `mark` lines of it were there. */
function logSince(mark: number): string[] {
  return connectionLog().slice(mark);
}

describe('login shells that do not finish or end early: the connect fails or waits as the timeout says (F-2704)', function () {
  this.timeout(900_000);

  afterEach(async () => {
    await setting('remote.SSH.connectTimeout', undefined);
    await removeHomeFiles('harness-bash', '.bash_profile', '.profile');
  });

  it('F-2704 AC-11 (startup-timeout): a .bash_profile that sleeps past the connect timeout ends the connect with the timeout dialog', async () => {
    await setting('remote.SSH.connectTimeout', 10);
    await freshServer('harness-bash');
    await writeHomeFile('harness-bash', '.bash_profile', 'sleep 60\n');
    const failed = await failedOn('harness-bash', 'to-ac11', 60_000);
    deepStrictEqual(
      [failed.dialog.question, failed.dialog.buttons],
      [TIMED_OUT, BUTTONS],
    );
  });

  it('F-2704 AC-11 (ruling-1221-read): a .bash_profile that reads a line ends the connect within 5 s with the dialog of AC-13, and the log names the cause', async () => {
    await setting('remote.SSH.connectTimeout', 10);
    await freshServer('harness-bash');
    await writeHomeFile('harness-bash', '.bash_profile', 'read answer\n');
    const mark = connectionLog().length;
    const failed = await failedOn('harness-bash', 'to-ac11-read', 60_000);
    deepStrictEqual(
      {
        question: failed.dialog.question,
        buttons: failed.dialog.buttons,
        quick: failed.dialog.milliseconds < 5000,
        logged: logSince(mark).some(line =>
          line.includes(
            'the SSH session ended before the host reported its platform',
          ),
        ),
      },
      {
        question: 'Could not establish connection to "harness-bash".',
        buttons: BUTTONS,
        quick: true,
        logged: true,
      },
    );
  });

  it('F-2704 AC-12 (timeout-actions): More Actions... on the timeout dialog shows the pick with its five items in order', async () => {
    await setting('remote.SSH.connectTimeout', 10);
    await freshServer('harness-bash');
    await writeHomeFile('harness-bash', '.bash_profile', 'sleep 60\n');
    const window = 'to-ac12';
    appendScript([
      {
        surface: 'failureDialog',
        match: 'Could not establish connection',
        answer: {button: 'More Actions...'},
        window,
      },
      {
        surface: 'mitigationPick',
        match: 'Pick an action',
        answer: 'dismiss',
        window,
      },
    ] satisfies AppendedEntry[]);
    await openWindow('harness-bash', window);
    await waitFor(
      'the pick of actions',
      () => recordLines('mitigationPick', window).length > 0,
      90_000,
    );
    const pick = recordLines('mitigationPick', window)[0];
    deepStrictEqual(
      [pick?.question, pick?.items],
      [
        'Pick an action to help resolve the problem.',
        [
          'Reload Window',
          'Open Recent...',
          'Open Documentation',
          'Open SSH Configuration File',
          'Open Settings',
        ],
      ],
    );
  });

  it('F-2704 AC-13, AC-25 (startup-exit): a .profile that ends with exit 1 fails within 5 s with the dialog, and the log says the session ended before the host reported its platform', async () => {
    await freshServer('harness-bash');
    await writeHomeFile('harness-bash', '.profile', 'exit 1\n');
    const mark = connectionLog().length;
    const failed = await failedOn('harness-bash', 'to-ac13', 60_000);
    deepStrictEqual(
      {
        question: failed.dialog.question,
        buttons: failed.dialog.buttons,
        quick: failed.dialog.sinceConnectStarted < 2000,
        logged: logSince(mark).some(line =>
          line.includes(
            'the SSH session ended before the host reported its platform',
          ),
        ),
      },
      {
        question: 'Could not establish connection to "harness-bash".',
        buttons: BUTTONS,
        quick: true,
        logged: true,
      },
    );
  });

  it('F-2704 AC-14 (slow-startup): a .profile that takes 25 s with a connect timeout of 40 s connects with no notice, and its export reaches a task', async () => {
    // The run's hosts name a ConnectTimeout of their own, which counts before the setting does: the run's
    // configuration with 40 s in its place is the timeout of 40 s.
    const configFile = path.join(
      variable('HARNESS_RUN_FOLDER'),
      'ssh_config_slow',
    );
    writeFileSync(
      configFile,
      readFileSync(variable('HARNESS_SSH_CONFIG'), 'utf8').replaceAll(
        'ConnectTimeout 10',
        'ConnectTimeout 40',
      ),
    );
    await setting('remote.SSH.configFile', configFile);
    try {
      await freshServer('harness-bash');
      await writeHomeFile(
        'harness-bash',
        '.profile',
        'sleep 25\nexport F2704_SLOW=1\n',
      );
      const seen = await withWindow('harness-bash', 'to-ac14', async () => ({
        notices: surfaceLines('to-ac14', 'notice'),
        task: (await taskEnvironment('to-ac14', 'harness-bash', 'to-ac14'))
          .F2704_SLOW,
      }));
      deepStrictEqual(seen, {notices: [], task: '1'});
    } finally {
      await setting('remote.SSH.configFile', variable('HARNESS_SSH_CONFIG'));
    }
  });

  it('F-2704 AC-23 (timeout-retry): Retry on the timeout dialog reloads the window and the same dialog comes again', async () => {
    await setting('remote.SSH.connectTimeout', 10);
    await freshServer('harness-bash');
    await writeHomeFile('harness-bash', '.bash_profile', 'sleep 60\n');
    const window = 'to-ac23';
    appendScript([
      {
        surface: 'failureDialog',
        match: 'Could not establish connection',
        answer: {button: 'Retry'},
        window,
      },
      ...dismissals(window),
    ] satisfies AppendedEntry[]);
    await openWindow('harness-bash', window);
    await waitFor(
      'the dialog to come twice',
      () => recordLines('failureDialog', window).length >= 2,
      120_000,
    );
    deepStrictEqual(
      recordLines('failureDialog', window)
        .slice(0, 2)
        .map(line => [line.question, line.answer]),
      [
        [TIMED_OUT, 'Retry'],
        [TIMED_OUT, 'dismiss'],
      ],
    );
  });

  it('F-2704 AC-24 (timeout-close): Close Remote on the timeout dialog leaves an empty local window', async () => {
    await setting('remote.SSH.connectTimeout', 10);
    await freshServer('harness-bash');
    await writeHomeFile('harness-bash', '.bash_profile', 'sleep 60\n');
    const window = 'to-ac24';
    appendScript([
      {
        surface: 'failureDialog',
        match: 'Could not establish connection',
        answer: {button: 'Close Remote'},
        window,
      },
    ] satisfies AppendedEntry[]);
    const known = emptyWindows();
    await openWindow('harness-bash', window);
    let local = '';
    await waitFor(
      'the window to be an empty local window again',
      () => {
        local = emptyWindows().find(each => !known.includes(each)) ?? '';
        return (
          local !== '' &&
          windowEvents(local).some(each => each.event === 'activated')
        );
      },
      120_000,
    );
    const state = await windowState(local);
    await closeWindow(local);
    deepStrictEqual(
      {remote: state.remoteName, folders: state.folders},
      {remote: null, folders: []},
    );
  });

  it('F-2704 AC-32 (timeout-close-remote): after the timeout dialog’s Close Remote no sshd-session of the user remains and no server folder exists 30 s later', async () => {
    await setting('remote.SSH.connectTimeout', 10);
    await freshServer('harness-bash');
    await onHostAs(
      'harness-bash',
      'sh',
      '-c',
      'pkill -f \'[.]vscodium-server-insiders/\' || true; rm -rf "$HOME/.vscodium-server-insiders"',
    );
    await writeHomeFile('harness-bash', '.bash_profile', 'sleep 60\n');
    const window = 'to-ac32';
    appendScript([
      {
        surface: 'failureDialog',
        match: 'Could not establish connection',
        answer: {button: 'Close Remote'},
        window,
      },
    ] satisfies AppendedEntry[]);
    const known = emptyWindows();
    await openWindow('harness-bash', window);
    await waitFor(
      'the dialog',
      () => recordLines('failureDialog', window).length > 0,
      120_000,
    );
    await new Promise(resolve => setTimeout(resolve, 30_000));
    const sessions = await onHostAs(
      'harness-bash',
      'sh',
      '-c',
      'pgrep -u "$(id -u)" -x sshd-session || true',
    );
    const folder = await onHostAs(
      'harness-bash',
      'sh',
      '-c',
      'test -e "$HOME/.vscodium-server-insiders" && echo present || echo absent',
    );
    for (const local of emptyWindows().filter(each => !known.includes(each))) {
      await closeWindow(local);
    }
    deepStrictEqual([sessions.trim(), folder.trim()], ['', 'absent']);
  });
});
