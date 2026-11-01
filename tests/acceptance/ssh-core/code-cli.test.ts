import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  editorProduct,
  inWindow,
  onHost,
  openWindow,
  waitFor,
} from '../windows/harness.ts';
import {terminalText, typeInTerminal} from '../windows/renderer.ts';

/** The lines the terminal of `window` printed for `command`, each tagged `label:` by sed and ended by a marker line. */
async function linesOf(
  window: string,
  label: string,
  command: string,
): Promise<string[]> {
  await typeInTerminal(
    window,
    `(${command}) 2>&1 | sed "s/^/${label}:/"; echo END_${label}\n`,
  );
  await waitFor(
    `the end of ${label} in window ${window}`,
    async () =>
      (await terminalText(window))
        .split('\n')
        .some(line => line === `END_${label}`),
    60_000,
  );
  return (await terminalText(window))
    .split('\n')
    .filter(line => line.startsWith(`${label}:`) && !line.includes('sed '))
    .map(line => line.slice(label.length + 1));
}

/** Opens a window on the host in a new folder `folder` with a terminal in it. */
async function windowWithTerminal(folder: string): Promise<void> {
  await openWindow('harness', folder);
  await inWindow(folder, 'workbench.action.terminal.new');
}

describe('the code command in a terminal on the SSH host (card coverage-80)', function () {
  this.timeout(300_000);
  const command = editorProduct().applicationName;

  it('F-2508 AC-23 (c80-version): the command prints the editor’s version, its commit and the host’s architecture, three lines', async () => {
    await windowWithTerminal('c80-version');
    try {
      const machine = (await onHost('uname', '-m')).trim();
      const [version = '', commit, architecture, ...rest] = await linesOf(
        'c80-version',
        'VER',
        `${command} --version`,
      );
      deepStrictEqual(
        [/^\d+\.\d+\.\d+/.test(version), commit, architecture, rest],
        [
          true,
          editorProduct().commit,
          machine === 'x86_64'
            ? 'x64'
            : machine === 'aarch64'
              ? 'arm64'
              : machine,
          [],
        ],
      );
    } finally {
      await closeWindow('c80-version').catch(() => undefined);
    }
  });

  it('F-2508 AC-24 (c80-help): the help has the Options, Extensions Management and Troubleshooting sections and no remote, folder-uri or user-data-dir option', async () => {
    await windowWithTerminal('c80-help');
    try {
      const sections = await linesOf(
        'c80-help',
        'SEC',
        `${command} --help | grep -E '^(Options|Extensions Management|Troubleshooting)'`,
      );
      const forbidden = await linesOf(
        'c80-help',
        'BAD',
        `${command} --help | grep -cE -- '--remote|--folder-uri|--user-data-dir' || true`,
      );
      deepStrictEqual(
        [sections, forbidden],
        [['Options', 'Extensions Management', 'Troubleshooting'], ['0']],
      );
    } finally {
      await closeWindow('c80-help').catch(() => undefined);
    }
  });

  it('F-2508 AC-25 (c80-list): on a host with no extensions the list prints only the Extensions installed on SSH: <host>: line', async () => {
    await windowWithTerminal('c80-list');
    try {
      deepStrictEqual(
        await linesOf(
          'c80-list',
          'LIST',
          `${command} --list-extensions --show-versions`,
        ),
        ['Extensions installed on SSH: harness:'],
      );
    } finally {
      await closeWindow('c80-list').catch(() => undefined);
    }
  });
});
