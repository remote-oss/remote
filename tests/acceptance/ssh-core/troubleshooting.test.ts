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
  userSettings,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {hintRecords} from '../windows/hint-store.ts';
import {PLATFORMS} from '../windows/tunnel-support.ts';
import {
  closeAllButLocal,
  dismissals,
  INSTALL_MILLISECONDS,
} from '../windows/maintenance.ts';
import {
  notifications,
  terminalTabsOf,
  terminalText,
  typeInTerminal,
} from '../windows/renderer.ts';

const NAME = 'Remote - SSH: Session Troubleshooting';
const CLEAR = 'opensshremotes.clearAllSessionHints';

/** How long the terminal has, after the failure dialog, to be among the terminals: about a second, and a margin. */
const TERMINAL_MILLISECONDS = 5_000;

/** Opens window `name` on `alias` and waits until its failure dialog was shown. */
async function failedOn(alias: string, name: string): Promise<void> {
  await openWindow(alias, name);
  await waitFor(
    `the failure dialog of ${name}`,
    () => recordLines('failureDialog', name).length > 0,
    INSTALL_MILLISECONDS,
  );
}

/** Opens window `name` on `nowhere`, whose name never resolves, and waits until its failure dialog was shown. */
async function failed(name: string): Promise<void> {
  appendScript(dismissals(name));
  await failedOn('nowhere', name);
}

/** Waits for the troubleshooting terminal of window `name`, and gives the lines of its table, whitespace as spaces. */
async function tableOf(name: string): Promise<string[]> {
  await waitFor(
    'the troubleshooting terminal',
    async () => (await troubleshootingTabs(name)).length > 0,
    TERMINAL_MILLISECONDS,
  );
  return (await terminalText(name))
    .replaceAll('\u00a0', ' ')
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => /^[╔║╟╚]/u.test(line));
}

/** The cells of a table row, trimmed. */
function cellsOf(line: string | undefined): string[] {
  return (line ?? '')
    .replace(/^║|║$/gu, '')
    .split('│')
    .map(cell => cell.trim());
}

/** The cells of the first data row of `table`, each with its wrapped lines joined by one space. */
function firstRowOf(table: readonly string[]): string[] {
  const end = table.findIndex(
    (line, index) => index > 2 && /^[╟╚]/u.test(line),
  );
  const lines = table.slice(3, end).map(cellsOf);
  return (lines[0] ?? []).map((unused, column) =>
    lines
      .map(cells => cells[column] ?? '')
      .filter(cell => cell !== '')
      .join(' '),
  );
}

/** The terminals of window `name` that are the troubleshooting one. */
async function troubleshootingTabs(name: string): Promise<string[]> {
  return (await terminalTabsOf(name)).filter(label => label.includes(NAME));
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
      await waitFor(
        'the newest record with its log hint',
        () =>
          hintRecords()
            .at(-1)
            ?.hints.some(hint => hint.kind === 'log') ?? false,
        60_000,
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

  it('F-2605 AC-5 (c136-noforward): a host whose sshd forbids TCP forwarding gives the four-column table with the AllowTcpForwardingDisabled row, its two mitigations and a documentation address', async () => {
    await userSettings({...PLATFORMS});
    appendScript([
      {
        surface: 'notice' as const,
        match: 'Failed to set up',
        answer: 'dismiss' as const,
        window: 'c136-i',
      },
      ...dismissals('c136-i'),
    ]);
    await failedOn('noforward', 'c136-i');
    try {
      // The four-column table is taller than the panel; the maximized panel shows all of it.
      await waitFor(
        'the troubleshooting terminal',
        async () => (await troubleshootingTabs('c136-i')).length > 0,
        TERMINAL_MILLISECONDS,
      );
      await inWindow('c136-i', 'workbench.action.toggleMaximizedPanel');
      await new Promise(resolve => setTimeout(resolve, 2_000));
      const table = await tableOf('c136-i');
      // A narrow column breaks inside long words, so the cells are compared with every space taken out.
      const [status, message, mitigations, resources] = firstRowOf(table).map(
        cell => cell.replaceAll(' ', ''),
      );
      deepStrictEqual(
        {
          header: cellsOf(table[1]),
          status,
          message,
          mitigations,
          resources: [
            resources?.startsWith('•'),
            resources?.includes('https://'),
          ],
        },
        {
          header: ['Status', 'Message', 'Mitigations', 'Resources'],
          status: 'AllowTcpForwardingDisabled',
          message:
            "The remote server's SSH configuration may have TCP forwarding disabled".replaceAll(
              ' ',
              '',
            ),
          mitigations:
            "• Add the setting 'AllowTcpForwarding yes' to the server's '/etc/ssh/sshd_config' (or similar) configuration file • Restart the SSH server on the remote machine to apply any changes to the configuration".replaceAll(
              ' ',
              '',
            ),
          resources: [true, true],
        },
      );
    } finally {
      await userSettings({'remote.SSH.remotePlatform': undefined});
      await closeWindow('c136-i').catch(() => undefined);
    }
  });
});
