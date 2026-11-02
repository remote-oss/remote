import {deepStrictEqual} from 'node:assert';
import {readdirSync} from 'node:fs';
import path from 'node:path';
import {
  closeWindow,
  commandsOf,
  connectionLog,
  editorProduct,
  inWindow,
  onHost,
  openWindow,
  terminalNames,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {runFromPalette} from '../windows/palette.ts';
import {
  notificationCentre,
  notifications,
  pageText,
  pressEscape,
  typeInTerminal,
  waitForQuickPick,
} from '../windows/renderer.ts';

/** The prefixes of the commands that the extension registers. */
const COMMAND_PREFIXES = ['remote-ssh.', 'remote-internal.', 'opensshremotes.'];

/** What the extension has shown or written in window `window`, as the criterion lists it. */
interface Footprint {
  toasts: string[];
  centre: string[];
  logLines: number;
  storage: string[];
  commands: string[];
  settings: string[];
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
  return {
    toasts: await notifications(window),
    centre: await notificationCentre(window),
    logLines: connectionLog().length,
    storage: readdirSync(
      path.join(variable('HARNESS_USER_DATA'), 'User', 'globalStorage'),
    ).sort(),
    commands: (
      await Promise.all(
        COMMAND_PREFIXES.map(prefix => commandsOf(window, prefix)),
      )
    ).flat(),
    settings: await settingTitles(window),
  };
}

describe('the extension in the core flows of an SSH window (card connect-125)', function () {
  this.timeout(600_000);

  it('F-2508 AC-21 (c125-silent): after the terminal, the code command, the remote settings, the debug and task pickers and the Extensions view, the extension has shown no notification, logged no line, added nothing to the profile’s globalStorage, and registered no command or setting it lacked before', async () => {
    const folder = 'c125-silent';
    await onHost(
      'sh',
      '-c',
      `mkdir -p /home/harness/${folder} && echo note > /home/harness/${folder}/note.txt`,
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
      // 5.4 and 5.5: the debug and task pickers, left with Escape.
      for (const command of [
        'workbench.action.debug.selectandstart',
        'workbench.action.tasks.runTask',
      ]) {
        void inWindow(folder, command).catch(() => undefined);
        await waitForQuickPick(folder, 30_000).catch(() => undefined);
        await pressEscape(folder).catch(() => undefined);
      }
      // 5.6: the Extensions view.
      await inWindow(folder, 'workbench.view.extensions');
      await new Promise(resolve => setTimeout(resolve, 5000));

      const after = await footprintOf(folder);
      deepStrictEqual(
        [after, before.settings.length > 0, before.commands.length > 0],
        [before, true, true],
      );
    } finally {
      await closeWindow(folder).catch(() => undefined);
    }
  });
});
