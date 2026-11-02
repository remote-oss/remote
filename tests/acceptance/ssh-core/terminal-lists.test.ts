import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  editorProduct,
  inWindow,
  onHost,
  openWindow,
  reloadWindow,
  terminalNames,
  waitFor,
} from '../windows/harness.ts';
import {runFromPalette} from '../windows/palette.ts';
import {
  chooseQuickPickRow,
  pageText,
  pressEscape,
  quickPickGroups,
  quickPickRows,
  terminalText,
  waitForQuickPick,
} from '../windows/renderer.ts';

/** Writes `text` to `path` on the host, making the folder first. */
async function writeOnHost(path: string, text: string): Promise<void> {
  await onHost(
    'sh',
    '-c',
    `mkdir -p "$(dirname '${path}')" && cat > '${path}' <<'EOF'\n${text}\nEOF`,
  );
}

/**
 * Opens window `folder` on the host and creates its first terminal: the editor's lists of terminal profiles, debug
 * configurations and tasks stay empty in a remote window until it has used its terminals, whatever the extension does.
 */
async function windowWithTerminal(folder: string): Promise<void> {
  await openWindow('harness', folder);
  await inWindow(folder, 'workbench.action.terminal.new');
  await waitFor(
    'the first terminal',
    async () => (await terminalNames(folder)).length === 1,
    30_000,
  );
  await new Promise(resolve => setTimeout(resolve, 4000));
}

/** Waits until the quick pick of window `folder` has rows, and gives the label of each with the heading of the group it starts. */
async function groupsOf(folder: string): Promise<Array<[string, string]>> {
  await waitFor(
    'the rows of the pick',
    async () => (await quickPickGroups(folder)).length > 0,
    30_000,
  );
  return quickPickGroups(folder);
}

