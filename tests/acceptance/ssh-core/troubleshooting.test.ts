/**
 * @fileoverview The session troubleshooting terminal (card connect-136, F-2605): the table a failed attempt leaves in
 * a terminal of its own, what the log says about the check, and the cases where no terminal appears.
 */

import {deepStrictEqual} from 'node:assert';
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
  waitFor,
} from '../windows/harness.ts';
import {hintRecords} from '../windows/hint-store.ts';
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

/** Opens window `name` on `nowhere`, whose name never resolves, and waits until its failure dialog was shown. */
async function failed(name: string): Promise<void> {
  appendScript(dismissals(name));
  await openWindow('nowhere', name);
  await waitFor(
    `the failure dialog of ${name}`,
    () => recordLines('failureDialog', name).length > 0,
    INSTALL_MILLISECONDS,
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
});
