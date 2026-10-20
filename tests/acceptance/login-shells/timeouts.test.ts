import {deepStrictEqual} from 'node:assert';
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import type {AppendedEntry} from '../../../tools/script-file.ts';
import {
  appendScript,
  closeWindow,
  connectionLog,
  onHostAs,
  openWindow,
  recordLines,
  variable,
  waitFor,
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

  it.skip('F-2704 AC-11 (startup-timeout): a .bash_profile that sleeps past the connect timeout, and one that reads a line, each end the connect with the timeout dialog', async () => {
    await setting('remote.SSH.connectTimeout', 10);
    const seen: Array<[string, string[]]> = [];
    for (const [file, name] of [
      ['sleep 60\n', 'to-ac11a'],
      ['read answer\n', 'to-ac11b'],
    ] as const) {
      await freshServer('harness-bash');
      await writeHomeFile('harness-bash', '.bash_profile', file);
      const failed = await failedOn('harness-bash', name, 60_000);
      seen.push([failed.dialog.question, failed.dialog.buttons]);
    }
    deepStrictEqual(seen, [
      [TIMED_OUT, BUTTONS],
      [TIMED_OUT, BUTTONS],
    ]);
  });

  it.skip('F-2704 AC-12 (timeout-actions): More Actions... on the timeout dialog shows the pick with its five items in order', async () => {
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
    deepStrictEqual(pick?.items, [
      'Reload Window',
      'Open Recent...',
      'Open Documentation',
      'Open SSH Configuration File',
      'Open Settings',
    ]);
  });

  it.skip('F-2704 AC-13, AC-25 (startup-exit): a .profile that ends with exit 1 fails within 5 s with the dialog, and the log says the session ended before the host reported its platform', async () => {
    await freshServer('harness-bash');
    await writeHomeFile('harness-bash', '.profile', 'exit 1\n');
    const mark = connectionLog().length;
    const failed = await failedOn('harness-bash', 'to-ac13', 60_000);
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
      await setting('remote.SSH.configFile', undefined);
    }
  });

  it.skip('F-2704 AC-23 (timeout-retry): Retry on the timeout dialog reloads the window and the same dialog comes again', async () => {
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

  it('F-2704 AC-24, AC-32 (timeout-close): Close Remote on the timeout dialog leaves an empty local window, and on a host with no server no session of the user and no server folder remain', async () => {
    await setting('remote.SSH.connectTimeout', 10);
    await freshServer('harness-bash');
    await onHostAs('harness-bash', 'rm', '-rf', '.vscodium-server-insiders');
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
    await openWindow('harness-bash', window);
    await waitFor(
      'the window to be local again',
      async () => (await windowState(window)).remoteName === null,
      120_000,
    );
    const state = await windowState(window);
    await waitFor(
      'no process of the user to remain',
      async () =>
        (
          await onHostAs(
            'harness-bash',
            'sh',
            '-c',
            'pgrep -u "$(id -u)" || true',
          )
        ).trim() === '',
      30_000,
    );
    const folder = await onHostAs(
      'harness-bash',
      'sh',
      '-c',
      'ls -d "$HOME/.vscodium-server-insiders" "$HOME/.vscode-server" 2>/dev/null || true',
    );
    await closeWindow(window);
    deepStrictEqual(
      {remote: state.remoteName, folders: state.folders, left: folder.trim()},
      {remote: null, folders: [], left: ''},
    );
  });
});
