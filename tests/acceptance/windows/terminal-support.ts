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

/** Opens a window on `alias` (the host's default account unless given) in a new folder `folder` of the home of `user` with a terminal in it. */
export async function windowWithTerminal(
  folder: string,
  alias = 'harness',
  user = 'harness',
): Promise<void> {
  await openWindow(alias, folder, user);
  await inWindow(folder, 'workbench.action.terminal.new');
}

/** What `ssh-add -l` prints first in a new terminal of window `name`, its spaces written as underscores. */
export async function listedKeys(name: string): Promise<string> {
  return printedAfter(
    name,
    'KEYS',
    '$(ssh-add -l 2>&1 | head -1 | tr " " "_")',
  );
}
