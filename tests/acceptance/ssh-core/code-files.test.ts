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
  try {
    await waitFor(
      `the terminal of ${window} to print`,
      async () => {
        lines = (await terminalText(window)).split('\n');
        return wanted(lines);
      },
      40_000,
    );
  } catch (caught) {
    throw new Error(
      `${String(caught)}; the terminal's last lines: ${JSON.stringify(lines.slice(-12))}`,
      {cause: caught},
    );
  }
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
        `the terminal's last lines: ${JSON.stringify(lines.slice(-12))}`,
      );
    } finally {
      await closeWindow('c80-wait').catch(() => undefined);
    }
  });

  it('c2433-host: the host shell and whether it asks the terminal for the cursor at its prompt (measurement)', async () => {
    const facts = await onHost(
      'sh',
      '-c',
      `ls -l /bin/sh; command -v script || echo noscript; busybox 2>&1 | head -1; for shell in "sh -i" "ash -i" "bash --norc -i"; do printf "%s: " "$shell"; printf 'exit\\n' | script -qefc "$shell" /dev/null 2>&1 | od -An -c | tr -d ' \\n' | grep -o '033\\[6n' | head -1 | sed 's/^$/none/' ; echo; done`,
    );
    throw new Error(`HOST FACTS: ${JSON.stringify(facts)}`);
  });

  it('F-2508 AC-26 (c80-stdin-1): text piped into code - prints the temp file it reads it into and returns, with no notification', async () => {
    await windowWithTerminal('c80-stdin-1');
    try {
      await typeInTerminal(
        'c80-stdin-1',
        `echo piped | ${command} - ; echo DONE_$?\n`,
      );
      const lines = await linesUntil(
        'c80-stdin-1',
        each =>
          each.some(line => /^DONE_\d/.test(line)) &&
          each.some(line => line.startsWith('Reading from stdin via: /')),
      );
      deepStrictEqual(
        [
          lines.filter(line => line.startsWith('Reading from stdin via: /'))
            .length,
          lines.find(line => /^DONE_\d/.test(line)),
          await notificationCentre('c80-stdin-1'),
        ],
        [1, 'DONE_0', []],
        `the terminal's last lines: ${JSON.stringify(lines.slice(-8))}`,
      );
    } finally {
      await closeWindow('c80-stdin-1').catch(() => undefined);
    }
  });

  it('F-2508 AC-26 (c80-stdin-2): text piped into code - prints the temp file it reads it into and returns, with no notification', async () => {
    await windowWithTerminal('c80-stdin-2');
    try {
      await typeInTerminal(
        'c80-stdin-2',
        `echo piped | ${command} - ; echo DONE_$?\n`,
      );
      const lines = await linesUntil(
        'c80-stdin-2',
        each =>
          each.some(line => /^DONE_\d/.test(line)) &&
          each.some(line => line.startsWith('Reading from stdin via: /')),
      );
      deepStrictEqual(
        [
          lines.filter(line => line.startsWith('Reading from stdin via: /'))
            .length,
          lines.find(line => /^DONE_\d/.test(line)),
          await notificationCentre('c80-stdin-2'),
        ],
        [1, 'DONE_0', []],
        `the terminal's last lines: ${JSON.stringify(lines.slice(-8))}`,
      );
    } finally {
      await closeWindow('c80-stdin-2').catch(() => undefined);
    }
  });

  it('F-2508 AC-26 (c80-stdin-3): text piped into code - prints the temp file it reads it into and returns, with no notification', async () => {
    await windowWithTerminal('c80-stdin-3');
    try {
      await typeInTerminal(
        'c80-stdin-3',
        `echo piped | ${command} - ; echo DONE_$?\n`,
      );
      const lines = await linesUntil(
        'c80-stdin-3',
        each =>
          each.some(line => /^DONE_\d/.test(line)) &&
          each.some(line => line.startsWith('Reading from stdin via: /')),
      );
      deepStrictEqual(
        [
          lines.filter(line => line.startsWith('Reading from stdin via: /'))
            .length,
          lines.find(line => /^DONE_\d/.test(line)),
          await notificationCentre('c80-stdin-3'),
        ],
        [1, 'DONE_0', []],
        `the terminal's last lines: ${JSON.stringify(lines.slice(-8))}`,
      );
    } finally {
      await closeWindow('c80-stdin-3').catch(() => undefined);
    }
  });

  it('F-2508 AC-26 (c80-stdin-4): text piped into code - prints the temp file it reads it into and returns, with no notification', async () => {
    await windowWithTerminal('c80-stdin-4');
    try {
      await typeInTerminal(
        'c80-stdin-4',
        `echo piped | ${command} - ; echo DONE_$?\n`,
      );
      const lines = await linesUntil(
        'c80-stdin-4',
        each =>
          each.some(line => /^DONE_\d/.test(line)) &&
          each.some(line => line.startsWith('Reading from stdin via: /')),
      );
      deepStrictEqual(
        [
          lines.filter(line => line.startsWith('Reading from stdin via: /'))
            .length,
          lines.find(line => /^DONE_\d/.test(line)),
          await notificationCentre('c80-stdin-4'),
        ],
        [1, 'DONE_0', []],
        `the terminal's last lines: ${JSON.stringify(lines.slice(-8))}`,
      );
    } finally {
      await closeWindow('c80-stdin-4').catch(() => undefined);
    }
  });

  it('F-2508 AC-26 (c80-stdin-5): text piped into code - prints the temp file it reads it into and returns, with no notification', async () => {
    await windowWithTerminal('c80-stdin-5');
    try {
      await typeInTerminal(
        'c80-stdin-5',
        `echo piped | ${command} - ; echo DONE_$?\n`,
      );
      const lines = await linesUntil(
        'c80-stdin-5',
        each =>
          each.some(line => /^DONE_\d/.test(line)) &&
          each.some(line => line.startsWith('Reading from stdin via: /')),
      );
      deepStrictEqual(
        [
          lines.filter(line => line.startsWith('Reading from stdin via: /'))
            .length,
          lines.find(line => /^DONE_\d/.test(line)),
          await notificationCentre('c80-stdin-5'),
        ],
        [1, 'DONE_0', []],
        `the terminal's last lines: ${JSON.stringify(lines.slice(-8))}`,
      );
    } finally {
      await closeWindow('c80-stdin-5').catch(() => undefined);
    }
  });

  it('F-2508 AC-26 (c80-stdin-6): text piped into code - prints the temp file it reads it into and returns, with no notification', async () => {
    await windowWithTerminal('c80-stdin-6');
    try {
      await typeInTerminal(
        'c80-stdin-6',
        `echo piped | ${command} - ; echo DONE_$?\n`,
      );
      const lines = await linesUntil(
        'c80-stdin-6',
        each =>
          each.some(line => /^DONE_\d/.test(line)) &&
          each.some(line => line.startsWith('Reading from stdin via: /')),
      );
      deepStrictEqual(
        [
          lines.filter(line => line.startsWith('Reading from stdin via: /'))
            .length,
          lines.find(line => /^DONE_\d/.test(line)),
          await notificationCentre('c80-stdin-6'),
        ],
        [1, 'DONE_0', []],
        `the terminal's last lines: ${JSON.stringify(lines.slice(-8))}`,
      );
    } finally {
      await closeWindow('c80-stdin-6').catch(() => undefined);
    }
  });

  it('F-2508 AC-26 (c80-stdin-7): text piped into code - prints the temp file it reads it into and returns, with no notification', async () => {
    await windowWithTerminal('c80-stdin-7');
    try {
      await typeInTerminal(
        'c80-stdin-7',
        `echo piped | ${command} - ; echo DONE_$?\n`,
      );
      const lines = await linesUntil(
        'c80-stdin-7',
        each =>
          each.some(line => /^DONE_\d/.test(line)) &&
          each.some(line => line.startsWith('Reading from stdin via: /')),
      );
      deepStrictEqual(
        [
          lines.filter(line => line.startsWith('Reading from stdin via: /'))
            .length,
          lines.find(line => /^DONE_\d/.test(line)),
          await notificationCentre('c80-stdin-7'),
        ],
        [1, 'DONE_0', []],
        `the terminal's last lines: ${JSON.stringify(lines.slice(-8))}`,
      );
    } finally {
      await closeWindow('c80-stdin-7').catch(() => undefined);
    }
  });

  it('F-2508 AC-26 (c80-stdin-8): text piped into code - prints the temp file it reads it into and returns, with no notification', async () => {
    await windowWithTerminal('c80-stdin-8');
    try {
      await typeInTerminal(
        'c80-stdin-8',
        `echo piped | ${command} - ; echo DONE_$?\n`,
      );
      const lines = await linesUntil(
        'c80-stdin-8',
        each =>
          each.some(line => /^DONE_\d/.test(line)) &&
          each.some(line => line.startsWith('Reading from stdin via: /')),
      );
      deepStrictEqual(
        [
          lines.filter(line => line.startsWith('Reading from stdin via: /'))
            .length,
          lines.find(line => /^DONE_\d/.test(line)),
          await notificationCentre('c80-stdin-8'),
        ],
        [1, 'DONE_0', []],
        `the terminal's last lines: ${JSON.stringify(lines.slice(-8))}`,
      );
    } finally {
      await closeWindow('c80-stdin-8').catch(() => undefined);
    }
  });

  it('F-2508 AC-26 (c80-stdin-9): text piped into code - prints the temp file it reads it into and returns, with no notification', async () => {
    await windowWithTerminal('c80-stdin-9');
    try {
      await typeInTerminal(
        'c80-stdin-9',
        `echo piped | ${command} - ; echo DONE_$?\n`,
      );
      const lines = await linesUntil(
        'c80-stdin-9',
        each =>
          each.some(line => /^DONE_\d/.test(line)) &&
          each.some(line => line.startsWith('Reading from stdin via: /')),
      );
      deepStrictEqual(
        [
          lines.filter(line => line.startsWith('Reading from stdin via: /'))
            .length,
          lines.find(line => /^DONE_\d/.test(line)),
          await notificationCentre('c80-stdin-9'),
        ],
        [1, 'DONE_0', []],
        `the terminal's last lines: ${JSON.stringify(lines.slice(-8))}`,
      );
    } finally {
      await closeWindow('c80-stdin-9').catch(() => undefined);
    }
  });

  it('F-2508 AC-26 (c80-stdin-10): text piped into code - prints the temp file it reads it into and returns, with no notification', async () => {
    await windowWithTerminal('c80-stdin-10');
    try {
      await typeInTerminal(
        'c80-stdin-10',
        `echo piped | ${command} - ; echo DONE_$?\n`,
      );
      const lines = await linesUntil(
        'c80-stdin-10',
        each =>
          each.some(line => /^DONE_\d/.test(line)) &&
          each.some(line => line.startsWith('Reading from stdin via: /')),
      );
      deepStrictEqual(
        [
          lines.filter(line => line.startsWith('Reading from stdin via: /'))
            .length,
          lines.find(line => /^DONE_\d/.test(line)),
          await notificationCentre('c80-stdin-10'),
        ],
        [1, 'DONE_0', []],
        `the terminal's last lines: ${JSON.stringify(lines.slice(-8))}`,
      );
    } finally {
      await closeWindow('c80-stdin-10').catch(() => undefined);
    }
  });

  it('F-2508 AC-26 (c80-stdin-11): text piped into code - prints the temp file it reads it into and returns, with no notification', async () => {
    await windowWithTerminal('c80-stdin-11');
    try {
      await typeInTerminal(
        'c80-stdin-11',
        `echo piped | ${command} - ; echo DONE_$?\n`,
      );
      const lines = await linesUntil(
        'c80-stdin-11',
        each =>
          each.some(line => /^DONE_\d/.test(line)) &&
          each.some(line => line.startsWith('Reading from stdin via: /')),
      );
      deepStrictEqual(
        [
          lines.filter(line => line.startsWith('Reading from stdin via: /'))
            .length,
          lines.find(line => /^DONE_\d/.test(line)),
          await notificationCentre('c80-stdin-11'),
        ],
        [1, 'DONE_0', []],
        `the terminal's last lines: ${JSON.stringify(lines.slice(-8))}`,
      );
    } finally {
      await closeWindow('c80-stdin-11').catch(() => undefined);
    }
  });

  it('F-2508 AC-26 (c80-stdin-12): text piped into code - prints the temp file it reads it into and returns, with no notification', async () => {
    await windowWithTerminal('c80-stdin-12');
    try {
      await typeInTerminal(
        'c80-stdin-12',
        `echo piped | ${command} - ; echo DONE_$?\n`,
      );
      const lines = await linesUntil(
        'c80-stdin-12',
        each =>
          each.some(line => /^DONE_\d/.test(line)) &&
          each.some(line => line.startsWith('Reading from stdin via: /')),
      );
      deepStrictEqual(
        [
          lines.filter(line => line.startsWith('Reading from stdin via: /'))
            .length,
          lines.find(line => /^DONE_\d/.test(line)),
          await notificationCentre('c80-stdin-12'),
        ],
        [1, 'DONE_0', []],
        `the terminal's last lines: ${JSON.stringify(lines.slice(-8))}`,
      );
    } finally {
      await closeWindow('c80-stdin-12').catch(() => undefined);
    }
  });

  it('F-2508 AC-26 (c80-stdin-13): text piped into code - prints the temp file it reads it into and returns, with no notification', async () => {
    await windowWithTerminal('c80-stdin-13');
    try {
      await typeInTerminal(
        'c80-stdin-13',
        `echo piped | ${command} - ; echo DONE_$?\n`,
      );
      const lines = await linesUntil(
        'c80-stdin-13',
        each =>
          each.some(line => /^DONE_\d/.test(line)) &&
          each.some(line => line.startsWith('Reading from stdin via: /')),
      );
      deepStrictEqual(
        [
          lines.filter(line => line.startsWith('Reading from stdin via: /'))
            .length,
          lines.find(line => /^DONE_\d/.test(line)),
          await notificationCentre('c80-stdin-13'),
        ],
        [1, 'DONE_0', []],
        `the terminal's last lines: ${JSON.stringify(lines.slice(-8))}`,
      );
    } finally {
      await closeWindow('c80-stdin-13').catch(() => undefined);
    }
  });

  it('F-2508 AC-26 (c80-stdin-14): text piped into code - prints the temp file it reads it into and returns, with no notification', async () => {
    await windowWithTerminal('c80-stdin-14');
    try {
      await typeInTerminal(
        'c80-stdin-14',
        `echo piped | ${command} - ; echo DONE_$?\n`,
      );
      const lines = await linesUntil(
        'c80-stdin-14',
        each =>
          each.some(line => /^DONE_\d/.test(line)) &&
          each.some(line => line.startsWith('Reading from stdin via: /')),
      );
      deepStrictEqual(
        [
          lines.filter(line => line.startsWith('Reading from stdin via: /'))
            .length,
          lines.find(line => /^DONE_\d/.test(line)),
          await notificationCentre('c80-stdin-14'),
        ],
        [1, 'DONE_0', []],
        `the terminal's last lines: ${JSON.stringify(lines.slice(-8))}`,
      );
    } finally {
      await closeWindow('c80-stdin-14').catch(() => undefined);
    }
  });

  it('F-2508 AC-26 (c80-stdin-15): text piped into code - prints the temp file it reads it into and returns, with no notification', async () => {
    await windowWithTerminal('c80-stdin-15');
    try {
      await typeInTerminal(
        'c80-stdin-15',
        `echo piped | ${command} - ; echo DONE_$?\n`,
      );
      const lines = await linesUntil(
        'c80-stdin-15',
        each =>
          each.some(line => /^DONE_\d/.test(line)) &&
          each.some(line => line.startsWith('Reading from stdin via: /')),
      );
      deepStrictEqual(
        [
          lines.filter(line => line.startsWith('Reading from stdin via: /'))
            .length,
          lines.find(line => /^DONE_\d/.test(line)),
          await notificationCentre('c80-stdin-15'),
        ],
        [1, 'DONE_0', []],
        `the terminal's last lines: ${JSON.stringify(lines.slice(-8))}`,
      );
    } finally {
      await closeWindow('c80-stdin-15').catch(() => undefined);
    }
  });

  it('F-2508 AC-26 (c80-stdin-16): text piped into code - prints the temp file it reads it into and returns, with no notification', async () => {
    await windowWithTerminal('c80-stdin-16');
    try {
      await typeInTerminal(
        'c80-stdin-16',
        `echo piped | ${command} - ; echo DONE_$?\n`,
      );
      const lines = await linesUntil(
        'c80-stdin-16',
        each =>
          each.some(line => /^DONE_\d/.test(line)) &&
          each.some(line => line.startsWith('Reading from stdin via: /')),
      );
      deepStrictEqual(
        [
          lines.filter(line => line.startsWith('Reading from stdin via: /'))
            .length,
          lines.find(line => /^DONE_\d/.test(line)),
          await notificationCentre('c80-stdin-16'),
        ],
        [1, 'DONE_0', []],
        `the terminal's last lines: ${JSON.stringify(lines.slice(-8))}`,
      );
    } finally {
      await closeWindow('c80-stdin-16').catch(() => undefined);
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
