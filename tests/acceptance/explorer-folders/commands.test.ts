/**
 * @fileoverview F-5002 (card coverage-102, #1809, part 3): the commands of the view invoked out of their context, by a
 * keybinding with no argument, with an argument that is no row, or with a row focused. They are safe: no window opens,
 * closes or reloads, no file is written, no history entry is removed, nothing modal appears and the window accepts input
 * afterwards.
 */

import {deepStrictEqual} from 'node:assert';
import {inWindow, reloadWindow} from '../windows/harness.ts';
import {VIEW} from '../windows/explorer-rows.ts';
import {
  bindKeys,
  closeIfOpen,
  folderRowsOf,
  foldersSettled,
  HOME,
  viewWindow,
  visit,
} from '../windows/explorer-folders.ts';
import {
  COMMANDS,
  CONTROL_COMMAND,
  CONTROL_KEY,
  FOLDERS,
  HOST,
  PALETTE_KEY,
  press,
  snapshotOf,
  stateKeys,
  usable,
} from '../windows/explorer-commands.ts';
import {
  clickRowLabel,
  notifications,
  pressControlAlt,
  titleAction,
} from '../windows/renderer.ts';

describe('the commands of the view out of their context (card coverage-102, part 3)', function () {
  this.timeout(900_000);

  before(async () => {
    for (const name of ['c5002-a', 'c5002-b']) {
      await visit(HOST, name);
    }
  });

  /** Binds every command to its key with `args`, presses them one at a time in a new window, and gives what changed. */
  async function pressedOne(
    label: string,
    argument: unknown,
  ): Promise<{
    changed: string[];
    notices: unknown[];
    usable: boolean;
    detects: boolean;
  }> {
    const window = await viewWindow(label);
    const restore = await bindKeys([
      ...COMMANDS.map(([key, command]) => ({
        key: `ctrl+alt+${key}`,
        command: `remote-explorer.${command}`,
        argument,
      })),
      {
        key: `ctrl+alt+${PALETTE_KEY}`,
        command: 'workbench.action.showCommands',
      },
      {key: `ctrl+alt+${CONTROL_KEY}`, command: CONTROL_COMMAND},
    ]);
    try {
      await foldersSettled(window, HOST, FOLDERS, `${HOME}/c5002-`);
      const before = JSON.stringify(await snapshotOf(window));
      const changed: string[] = [];
      const notices: unknown[] = [];
      for (const [key, command] of COMMANDS) {
        await press(window, key);
        notices.push(await notifications(window));
        if (JSON.stringify(await snapshotOf(window)) !== before) {
          changed.push(command);
        }
      }
      // The control: a key that does change the window (a new untitled editor changes its title) is seen as a change.
      await press(window, CONTROL_KEY);
      const detects = JSON.stringify(await snapshotOf(window)) !== before;
      await reloadWindow(window);
      await inWindow(window, 'workbench.view.remote');
      await foldersSettled(window, HOST, FOLDERS, `${HOME}/c5002-`);
      return {changed, notices, usable: await usable(window), detects};
    } finally {
      restore();
      await closeIfOpen(window);
    }
  }

  it('F-5002 AC-6, AC-11, AC-16 (keys-plain): a key bound to each command with no argument changes no window, title, indicator, file or history row, shows no dialog, leaves the window usable and adds no state key of the extension', async () => {
    const keysBefore = stateKeys();
    const seen = await pressedOne('keys-plain', undefined);
    deepStrictEqual(
      [seen.changed, seen.usable, seen.detects, stateKeys()],
      [[], true, true, keysBefore],
      JSON.stringify(seen.notices),
    );
  });

  it('F-5002 AC-7, AC-16 (keys-bogus): the same keys with the argument "bogus-f5002" and with {} change nothing', async () => {
    const keysBefore = stateKeys();
    const bogus = await pressedOne('keys-bogus', 'bogus-f5002');
    const empty = await pressedOne('keys-empty', {});
    deepStrictEqual(
      [bogus.changed, empty.changed, bogus.usable, empty.usable, stateKeys()],
      [[], [], true, true, keysBefore],
    );
  });

  it('F-5002 AC-8, AC-9 (keys-row): with a recent-folder row focused, the keys of the remove command and of the two folder connect commands leave the row listed, the history as it was and the windows as they were', async () => {
    const window = await viewWindow('keys-row');
    const restore = await bindKeys([
      {key: 'ctrl+alt+j', command: 'remote-explorer.deleteFolderHistoryItem'},
      {
        key: 'ctrl+alt+i',
        command: 'remote-explorer.connectToFolderInCurrentWindow',
      },
      {
        key: 'ctrl+alt+f',
        command: 'remote-explorer.connectToFolderInNewWindow',
      },
    ]);
    try {
      await foldersSettled(window, HOST, FOLDERS, `${HOME}/c5002-`);
      const label = (await folderRowsOf(window, HOST)).find(entry =>
        entry.description.startsWith(`${HOME}/c5002-`),
      )?.label;
      const before = JSON.stringify(await snapshotOf(window));
      const changed: string[] = [];
      for (const key of ['j', 'i', 'f']) {
        await clickRowLabel(window, VIEW, label ?? '');
        await press(window, key);
        if (JSON.stringify(await snapshotOf(window)) !== before) {
          changed.push(key);
        }
      }
      deepStrictEqual([changed, await usable(window)], [[], true]);
    } finally {
      restore();
      await closeIfOpen(window);
    }
  });

  it('F-5002 AC-10 (keys-group): with the SSH group row focused, the key of add writes no file and opens no window', async () => {
    const window = await viewWindow('keys-group');
    const restore = await bindKeys([
      {key: 'ctrl+alt+a', command: 'remote-explorer.add'},
    ]);
    try {
      await foldersSettled(window, HOST, FOLDERS, `${HOME}/c5002-`);
      await clickRowLabel(window, VIEW, 'SSH');
      const before = JSON.stringify(await snapshotOf(window));
      await press(window, 'a');
      deepStrictEqual(
        [
          JSON.stringify(await snapshotOf(window)) === before,
          await usable(window),
        ],
        [true, true],
      );
    } finally {
      restore();
      await closeIfOpen(window);
    }
  });

  it('F-5002 AC-17 (keys-refresh): Refresh from the title action and by a key shows no warning and changes no window', async () => {
    const window = await viewWindow('keys-refresh');
    try {
      await foldersSettled(window, HOST, FOLDERS, `${HOME}/c5002-`);
      const before = JSON.stringify(await snapshotOf(window));
      // Once a key is bound to the command the button's name carries it, so the button is pressed first.
      await titleAction(window, VIEW, 'Refresh');
      const afterTitle = await notifications(window);
      const restore = await bindKeys([
        {key: 'ctrl+alt+c', command: 'remote-explorer.refresh'},
      ]);
      try {
        await pressControlAlt(window, 'c');
        await new Promise(resolve => setTimeout(resolve, 2_000));
        await foldersSettled(window, HOST, FOLDERS, `${HOME}/c5002-`);
        deepStrictEqual(
          [
            afterTitle,
            await notifications(window),
            JSON.stringify(await snapshotOf(window)) === before,
          ],
          [[], [], true],
        );
      } finally {
        restore();
      }
    } finally {
      await closeIfOpen(window);
    }
  });
});
