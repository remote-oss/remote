import {deepStrictEqual} from 'node:assert';
import {readdirSync} from 'node:fs';
import path from 'node:path';
import {
  closeWindow,
  commandsOf,
  connectionLog,
  editorProduct,
  inWindow,
  startInWindow,
  onHost,
  openWindow,
  runShellTask,
  terminalNames,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {runFromPalette} from '../windows/palette.ts';
import {
  notificationCentre,
  notifications,
  pageText,
  paletteRows,
  toastFacts,
  typeInTerminal,
} from '../windows/renderer.ts';

/** The prefixes of the commands that the extension registers. */
const COMMAND_PREFIXES = ['remote-ssh.', 'remote-internal.', 'opensshremotes.'];

/**
 * The commands of each prefix, asked one after the other: the window reports each answer as an event, and asked together
 * the answers are taken for one another's, as the slower hosted runner shows.
 */
async function commandsOfPrefixes(window: string): Promise<string[]> {
  const commands: string[] = [];
  for (const prefix of COMMAND_PREFIXES) {
    commands.push(...(await commandsOf(window, prefix)));
  }
  return commands;
}

/** What the extension has shown or written in window `window`, as the criterion lists it. */
interface Footprint {
  toasts: string[];
  centre: string[];
  logLines: number;
  storage: string[];
  commands: string[];
  settings: string[];
  /** The palette titles of the extension, by the category its commands show. */
  palette: string[];
}

/** The titles of the extension's settings that the Settings editor of `window` lists. */
async function settingTitles(window: string): Promise<string[]> {
  await inWindow(
    window,
    'workbench.action.openSettings',
    '@ext:remote-oss.remote-ssh',
  );
  await new Promise(resolve => setTimeout(resolve, 3000));
  const lines = (await pageText(window)).split('\n');
  await inWindow(window, 'workbench.action.closeActiveEditor');
  return [
    ...new Set(lines.filter(line => /^Remote\.?\s?SSH/.test(line))),
  ].sort();
}

async function footprintOf(window: string): Promise<Footprint> {
  // The palette is read first: the notification centre, once open, keeps the keyboard.
  const palette = (await paletteRows(window, 'Remote-SSH:')).sort();
  return {
    toasts: await notifications(window),
    centre: await notificationCentre(window),
    logLines: connectionLog().length,
    storage: readdirSync(
      path.join(variable('HARNESS_USER_DATA'), 'User', 'globalStorage'),
    ).sort(),
    commands: await commandsOfPrefixes(window),
    settings: await settingTitles(window),
    palette,
  };
}

describe('the extension in the core flows of an SSH window (card connect-125)', function () {
  this.timeout(600_000);

  it('F-2508 AC-21 (c125-silent): after the terminal, the code command, the remote settings, a node program debugged to its end, a shell task and the Extensions view, the extension has shown no notification, logged no line, added nothing to the profile’s globalStorage, and registered no command or setting it lacked before', async () => {
    const folder = 'c125-silent';
    await onHost(
      'sh',
      '-c',
      `mkdir -p /home/harness/${folder} && echo note > /home/harness/${folder}/note.txt`,
    );
    const host = (await onHost('hostname')).trim();
    await onHost(
      'sh',
      '-c',
      `cat > /home/harness/${folder}/app.js <<'EOF'\nconsole.log('c125-ran-on-' + require('os').hostname());\nEOF\nmkdir -p /home/harness/${folder}/.vscode && cat > /home/harness/${folder}/.vscode/launch.json <<'EOF'\n{"version":"0.2.0","configurations":[{"type":"node","request":"launch","name":"Run app","program":"\${workspaceFolder}/app.js"}]}\nEOF`,
    );
    await openWindow('harness', folder);
    try {
      await inWindow(folder, 'workbench.action.terminal.new');
      await waitFor(
        'the first terminal',
        async () => (await terminalNames(folder)).length === 1,
        30_000,
      );
      await new Promise(resolve => setTimeout(resolve, 5000));
      const before = await footprintOf(folder);

      // 5.1: a second terminal.
      await inWindow(folder, 'workbench.action.terminal.new');
      await waitFor(
        'two terminals',
        async () => (await terminalNames(folder)).length === 2,
        30_000,
      );
      // 5.2: the code command opens a host file in the window.
      await typeInTerminal(
        folder,
        `${editorProduct().applicationName} /home/harness/${folder}/note.txt\n`,
      );
      await new Promise(resolve => setTimeout(resolve, 5000));
      // 5.3: the remote settings of the host.
      await runFromPalette(
        folder,
        'Preferences: Open Remote Settings (JSON) (SSH: harness)',
      );
      await new Promise(resolve => setTimeout(resolve, 3000));
      // 5.4: a node program is debugged to its end.
      // The start returns once the session is up, which on a slow host takes longer than a command may; the program's
      // output below is what the row waits for.
      await startInWindow(folder, 'workbench.action.debug.start');
      await waitFor(
        'the program to print in the Debug Console',
        async () => (await pageText(folder)).includes(`c125-ran-on-${host}`),
        90_000,
      );
      await new Promise(resolve => setTimeout(resolve, 5000));
      await inWindow(folder, 'workbench.action.debug.stop').catch(
        () => undefined,
      );
      // 5.5: a shell task runs to its end.
      const taskExit = await runShellTask(folder, 'echo c125-task');
      // 5.6: the Extensions view.
      await inWindow(folder, 'workbench.view.extensions');
      await new Promise(resolve => setTimeout(resolve, 5000));

      const after = await footprintOf(folder);
      // The toasts and the centre are read together, with the centre open, and none is the extension's.
      await notificationCentre(folder);
      const ours = (await toastFacts(folder)).filter(each =>
        each.source.includes('Remote - SSH'),
      );
      deepStrictEqual(
        [
          after,
          before.settings.length > 0,
          before.commands.length > 0,
          before.palette.length > 0,
          ours,
          taskExit,
        ],
        [before, true, true, true, [], 0],
      );
    } finally {
      await closeWindow(folder).catch(() => undefined);
    }
  });
});
