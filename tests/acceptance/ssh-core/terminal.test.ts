import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  inWindow,
  onHost,
  openWindow,
  terminalNames,
  waitFor,
} from '../windows/harness.ts';
import {terminalText, typeInTerminal} from '../windows/renderer.ts';

/** The prefix of the line a terminal prints for the label `label`, and the text after it. */
async function printedAfter(
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

/** Opens a window on the host in a new folder `folder` with a terminal in it. */
async function windowWithTerminal(folder: string): Promise<void> {
  await openWindow('harness', folder);
  await inWindow(folder, 'workbench.action.terminal.new');
}

describe('the terminal in an SSH window (card coverage-80)', function () {
  this.timeout(300_000);

  it('F-2508 AC-1 (c80-shell): a new terminal runs a shell on the host, as the SSH user in the remote folder, using the user’s login shell', async () => {
    await windowWithTerminal('c80-shell');
    try {
      const [user, host, shell] = [
        (await onHost('whoami')).trim(),
        (await onHost('hostname')).trim(),
        (
          await onHost('sh', '-c', 'getent passwd harness | cut -d: -f7')
        ).trim(),
      ];
      deepStrictEqual(
        [
          await printedAfter('c80-shell', 'USER1', '$(whoami)'),
          await printedAfter('c80-shell', 'HOST1', '$(hostname)'),
          await printedAfter('c80-shell', 'DIR1', '$PWD'),
          await printedAfter('c80-shell', 'SHELL1', '$SHELL'),
        ],
        [user, host, '/home/harness/c80-shell', shell],
      );
    } finally {
      await closeWindow('c80-shell').catch(() => undefined);
    }
  });

  it('F-2508 AC-3, AC-19 (c80-environment): the terminal has TERM_PROGRAM vscode, the editor’s hook for its command and the server’s remote-cli first on the PATH, and with no forwarding configured SSH_AUTH_SOCK and DISPLAY are empty and SSH_CONNECTION is set', async () => {
    await windowWithTerminal('c80-environment');
    try {
      deepStrictEqual(
        [
          await printedAfter('c80-environment', 'TP', '$TERM_PROGRAM'),
          await printedAfter(
            'c80-environment',
            'HOOK',
            '${VSCODE_IPC_HOOK_CLI:+set}',
          ),
          (
            await printedAfter('c80-environment', 'FIRST', '${PATH%%:*}')
          ).endsWith('/bin/remote-cli'),
          await printedAfter('c80-environment', 'AUTH', '[$SSH_AUTH_SOCK]'),
          await printedAfter('c80-environment', 'DISP', '[$DISPLAY]'),
          await printedAfter(
            'c80-environment',
            'CONN',
            '${SSH_CONNECTION:+set}',
          ),
        ],
        ['vscode', 'set', true, '[]', '[]', 'set'],
      );
    } finally {
      await closeWindow('c80-environment').catch(() => undefined);
    }
  });

  it('F-2508 AC-22 (c80-second): a second Create New Terminal opens a second tab, both named for the SSH user’s login shell, whose shell also runs on the host', async () => {
    await windowWithTerminal('c80-second');
    try {
      await inWindow('c80-second', 'workbench.action.terminal.new');
      const host = (await onHost('hostname')).trim();
      const shell = (
        await onHost(
          'sh',
          '-c',
          'basename "$(getent passwd harness | cut -d: -f7)"',
        )
      ).trim();
      deepStrictEqual(
        [
          await terminalNames('c80-second'),
          await printedAfter('c80-second', 'HOST2', '$(hostname)'),
        ],
        [[shell, shell], host],
      );
    } finally {
      await closeWindow('c80-second').catch(() => undefined);
    }
  });
});
