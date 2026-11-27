/**
 * @fileoverview The session troubleshooting terminal (card connect-136, F-2605): the table a failed attempt leaves in
 * a terminal of its own, what the log says about the check, and the cases where no terminal appears.
 */

import {deepStrictEqual} from 'node:assert';
import {writeFileSync} from 'node:fs';
import {
  appendScript,
  closeWindow,
  connectedWithin,
  connectionLog,
  inWindow,
  openWindow,
  readUserSettings,
  recordLines,
  restoreUserSettings,
  terminalNames,
  userSettings,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {hintRecords, waitForRecords} from '../windows/hint-store.ts';
import {
  closeAllButLocal,
  dismissals,
  INSTALL_MILLISECONDS,
} from '../windows/maintenance.ts';
import {
  notifications,
  outputChannelOf,
  terminalText,
  typeInTerminal,
} from '../windows/renderer.ts';
import {
  cellsOf,
  failedOn,
  firstRowOf,
  tableOf,
  TERMINAL_MILLISECONDS,
  troubleshootingTabs,
} from '../windows/troubleshooting-support.ts';

const CLEAR = 'opensshremotes.clearAllSessionHints';

/** Opens window `name` on `nowhere`, whose name never resolves, and waits until its failure dialog was shown. */
async function failed(name: string): Promise<void> {
  appendScript(dismissals(name));
  await failedOn('nowhere', name);
}

describe('the session troubleshooting terminal (card connect-136)', function () {
  this.timeout(600_000);
  let saved: string | undefined;

  before(async () => {
    saved = readUserSettings();
    // Core hides the tab list of a single terminal; the rows read what the panel lists.
    await userSettings({'terminal.integrated.tabs.hideCondition': 'never'});
    await closeAllButLocal();
    await inWindow('local', CLEAR);
  });

  after(async () => {
    restoreUserSettings(saved);
    await closeAllButLocal();
  });

  it('F-2605 AC-2, AC-3, AC-25, AC-26 (c136-table): a failed attempt opens the terminal within moments of the dialog, with an empty line, the heading, the table and the Output Log... line, no Copilot line and no Analyzing text, and the log has the summary', async () => {
    const started = Date.now();
    await failed('c136-a');
    try {
      await waitFor(
        'the troubleshooting terminal',
        async () => (await troubleshootingTabs('c136-a')).length > 0,
        TERMINAL_MILLISECONDS,
      );
      const seconds = (Date.now() - started) / 1000;
      const text = await terminalText('c136-a');
      const lines = text
        .replaceAll('\u00a0', ' ')
        .split('\n')
        .map(line => line.trimEnd());
      const table = lines.filter(line => /^[╔║╟╚]/u.test(line));
      deepStrictEqual(
        {
          tabs: (await troubleshootingTabs('c136-a')).length,
          before: lines.slice(
            0,
            lines.indexOf(
              'The following issues were detected in your most recent Remote - SSH session',
            ),
          ),
          heading: lines.includes(
            'The following issues were detected in your most recent Remote - SSH session',
          ),
          header: table[1]?.includes('Status') && table[1].includes('Message'),
          rows: table.some(
            line =>
              line.includes('OfflineError') &&
              line.includes('Error: OfflineError ('),
          ),
          last: lines.filter(line => line !== '').at(-1),
          noCopilot: !/Copilot|Cmd\+click/u.test(text),
          noAnalyzing:
            !text.includes('Analyzing your previous SSH session logs...') &&
            !(await notifications('c136-a')).some(each =>
              each.includes('Analyzing'),
            ) &&
            !connectionLog().some(each => each.includes('Analyzing')),
          summary: connectionLog().some(each =>
            each.startsWith('[OfflineError]: Error: OfflineError ('),
          ),
          quick: seconds < 120,
        },
        {
          tabs: 1,
          before: [],
          heading: true,
          header: true,
          rows: true,
          last: 'See verbose information in the Output Log...',
          noCopilot: true,
          noAnalyzing: true,
          summary: true,
          quick: true,
        },
      );
    } finally {
      await closeWindow('c136-a').catch(() => undefined);
    }
  });

  it('F-2605 AC-7 (c136-ignores-input): typed characters and Enter are not echoed and change nothing', async () => {
    await failed('c136-b');
    try {
      await waitFor(
        'the troubleshooting terminal',
        async () => (await troubleshootingTabs('c136-b')).length > 0,
        TERMINAL_MILLISECONDS,
      );
      await inWindow('c136-b', 'workbench.action.terminal.focus');
      const before = await terminalText('c136-b');
      await typeInTerminal('c136-b', 'hello\n');
      await new Promise(resolve => setTimeout(resolve, 1_000));
      deepStrictEqual(await terminalText('c136-b'), before);
    } finally {
      await closeWindow('c136-b').catch(() => undefined);
    }
  });

  it('F-2605 AC-15 (c136-kill): killing the terminal removes it and leaves the stored records as they were', async () => {
    await inWindow('local', CLEAR);
    await waitFor('an empty store', () => hintRecords().length === 0, 60_000);
    await failed('c136-c');
    try {
      await waitFor(
        'the troubleshooting terminal',
        async () => (await troubleshootingTabs('c136-c')).length > 0,
        TERMINAL_MILLISECONDS,
      );
      await waitForRecords(
        'the newest record with its log hint',
        () =>
          hintRecords()
            .at(-1)
            ?.hints.some(hint => hint.kind === 'log') ?? false,
        // The log hint is kept when the attempt has ended, which a slower runner takes longer to do.
        180_000,
      );
      const before = JSON.stringify(hintRecords());
      await inWindow('c136-c', 'workbench.action.terminal.kill');
      await waitFor(
        'the terminal to be gone',
        async () => (await troubleshootingTabs('c136-c')).length === 0,
        30_000,
      );
      deepStrictEqual(JSON.stringify(hintRecords()), before);
    } finally {
      await closeWindow('c136-c').catch(() => undefined);
    }
  });

  it('F-2605 AC-10, AC-26 (c136-success): a successful attempt opens no terminal, and the log says that no hints were found', async () => {
    await inWindow('local', CLEAR);
    const mark = connectionLog().length;
    await openWindow('harness', 'c136-d');
    try {
      await connectedWithin('c136-d', INSTALL_MILLISECONDS);
      await waitFor(
        'the check of the attempt',
        () =>
          connectionLog()
            .slice(mark)
            .some(line =>
              line.includes('No hints found in the recent session.'),
            ),
        60_000,
      );
      deepStrictEqual(await troubleshootingTabs('c136-d'), []);
    } finally {
      await closeWindow('c136-d').catch(() => undefined);
    }
  });

  it('F-2605 AC-11, AC-26 (c136-off): with enhancedSessionLogs off the failure surface is the same, no terminal opens, the record keeps the error, and the log says the feature is off', async () => {
    await inWindow('local', CLEAR);
    await userSettings({'remote.SSH.experimental.enhancedSessionLogs': false});
    const mark = connectionLog().length;
    await failed('c136-e');
    try {
      await waitFor(
        'the record with its error hint',
        () =>
          hintRecords().some(record =>
            record.hints.some(hint => hint.kind === 'error'),
          ),
        60_000,
      );
      await waitFor(
        'the check of the attempt',
        () =>
          connectionLog()
            .slice(mark)
            .some(line => line.includes('Enhanced session logs are disabled.')),
        60_000,
      );
      deepStrictEqual(
        [
          await troubleshootingTabs('c136-e'),
          recordLines('failureDialog', 'c136-e').length,
        ],
        [[], 1],
      );
    } finally {
      await userSettings({
        'remote.SSH.experimental.enhancedSessionLogs': undefined,
      });
      await closeWindow('c136-e').catch(() => undefined);
    }
  });

  it("F-2003 AC-30 (c2784-off-panel): with enhancedSessionLogs off, a failure with detected issues shows the panel on the Output view's Remote - SSH channel and opens no troubleshooting terminal", async () => {
    await inWindow('local', CLEAR);
    await userSettings({'remote.SSH.experimental.enhancedSessionLogs': false});
    await failed('c2784-off');
    try {
      await waitFor(
        'the panel on the Remote - SSH output channel',
        async () => (await outputChannelOf('c2784-off')) === 'Remote - SSH',
        60_000,
      );
      deepStrictEqual(
        [
          await outputChannelOf('c2784-off'),
          (await terminalNames('c2784-off')).filter(each =>
            each.includes('Session Troubleshooting'),
          ),
          recordLines('failureDialog', 'c2784-off').length,
        ],
        ['Remote - SSH', [], 1],
      );
    } finally {
      await userSettings({
        'remote.SSH.experimental.enhancedSessionLogs': undefined,
      });
      await closeWindow('c2784-off').catch(() => undefined);
    }
  });

  it('F-2605 AC-4 (c136-timeout): a host that does not answer gives the two-column table with the OfflineError row', async () => {
    await userSettings({'remote.SSH.connectTimeout': 5});
    appendScript(dismissals('c136-f'));
    await failedOn('blackhole', 'c136-f');
    try {
      const table = await tableOf('c136-f');
      deepStrictEqual(
        [cellsOf(table[1]), firstRowOf(table)],
        [
          ['Status', 'Message'],
          ['OfflineError', 'Error: OfflineError (The connection timed out)'],
        ],
      );
    } finally {
      await userSettings({'remote.SSH.connectTimeout': undefined});
      await closeWindow('c136-f').catch(() => undefined);
    }
  });

  it('F-2605 AC-6 (c136-password): three wrong passwords give the PermissionDenied row', async () => {
    appendScript([
      ...[1, 2, 3].map(() => ({
        surface: 'maskedInput' as const,
        match: 'password',
        answer: {text: 'wrong-password'},
        window: 'c136-g',
      })),
      ...dismissals('c136-g'),
    ]);
    await failedOn('password-retry', 'c136-g');
    try {
      const table = await tableOf('c136-g');
      deepStrictEqual(
        [cellsOf(table[1]), firstRowOf(table)],
        [
          ['Status', 'Message'],
          [
            'PermissionDenied',
            'Error: PermissionDenied (Permission denied (password).)',
          ],
        ],
      );
    } finally {
      await closeWindow('c136-g').catch(() => undefined);
    }
  });

  /** Fails window `name` with the chat key `value` and gives whether its terminal has a Copilot line. */
  async function copilotLine(name: string, value: boolean): Promise<boolean> {
    await userSettings({'remote.SSH.experimental.chat': value});
    await failed(name);
    try {
      await tableOf(name);
      return /Copilot|Cmd\+click/u.test(await terminalText(name));
    } finally {
      await userSettings({'remote.SSH.experimental.chat': undefined});
      await closeWindow(name).catch(() => undefined);
    }
  }

  it('F-2605 AC-24 (c136-chat-true): with the chat key true the terminal has no Copilot line', async () => {
    deepStrictEqual(await copilotLine('c136-chat-true', true), false);
  });

  it('F-2605 AC-24 (c136-chat-false): with the chat key false the terminal has no Copilot line', async () => {
    deepStrictEqual(await copilotLine('c136-chat-false', false), false);
  });

  it('F-2605 AC-13 (c136-hostkey): cancelling the host-key question of a new host opens no terminal and records no error hint', async () => {
    writeFileSync(`${variable('HARNESS_RUN_FOLDER')}/known_hosts_stranger`, '');
    await inWindow('local', CLEAR);
    appendScript([
      {
        surface: 'pick',
        match: 'Are you sure',
        answer: 'dismiss',
        window: 'c136-h',
      },
      ...dismissals('c136-h'),
    ] as const);
    await failedOn('stranger', 'c136-h');
    try {
      await waitFor(
        'the record of the attempt',
        () => hintRecords().length > 0,
        60_000,
      );
      deepStrictEqual(
        [
          recordLines('pick', 'c136-h').length,
          await troubleshootingTabs('c136-h'),
          hintRecords().flatMap(record =>
            record.hints.filter(hint => hint.kind === 'error'),
          ),
        ],
        [1, [], []],
      );
    } finally {
      await closeWindow('c136-h').catch(() => undefined);
    }
  });
});
