/**
 * @fileoverview What the recent-folders rows share: the companion's envelope, the history Remote - SSH keeps as the
 * companion answers it, the folder rows the view shows under a host, and the opening of an SSH window on a folder so
 * that the window is recorded.
 */

import {deepStrictEqual} from 'node:assert';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  callCommand,
  closeWindow,
  isOpen,
  inWindow,
  onHost,
  variable,
  waitFor,
  windowEvents,
  windowNames,
  windowState,
} from './harness.ts';
import {activations, openFolderWindow} from './folder-windows.ts';
import {viewRows} from './renderer.ts';
import {VIEW} from './explorer-rows.ts';

/** The envelope of the companion interface 1.0, the argument every id of the companion takes. */
export const ENVELOPE = {interfaceVersion: {major: 1, minor: 0}} as const;

/** An entry of a host's history, as the companion answers it. */
interface HistoryEntry {
  path: string;
  kind: 'folder' | 'workspace';
}

/** The hosts of the history in the order the companion sends them, each with its entries, most recent first. */
export type History = Record<string, HistoryEntry[]>;

/** The window the history is read in and the view is shown in: the launch's local window. */
const LOCAL = 'local';

/** The account's home on the run's SSH host. */
export const HOME = '/home/harness';

/** The history Remote - SSH keeps, read through its companion id in the local window. */
export async function historyOf(): Promise<History> {
  const answer = await callCommand(
    LOCAL,
    'remote-internal.getSshFoldersHistory',
    ENVELOPE,
  );
  if (answer.rejection !== undefined) {
    throw new Error(`getSshFoldersHistory rejected: ${answer.rejection}`);
  }
  const hosts =
    (
      answer.value as {
        hosts?: Array<{hostKey: string; entries: HistoryEntry[]}>;
      } | null
    )?.hosts ?? [];
  return Object.fromEntries(
    hosts.map(host => [host.hostKey, host.entries] as const),
  );
}

/** The paths of `alias`'s history, most recent first; none for a host the history does not hold. */
export async function pathsOf(alias: string): Promise<string[]> {
  return ((await historyOf())[alias] ?? []).map(entry => entry.path);
}

/** The paths of `alias`'s history that start with `scope`, most recent first: a row's own entries among the run's. */
export async function ownPathsOf(
  alias: string,
  scope: string,
): Promise<string[]> {
  return (await pathsOf(alias)).filter(each => each.startsWith(scope));
}

/** A folder row of the view: the base name it is labelled with and the path it describes. */
export interface FolderRow {
  label: string;
  description: string;
}

/** The folder rows under the host row `alias` in the view of window `window`, in order. */
export async function folderRowsOf(
  window: string,
  alias: string,
): Promise<FolderRow[]> {
  const rows = (await viewRows(window, VIEW)) ?? [];
  const host = rows.findIndex(
    entry => entry.level === 2 && entry.label === alias,
  );
  if (host < 0) {
    return [];
  }
  const folders: FolderRow[] = [];
  for (const entry of rows.slice(host + 1)) {
    if (entry.level <= 2) {
      break;
    }
    folders.push({label: entry.label, description: entry.description});
  }
  return folders;
}

/**
 * Waits until the folder rows under `alias` in `window` describe exactly `paths`, then asserts them once. The rows
 * counted are the ones whose path starts with `scope` (the row's own folders: the history of a run outlives a row), or
 * all of them without a `scope`.
 */
export async function foldersSettled(
  window: string,
  alias: string,
  paths: string[],
  scope = '',
): Promise<void> {
  async function described(): Promise<string[]> {
    return (await folderRowsOf(window, alias))
      .map(entry => entry.description)
      .filter(description => description.startsWith(scope));
  }
  await waitFor(
    `the folder rows of ${alias} in window ${window}`,
    async () => {
      try {
        deepStrictEqual(await described(), paths);
        return true;
      } catch {
        return false;
      }
    },
    15_000,
  ).catch(() => undefined);
  deepStrictEqual(
    await described(),
    paths,
    `the rows of ${alias}; the history is ${JSON.stringify(await historyOf())}`,
  );
}

