/**
 * @fileoverview What the rows that read the session troubleshooting terminal share: its name, the wait for its table,
 * and the cells of the table.
 */

import {
  inWindow,
  openWindow,
  readUserSettings,
  recordLines,
  restoreUserSettings,
  userSettings,
  waitFor,
} from './harness.ts';
import {INSTALL_MILLISECONDS} from './maintenance.ts';
import {terminalTabsOf, terminalText} from './renderer.ts';

/** The name of the terminal the table is written into. */
const NAME = 'Remote - SSH: Session Troubleshooting';
/** How long the terminal has, after the failure dialog, to be among the terminals: about a second, and a margin. */
export const TERMINAL_MILLISECONDS = 5_000;

/** Opens window `name` on `alias` and waits until its failure dialog was shown. */
export async function failedOn(alias: string, name: string): Promise<void> {
  await openWindow(alias, name);
  await waitFor(
    `the failure dialog of ${name}`,
    () => recordLines('failureDialog', name).length > 0,
    INSTALL_MILLISECONDS,
  );
}

/** Waits for the troubleshooting terminal of window `name`, and gives the lines of its table, whitespace as spaces. */
export async function tableOf(name: string): Promise<string[]> {
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

/**
 * Waits for the troubleshooting terminal of window `name`, and gives the lines of its table once all of them are in
 * view: the first is the table's top border and the last its bottom one. The panel is maximised and the terminal's
 * font small, or a table of many mitigations is taller than the rows in view.
 */
export async function wholeTableOf(name: string): Promise<string[]> {
  await inWindow(name, 'workbench.action.toggleMaximizedPanel');
  try {
    await waitFor(
      'the whole table in view',
      async () => {
        const lines = await tableOf(name).catch(() => []);
        return (
          lines[0]?.startsWith('╔') === true &&
          lines.at(-1)?.startsWith('╚') === true
        );
      },
      30_000,
    );
    return await tableOf(name);
  } finally {
    await inWindow(name, 'workbench.action.toggleMaximizedPanel');
  }
}

/** The cells of a table row, trimmed. */
export function cellsOf(line: string | undefined): string[] {
  return (line ?? '')
    .replace(/^║|║$/gu, '')
    .split('│')
    .map(cell => cell.trim());
}

/** The cells of the first data row of `table`, each with its wrapped lines joined by one space. */
export function firstRowOf(table: readonly string[]): string[] {
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
export async function troubleshootingTabs(name: string): Promise<string[]> {
  return (await terminalTabsOf(name)).filter(label => label.includes(NAME));
}

/**
 * The header and the first row of the troubleshooting table of window `name`, with the tab list of a lone terminal
 * shown while they are read; the user settings are back as they were afterwards.
 */
export async function tableShown(name: string) {
  const saved = readUserSettings();
  try {
    // Core hides the tab list of a single terminal; the rows read what the panel lists.
    await userSettings({'terminal.integrated.tabs.hideCondition': 'never'});
    const table = await wholeTableOf(name);
    return {header: cellsOf(table[1]), first: firstRowOf(table)};
  } finally {
    restoreUserSettings(saved);
  }
}
