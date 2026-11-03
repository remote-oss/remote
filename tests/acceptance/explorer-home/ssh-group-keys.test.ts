/**
 * @fileoverview The two commands of the SSH group run by a keybinding with no argument (card coverage-102, #1809,
 * part 2): `remote-explorer.configureSsh` with the Remote Explorer never shown, and `remote-explorer.add` with it
 * shown or not. They write no file, open no window, and leave nothing open after Escape.
 */

import {deepStrictEqual} from 'node:assert';
import {existsSync, mkdirSync, readFileSync, rmSync} from 'node:fs';
import path from 'node:path';
import {bindKeys} from '../windows/explorer-folders.ts';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {sshFile, sshFolder, systemHosts} from '../windows/explorer-home.ts';
import {hostLabels, listing, VIEW} from '../windows/explorer-rows.ts';
import {
  closeWindow,
  inWindow,
  readUserSettings,
  restoreUserSettings,
  userSettings,
  variable,
  windowNames,
} from '../windows/harness.ts';
import {
  actionTooltip,
  clickRowLabel,
  dialogOf,
  paletteRows,
  pressControlAlt,
  pressEscape,
  quickPickFacts,
} from '../windows/renderer.ts';

/** The window kinds the keys are pressed in: the Remote Explorer never shown, and shown. */
type Shown = 'never' | 'shown';

/** A new folder window named `name` of the run, with the Remote Explorer shown or not. */
async function keyWindow(name: string, shown: Shown): Promise<string> {
  const folder = path.join(variable('HARNESS_RUN_FOLDER'), 'key-rows', name);
  mkdirSync(folder, {recursive: true});
  const window = await openFolderWindow(folder);
  if (shown === 'shown') {
    await inWindow(window, 'workbench.view.remote');
  }
  return window;
}

/** Whether the key of a command that surely opens a quick pick opens one in `window`: the keys reach the window. */
async function keysReach(window: string): Promise<boolean> {
  await pressControlAlt(window, 'l');
  await new Promise(resolve => setTimeout(resolve, 1_000));
  const opened = (await quickPickFacts(window)) !== undefined;
  await pressEscape(window);
  await new Promise(resolve => setTimeout(resolve, 1_000));
  return opened;
}

/** What the window and the machine show after `key` was pressed in `window` and Escape closed what it opened. */
async function afterKey(window: string, key: string): Promise<unknown> {
  const windows = windowNames();
  await pressControlAlt(window, key);
  await new Promise(resolve => setTimeout(resolve, 3_000));
  await pressEscape(window);
  await new Promise(resolve => setTimeout(resolve, 1_000));
  return {
    userFile: existsSync(path.join(sshFolder(), 'config')),
    windowsKept: JSON.stringify(windowNames()) === JSON.stringify(windows),
    dialog: await dialogOf(window),
    pick: await quickPickFacts(window),
    usable: (await paletteRows(window, 'Focus on Remotes')).length > 0,
  };
}

const AFTER_ESCAPE = {
  userFile: false,
  windowsKept: true,
  dialog: undefined,
  pick: undefined,
  usable: true,
};

describe('the commands of the SSH group run by a keybinding (card coverage-102, part 2)', function () {
  this.timeout(300_000);
  let savedSettings: string | undefined;
  let restoreKeys: (() => void) | undefined;

  beforeEach(async () => {
    savedSettings = readUserSettings();
    rmSync(sshFolder(), {recursive: true, force: true});
    await userSettings({'remote.SSH.configFile': ''});
    restoreKeys = await bindKeys([
      {key: 'ctrl+alt+j', command: 'remote-explorer.configureSsh'},
      {key: 'ctrl+alt+k', command: 'remote-explorer.add'},
      {key: 'ctrl+alt+l', command: 'workbench.action.showCommands'},
    ]);
  });

  afterEach(() => {
    restoreKeys?.();
    restoreUserSettings(savedSettings);
    rmSync(sshFolder(), {recursive: true, force: true});
  });

  it('F-5102 AC-23 (configure-key): the key of configureSsh with the Remote Explorer never shown writes no file, opens and closes no window, and leaves nothing open after Escape', async () => {
    const window = await keyWindow('configure-never', 'never');
    try {
      deepStrictEqual(
        [await keysReach(window), await afterKey(window, 'j')],
        [true, AFTER_ESCAPE],
      );
    } finally {
      await closeWindow(window);
    }
  });

  it('F-5102 AC-28 (add-key): the key of add, with the view shown or not, writes no file, opens and closes no window, leaves nothing open after Escape, and leaves the host list as it was', async () => {
    const never = await keyWindow('add-never', 'never');
    const shown = await keyWindow('add-shown', 'shown');
    try {
      await listing(shown, systemHosts());
      deepStrictEqual(
        [
          await keysReach(never),
          await afterKey(never, 'k'),
          await afterKey(shown, 'k'),
          await hostLabels(shown),
        ],
        [true, AFTER_ESCAPE, AFTER_ESCAPE, systemHosts()],
      );
    } finally {
      await closeWindow(shown);
      await closeWindow(never);
    }
  });

  it('F-5102 AC-30 (tooltips): with a key bound to each command, the tooltips of the two inline buttons read the title and the bound key in brackets', async () => {
    const window = await keyWindow('tooltips', 'shown');
    try {
      await listing(window, systemHosts());
      deepStrictEqual(
        [
          await actionTooltip(window, VIEW, 'SSH', 'Open SSH Config File'),
          await actionTooltip(window, VIEW, 'SSH', 'New Remote'),
        ],
        ['Open SSH Config File (Ctrl+Alt+J)', 'New Remote (Ctrl+Alt+K)'],
      );
    } finally {
      await closeWindow(window);
    }
  });

  it('F-5102 AC-32 (wrong-row): with a host row focused, the keys of both commands, cancelled with Escape, write no file, open and close no window, leave nothing open and keep the window usable', async () => {
    sshFile('config', ['Host user-one']);
    const window = await keyWindow('wrong-row', 'shown');
    try {
      await listing(window, ['user-one', ...systemHosts()]);
      await clickRowLabel(window, VIEW, 'user-one');
      const before = JSON.stringify(
        readFileSync(path.join(sshFolder(), 'config')),
      );
      const results: unknown[] = [await keysReach(window)];
      await clickRowLabel(window, VIEW, 'user-one');
      results.push(await afterKey(window, 'j'));
      await clickRowLabel(window, VIEW, 'user-one');
      results.push(await afterKey(window, 'k'));
      deepStrictEqual(
        [
          results,
          JSON.stringify(readFileSync(path.join(sshFolder(), 'config'))),
        ],
        [
          [
            true,
            {...AFTER_ESCAPE, userFile: true},
            {...AFTER_ESCAPE, userFile: true},
          ],
          before,
        ],
      );
    } finally {
      await closeWindow(window);
    }
  });
});