describe('the lists and the reload of an SSH window that uses its terminals (card connect-125)', function () {
  this.timeout(300_000);

  it('F-2508 AC-14 (c125-profiles): Select Default Profile lists the host’s shells, each detected one with a path that exists on the host', async () => {
    await windowWithTerminal('c125-profiles');
    try {
      await runFromPalette('c125-profiles', 'Terminal: Select Default Profile');
      await waitForQuickPick('c125-profiles', 30_000);
      await waitFor(
        'the profiles',
        async () => (await quickPickRows('c125-profiles')).length > 0,
        30_000,
      );
      const rows = await quickPickRows('c125-profiles');
      await pressEscape('c125-profiles');
      const detected = rows
        .map(entry => entry.description)
        .filter(description => description.startsWith('/'));
      const missing = (
        await onHost(
          'sh',
          '-c',
          `for path in ${detected.join(' ')}; do [ -e "$path" ] || echo "$path"; done`,
        )
      ).trim();
      deepStrictEqual(
        [
          missing,
          ['/bin/ash', '/bin/sh', '/bin/csh'].every(path =>
            detected.includes(path),
          ),
        ],
        ['', true],
      );
    } finally {
      await closeWindow('c125-profiles').catch(() => undefined);
    }
  });

  it('F-2508 AC-28 (c125-select-start): Select and Start Debugging lists the configuration used before under Most Recent, the other under launch.json, then Node.js... under contributed and Add Configuration... under configure', async () => {
    const root = '/home/harness/c125-select';
    await writeOnHost(`${root}/app.js`, "console.log('c125');");
    await writeOnHost(
      `${root}/.vscode/launch.json`,
      JSON.stringify({
        version: '0.2.0',
        configurations: ['Run app', 'Other app'].map(name => ({
          type: 'node',
          request: 'launch',
          name,
          program: '${workspaceFolder}/app.js',
        })),
      }),
    );
    await windowWithTerminal('c125-select');
    try {
      inWindow('c125-select', 'workbench.action.debug.selectandstart').catch(
        () => undefined,
      );
      await groupsOf('c125-select');
      await chooseQuickPickRow('c125-select', 'Run app');
      await waitFor(
        'the configuration to have run',
        async () =>
          (await pageText('c125-select')).includes('Debugging started'),
        60_000,
      );
      await inWindow('c125-select', 'workbench.action.debug.stop');
      await new Promise(resolve => setTimeout(resolve, 3000));
      inWindow('c125-select', 'workbench.action.debug.selectandstart').catch(
        () => undefined,
      );
      const groups = await groupsOf('c125-select');
      await pressEscape('c125-select');
      deepStrictEqual(groups, [
        ['Run app', 'Most Recent'],
        ['Other app', 'launch.json'],
        ['Node.js...', 'contributed'],
        ['Add Configuration...', 'configure'],
      ]);
    } finally {
      await closeWindow('c125-select').catch(() => undefined);
    }
  });

  it('F-2508 AC-29 (c125-task): Run Task runs a shell task of the host in a terminal named after it, which shows the host’s name between the two lines', async () => {
    await writeOnHost(
      '/home/harness/c125-task/.vscode/tasks.json',
      JSON.stringify({
        version: '2.0.0',
        tasks: [
          {
            label: 'where',
            type: 'shell',
            command: 'echo "TASKHOST:$(hostname)"',
          },
        ],
      }),
    );
    await windowWithTerminal('c125-task');
    try {
      inWindow('c125-task', 'workbench.action.tasks.runTask').catch(
        () => undefined,
      );
      await groupsOf('c125-task');
      await chooseQuickPickRow('c125-task', 'where');
      await groupsOf('c125-task');
      await chooseQuickPickRow(
        'c125-task',
        'Continue without scanning the task output',
      );
      await waitFor(
        'the task’s terminal to have ended its run',
        async () =>
          (await terminalText('c125-task')).includes(
            'Terminal will be reused by tasks, press any key to close it.',
          ),
        60_000,
      );
      const host = (await onHost('hostname')).trim();
      const text = await terminalText('c125-task');
      const start = text.indexOf('Executing task: ');
      const output = text.indexOf(`TASKHOST:${host}`);
      const end = text.indexOf(
        'Terminal will be reused by tasks, press any key to close it.',
      );
      deepStrictEqual(
        [
          (await terminalNames('c125-task')).includes('where'),
          start >= 0 && start < output && output < end,
        ],
        [true, true],
      );
    } finally {
      await closeWindow('c125-task').catch(() => undefined);
    }
  });

  it('F-2508 AC-17 (c125-reload): after Reload Window the window is connected again and its terminals are revived', async () => {
    await windowWithTerminal('c125-reload');
    try {
      await inWindow('c125-reload', 'workbench.action.terminal.new');
      await waitFor(
        'two terminals',
        async () => (await terminalNames('c125-reload')).length === 2,
        30_000,
      );
      await new Promise(resolve => setTimeout(resolve, 5000));
      const before = await terminalNames('c125-reload');
      await reloadWindow('c125-reload');
      await waitFor(
        'the terminals to be revived',
        async () => (await terminalNames('c125-reload')).length === 2,
        60_000,
      );
      deepStrictEqual(await terminalNames('c125-reload'), before);
    } finally {
      await closeWindow('c125-reload').catch(() => undefined);
    }
  });

  it('F-2508 AC-36 (c125-zsh-default): terminal.integrated.defaultProfile.linux set to zsh in the remote settings of a host that has zsh gives a new terminal whose tab is zsh', async () => {
    const file = `/home/harness/${editorProduct().serverDataFolderName}/data/Machine/settings.json`;
    await onHost(
      'sh',
      '-c',
      `mkdir -p "$(dirname '${file}')" && printf '%s' '{"terminal.integrated.defaultProfile.linux": "zsh"}' > '${file}'`,
    );
    await openWindow('harness', 'c125-zsh');
    try {
      await inWindow('c125-zsh', 'workbench.action.terminal.new');
      await waitFor(
        'a tab named zsh',
        async () => (await terminalNames('c125-zsh')).includes('zsh'),
        30_000,
      );
      deepStrictEqual(await terminalNames('c125-zsh'), ['zsh']);
    } finally {
      await closeWindow('c125-zsh').catch(() => undefined);
      await onHost('rm', '-f', file);
    }
  });
});
