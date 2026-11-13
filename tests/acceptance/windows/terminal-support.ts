/**
 * @fileoverview What the rows that read a window's terminal share: the line a terminal prints for an expression, and a
 * window opened on the host with a terminal in it.
 */

import {
  connectionLog,
  inWindow,
  openWindow,
  terminalNames,
  waitFor,
  windowState,
} from './harness.ts';
import {terminalText, typeInTerminal} from './renderer.ts';

/** How many prompts the shell of window `window`'s terminal has printed: lines with the prompt's `$`, at the start of the line (dash's bare `$ `) or after a space (`~/folder $ `), whatever follows it. */
async function promptsOf(window: string): Promise<number> {
  return (await terminalText(window))
    .split('\n')
    .filter(line => /(?:^| )\$(?: |$)/.test(line)).length;
}

/** The last lines window `window`'s terminal shows, for the failure of a wait to name; a terminal that cannot be read says so. */
async function terminalTail(window: string): Promise<string[]> {
  return (await terminalText(window).catch(() => '(unreadable)'))
    .split('\n')
    .slice(-15);
}

/** A wait on window `window`'s terminal whose failure also shows what the terminal showed: a terminal that never started and a prompt the match missed read differently. */
async function waitForTerminal(
  window: string,
  description: string,
  check: () => Promise<boolean>,
): Promise<void> {
  await waitFor(description, check, 40_000).catch(async (caught: unknown) => {
    throw new Error(
      `${String(caught)}; the terminal shows: ${JSON.stringify(await terminalTail(window))}; the window's terminals: ${await withinTenSeconds(terminalNames(window))}; the window's remote: ${await withinTenSeconds(windowState(window).then(state => state.remoteName))}; the extension's log ends: ${JSON.stringify(connectionLog().slice(-8))}`,
      {cause: caught},
    );
  });
}

/** What `read` gives as text within ten seconds, for a failure to name; what does not come in time or fails says so. */
async function withinTenSeconds(read: Promise<unknown>): Promise<string> {
  const timeout = new Promise<string>(resolve => {
    setTimeout(resolve, 10_000, '(not read in 10 s)');
  });
  return Promise.race([
    read.then(
      value => JSON.stringify(value),
      () => '(unreadable)',
    ),
    timeout,
  ]);
}

/**
 * Waits until the shell of the terminal of `window` has read what the terminal sent it at its start. The host's shell
 * is BusyBox's, which asks the terminal for the cursor position at its first prompt; the terminal's reply reaches the
 * shell later or sooner, and one that arrives while a command runs is echoed by the tty into that command's output
 * (`^[[1;15R` at the start of a line). A command that prints nothing, and the prompt that follows it, show that the
 * shell has been through a full cycle of reading, so the row's own command is typed after both.
 * A terminal whose shell has printed two prompts has been through such a cycle already.
 */
async function settledShell(window: string): Promise<void> {
  if ((await promptsOf(window)) >= 2) {
    return;
  }
  await waitForTerminal(
    window,
    `the first prompt of ${window}`,
    async () => (await promptsOf(window)) >= 1,
  );
  const before = await promptsOf(window);
  await typeInTerminal(window, 'true\n');
  await waitForTerminal(
    window,
    `the prompt after the first command of ${window}`,
    async () => (await promptsOf(window)) > before,
  );
}

/** The prefix of the line a terminal prints for the label `label`, and the text after it. */
export async function printedAfter(
  window: string,
  label: string,
  expression: string,
): Promise<string> {
  await settledShell(window);
  await typeInTerminal(window, `echo "${label}:${expression}"\n`);
  let found = '';
  await waitForTerminal(
    window,
    `the line ${label}: in window ${window}`,
    async () => {
      const lines = (await terminalText(window)).split('\n');
      const printed = lines.find(
        line => line.startsWith(`${label}:`) && !line.includes('$'),
      );
      found = printed?.slice(label.length + 1) ?? '';
      return printed !== undefined;
    },
  );
  return found;
}

/**
 * Opens a window on `alias` (the host's default account unless given) in a new folder `folder` of the home of `user` with a
 * terminal in it, whose shell has been through its first full cycle of reading: a row types after that, so what it
 * types is not mixed with the terminal's reply to the shell's first query.
 */
export async function windowWithTerminal(
  folder: string,
  alias = 'harness',
  user = 'harness',
): Promise<void> {
  await openWindow(alias, folder, user);
  await inWindow(folder, 'workbench.action.terminal.new');
  await settledShell(folder);
}

/** What `ssh-add -l` prints first in a new terminal of window `name`, its spaces written as underscores. */
export async function listedKeys(name: string): Promise<string> {
  return printedAfter(
    name,
    'KEYS',
    '$(ssh-add -l 2>&1 | head -1 | tr " " "_")',
  );
}
