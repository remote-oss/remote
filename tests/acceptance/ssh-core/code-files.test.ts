import {deepStrictEqual} from 'node:assert';
import {
  activeEditorOf,
  closeWindow,
  editorProduct,
  inWindow,
  onHost,
  openWindow,
  waitFor,
  windowEvents,
  windowState,
} from '../windows/harness.ts';
import {
  editorHasFocus,
  notificationCentre,
  terminalText,
  typeInTerminal,
  windowTitle,
} from '../windows/renderer.ts';

/** Opens a window on the host in a new folder `folder` with a terminal in it. */
async function windowWithTerminal(folder: string): Promise<void> {
  await openWindow('harness', folder);
  await inWindow(folder, 'workbench.action.terminal.new');
}

/** Waits until the terminal of `window` has printed a line that satisfies `wanted`, and gives the lines. */
async function linesUntil(
  window: string,
  wanted: (lines: string[]) => boolean,
): Promise<string[]> {
  let lines: string[] = [];
  await waitFor(
    `the terminal of ${window} to print`,
    async () => {
      lines = (await terminalText(window)).split('\n');
      return wanted(lines);
    },
    40_000,
  );
  return lines;
}

describe('the code command opens host files in the window (card coverage-80)', function () {
  this.timeout(300_000);
  const command = editorProduct().applicationName;

  it('F-2508 AC-4 (c80-open): code <file> opens the host file as the window’s active tab with the keyboard focus in it', async () => {
    await windowWithTerminal('c80-open');
    try {
      await onHost('sh', '-c', 'echo hello > /home/harness/c80-open/a.txt');
      await typeInTerminal(
        'c80-open',
        `${command} /home/harness/c80-open/a.txt\n`,
      );
      await waitFor(
        'the file to be the active editor',
        async () =>
          (await activeEditorOf('c80-open')) === '/home/harness/c80-open/a.txt',
        30_000,
      );
      deepStrictEqual(await editorHasFocus('c80-open'), true);
    } finally {
      await closeWindow('c80-open').catch(() => undefined);
    }
  });

  it('F-2508 AC-5 (c80-wait): code --wait <new file> does not return while its tab is open, and returns with status 0 once the file is saved and closed, the file being on the host', async () => {
    await windowWithTerminal('c80-wait');
    const file = '/home/harness/c80-wait/new.txt';
    try {
      await typeInTerminal(
        'c80-wait',
        `${command} --wait ${file}; echo EXIT_$?\n`,
      );
      await waitFor(
        'the new file to be the active editor',
        async () => (await activeEditorOf('c80-wait')) === file,
        30_000,
      );
      await new Promise(resolve => setTimeout(resolve, 2000));
      const whileOpen = (await terminalText('c80-wait'))
        .split('\n')
        .some(line => /^EXIT_\d/.test(line));
      await inWindow(
        'c80-wait',
        'acceptance.agent.writeActiveEditor',
        'saved text\n',
      );
      await inWindow('c80-wait', 'workbench.action.closeActiveEditor').catch(
        () => undefined,
      );
      const lines = await linesUntil('c80-wait', each =>
        each.some(line => /^EXIT_\d/.test(line)),
      );
      deepStrictEqual(
        [
          whileOpen,
          lines.find(line => /^EXIT_\d/.test(line)),
          (await onHost('cat', file)).trim(),
        ],
        [false, 'EXIT_0', 'saved text'],
      );
    } finally {
      await closeWindow('c80-wait').catch(() => undefined);
    }
  });

  it('F-2508 AC-26 (c80-stdin): text piped into code - prints the temp file it reads it into and returns, with no notification', async () => {
    await windowWithTerminal('c80-stdin');
    try {
      await typeInTerminal(
        'c80-stdin',
        `echo piped | ${command} - ; echo DONE_$?\n`,
      );
      const lines = await linesUntil('c80-stdin', each =>
        each.some(line => /^DONE_\d/.test(line)),
      );
      deepStrictEqual(
        [
          lines.filter(line => line.startsWith('Reading from stdin via: /'))
            .length,
          lines.find(line => /^DONE_\d/.test(line)),
          await notificationCentre('c80-stdin'),
        ],
        [1, 'DONE_0', []],
      );
    } finally {
      await closeWindow('c80-stdin').catch(() => undefined);
    }
  });

  it('F-2508 AC-20 (c80-new-window): code -n <host folder> opens a new window on the same host and that folder', async () => {
    await windowWithTerminal('c80-new-window');
    await onHost('mkdir', '-p', '/home/harness/c80-other');
    try {
      await typeInTerminal(
        'c80-new-window',
        `${command} -n /home/harness/c80-other\n`,
      );
      await waitFor(
        'the new window to activate its agent',
        () =>
          windowEvents('c80-other').some(event => event.event === 'activated'),
        60_000,
      );
      const state = await windowState('c80-other');
      deepStrictEqual(
        [state.remoteAuthority, state.folders, await windowTitle('c80-other')],
        [
          'ssh-remote+harness',
          ['vscode-remote://ssh-remote%2Bharness/home/harness/c80-other'],
          '[c80-other [SSH: harness]]',
        ],
      );
    } finally {
      await closeWindow('c80-other').catch(() => undefined);
      await closeWindow('c80-new-window').catch(() => undefined);
    }
  });

  it('F-2508 AC-6 (c80-commit): with EDITOR set to code --wait, git commit opens COMMIT_EDITMSG in the window, and saving and closing it creates the commit on the host', async () => {
    await windowWithTerminal('c80-commit');
    try {
      await onHost(
        'sh',
        '-c',
        'cd /home/harness/c80-commit && git init -q && git config user.email c80@example.test && git config user.name c80 && echo x > file.txt && git add file.txt',
      );
      await typeInTerminal(
        'c80-commit',
        `export EDITOR="${command} --wait"; git commit; echo EXIT_$?\n`,
      );
      await waitFor(
        'COMMIT_EDITMSG to be the active editor',
        async () =>
          (await activeEditorOf('c80-commit'))?.endsWith('COMMIT_EDITMSG') ===
          true,
        30_000,
      );
      await inWindow(
        'c80-commit',
        'acceptance.agent.writeActiveEditor',
        'c80 commit message\n',
      );
      await inWindow('c80-commit', 'workbench.action.closeActiveEditor').catch(
        () => undefined,
      );
      const lines = await linesUntil('c80-commit', each =>
        each.some(line => /^EXIT_\d/.test(line)),
      );
      deepStrictEqual(
        [
          lines.find(line => /^EXIT_\d/.test(line)),
          (
            await onHost(
              'git',
              '-C',
              '/home/harness/c80-commit',
              'log',
              '--format=%s',
            )
          ).trim(),
        ],
        ['EXIT_0', 'c80 commit message'],
      );
    } finally {
      await closeWindow('c80-commit').catch(() => undefined);
    }
  });
});
