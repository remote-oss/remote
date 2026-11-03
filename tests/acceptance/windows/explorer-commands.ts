/**
 * @fileoverview What the rows of F-5002 share: the eleven commands that are not sign-in commands and the key each is
 * bound to, the snapshot of a window and of the machine that a key must leave as it was, and the key press that closes
 * what it opens.
 */

import {existsSync, readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {userSettingsFile, variable, windowNames} from './harness.ts';
import {activations} from './folder-windows.ts';
import {folderRowsOf, HOME} from './explorer-folders.ts';
import {
  dialogOf,
  editorTabs,
  paletteRows,
  pressControlAlt,
  pressEscape,
  statusItem,
  windowTitle,
} from './renderer.ts';

/** The host the rows' folders were opened on. */
export const HOST = 'harness';

/** The commands the rows press, other than the two sign-in commands, each with the key the rows bind to it. */
export const COMMANDS = [
  ['a', 'add'],
  ['b', 'configureSsh'],
  ['c', 'refresh'],
  ['d', 'connectToRemoteInNewWindow'],
  ['e', 'connectToRemoteInCurrentWindow'],
  ['f', 'connectToFolderInNewWindow'],
  ['g', 'connectToWslUsingDistro'],
  ['h', 'connectToWslUsingDistroInNewWindow'],
  ['i', 'connectToFolderInCurrentWindow'],
  ['j', 'deleteFolderHistoryItem'],
  ['k', 'unregisterTunnel'],
] as const;

/** The key of the control of the rows' comparison: it is bound to a command that does change the window. */
export const CONTROL_KEY = 'm';

/** The command of the control: a new untitled editor, which changes the window's tabs. */
export const CONTROL_COMMAND = 'workbench.action.files.newUntitledFile';

/** The key that shows the Command Palette, which proves that the keys reach the window. */
export const PALETTE_KEY = 'l';

/** The folders the history holds for the rows. */
export const FOLDERS = ['c5002-b', 'c5002-a'].map(name => `${HOME}/${name}`);

/** The extension's identifier, which no state key of a command's invocation may equal (F-5901). */
const EXTENSION_ID = 'remote-oss.remote-explorer';

/** The state keys of the profile's global state database that equal the extension's identifier. */
export function stateKeys(): string[] {
  const file = path.join(
    variable('HARNESS_USER_DATA'),
    'User/globalStorage/state.vscdb',
  );
  if (!existsSync(file)) {
    return [];
  }
  const database = new DatabaseSync(file, {readOnly: true});
  try {
    return (
      database
        .prepare('SELECT key FROM ItemTable WHERE key = ?')
        .all(EXTENSION_ID) as Array<{key: string}>
    ).map(entry => entry.key);
  } finally {
    database.close();
  }
}

/** Everything the rows compare before and after a key: the window, its text and files, and the history rows. */
export async function snapshotOf(
  window: string,
  listed = true,
): Promise<unknown> {
  return {
    windows: windowNames().join(','),
    title: await windowTitle(window),
    indicator: (await statusItem(window, 'status.host')).text,
    activated: activations(window),
    dialog: await dialogOf(window),
    // A new window shows its Welcome page for a while and drops it by itself.
    tabs: (await editorTabs(window))
      .map(entry => entry.label)
      .filter(label => label !== 'Welcome'),
    sshConfig: readFileSync(variable('HARNESS_SSH_CONFIG'), 'utf8'),
    settings: readFileSync(userSettingsFile(), 'utf8'),
    sshFolder: existsSync(path.join(runHome(), '.ssh'))
      ? readdirSync(path.join(runHome(), '.ssh')).sort()
      : [],
    folderRows: listed
      ? (await folderRowsOf(window, HOST))
          .map(entry => entry.description)
          .filter(description => description.startsWith(`${HOME}/c5002-`))
      : [],
  };
}

/** The run's own home, where the user's SSH configuration is written. */
function runHome(): string {
  return path.join(variable('HARNESS_RUN_FOLDER'), 'home');
}

/** Presses `key` in `window`, waits, and closes with Escape what it opened. */
export async function press(window: string, key: string): Promise<void> {
  await pressControlAlt(window, key);
  await new Promise(resolve => setTimeout(resolve, 2_000));
  await pressEscape(window);
  await new Promise(resolve => setTimeout(resolve, 1_000));
}

/** Whether the Command Palette opens in `window`: it accepts input. */
export async function usable(window: string): Promise<boolean> {
  return (await paletteRows(window, 'Focus on Remotes')).length > 0;
}

/**
 * The snapshot of a window once it has settled: a newly opened window still draws its welcome page and its
 * indicator, so the snapshot is taken again every three seconds until two of them are equal.
 */
export async function settledSnapshot(
  window: string,
  listed = true,
): Promise<string> {
  let last = JSON.stringify(await snapshotOf(window, listed));
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 3_000));
    const now = JSON.stringify(await snapshotOf(window, listed));
    if (now === last) {
      return now;
    }
    last = now;
  }
  return last;
}

/** The fields in which two snapshots differ, each with its two values, empty when they are equal. */
export function differences(before: string, after: string): string[] {
  const left = JSON.parse(before) as Record<string, unknown>;
  const right = JSON.parse(after) as Record<string, unknown>;
  return Object.keys(left)
    .filter(
      field => JSON.stringify(left[field]) !== JSON.stringify(right[field]),
    )
    .map(
      field =>
        `${field} ${JSON.stringify(left[field])} -> ${JSON.stringify(right[field])}`,
    );
}