/** Waits until window `name` is connected to `alias`. */
export async function connectedTo(name: string, alias: string): Promise<void> {
  await waitFor(
    `window ${name} to connect to ${alias}`,
    async () =>
      (await windowState(name)).remoteAuthority === `ssh-remote+${alias}`,
    120_000,
  );
}

/**
 * Opens the target `address` (a `vscode-remote://` folder or workspace address) from the local window and waits until
 * the window named `name` has activated its agent.
 */
export async function openAddress(
  address: string,
  name: string,
): Promise<void> {
  await inWindow(LOCAL, 'acceptance.agent.openWindow', address);
  await waitFor(
    `window ${name} to activate its agent`,
    () => windowEvents(name).some(each => each.event === 'activated'),
    60_000,
  ).catch((error: unknown) => {
    throw new Error(
      `${String(error)}; the run's windows are ${windowNames().join(', ')}`,
      {
        cause: error,
      },
    );
  });
}

/**
 * Opens the folder `name` of the account's home on `alias` in a window of its own and waits until the history holds
 * it, then closes the window: a window of the run is a recorded visit.
 */
export async function visit(alias: string, name: string): Promise<void> {
  const target = `${HOME}/${name}`;
  await onHost('mkdir', '-p', target);
  await openAddress(`vscode-remote://ssh-remote+${alias}${target}`, name);
  await connectedTo(name, alias);
  await waitFor(
    `the history of ${alias} to start with ${target}`,
    async () => (await pathsOf(alias))[0] === target,
    120_000,
  );
  await closeWindow(name);
}

/** The window named `name` once it has activated its agent more often than `before` times. */
export function appearsAfter(name: string, before: number): Promise<void> {
  return waitFor(
    `window ${name} to activate its agent`,
    () => activations(name) > before,
    90_000,
  );
}

/** A local window on a new folder `label` of the run, showing the Remotes view; its name. */
export async function viewWindow(label: string): Promise<string> {
  const folder = path.join(
    variable('HARNESS_RUN_FOLDER'),
    'explorer-folders',
    label,
  );
  mkdirSync(folder, {recursive: true});
  const window = await openFolderWindow(folder);
  await inWindow(window, 'workbench.view.remote');
  return window;
}

/** The field of a keybinding in `keybindings.json` that holds the argument the key passes. */
const ARGUMENT_FIELD = 'args';

/** A user keybinding: the key and the command it runs. */
export interface Binding {
  key: string;
  command: string;
  /** The argument the key passes to the command; none when absent. */
  argument?: unknown;
}

/**
 * Writes `bindings` as the profile's `keybindings.json` and gives the function that puts the file back as it was. The
 * editor reads the file as it changes, so the call waits for that.
 */
export async function bindKeys(
  bindings: readonly Binding[],
): Promise<() => void> {
  const file = path.join(
    variable('HARNESS_USER_DATA'),
    'User/keybindings.json',
  );
  const before = existsSync(file) ? readFileSync(file, 'utf8') : undefined;
  writeFileSync(
    file,
    JSON.stringify(
      bindings.map(({key, command, argument}) => ({
        key,
        command,
        ...(argument === undefined ? {} : {[ARGUMENT_FIELD]: argument}),
      })),
    ),
  );
  await new Promise(resolve => setTimeout(resolve, 3_000));
  return () => {
    if (before === undefined) {
      rmSync(file, {force: true});
    } else {
      writeFileSync(file, before);
    }
  };
}

/** Closes window `name` when it is open, and does nothing otherwise. */
export async function closeIfOpen(name: string): Promise<void> {
  if (name !== '' && isOpen(name)) {
    await closeWindow(name);
  }
}
