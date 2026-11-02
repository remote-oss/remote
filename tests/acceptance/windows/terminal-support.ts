/**
 * @fileoverview What the rows that read a window's terminal share: the line a terminal prints for an expression, and a
 * window opened on the host with a terminal in it.
 */

import {inWindow, openWindow, waitFor} from './harness.ts';
import {terminalText, typeInTerminal} from './renderer.ts';

/** The prefix of the line a terminal prints for the label `label`, and the text after it. */
export async function printedAfter(
  window: string,
  label: string,
  expression: string,
): Promise<string> {
  await typeInTerminal(window, `echo "${label}:${expression}"\n`);
  let found = '';
  await waitFor(
    `the line ${label}: in window ${window}`,
    async () => {
      const lines = (await terminalText(window)).split('\n');
      const printed = lines.find(
        line => line.startsWith(`${label}:`) && !line.includes('$'),
      );
      found = printed?.slice(label.length + 1) ?? '';
      return printed !== undefined;
    },
    40_000,
  );
  return found;
}

/** Opens a window on `alias` (the host's default account unless given) in a new folder `folder` with a terminal in it. */
export async function windowWithTerminal(
  folder: string,
  alias = 'harness',
): Promise<void> {
  await openWindow(alias, folder);
  await inWindow(folder, 'workbench.action.terminal.new');
}
