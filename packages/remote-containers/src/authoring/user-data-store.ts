/**
 * @fileoverview The extension's own store of configurations that live outside the workspace: one slot folder per
 * workspace folder under the global storage, each marked with the folder it belongs to. A slot of another folder is
 * never read or changed; a name already taken by one gives the next free name.
 */

import path from 'node:path';

/** The marker file of a slot, beside its configuration. */
const MARKER_FILE = path.join('.devcontainer', '.devcontainer-internal.json');

/** The comment line that opens the marker. */
const MARKER_COMMENT = '// Maintained by the Dev Container extension';

/** A slot of the store: its name, its folder, and the configuration file inside it. */
export interface StoredSlot {
  name: string;
  /** `<root>/<name>`. */
  folder: string;
  /** `<folder>/.devcontainer/devcontainer.json`. */
  configFile: string;
}

/** The file system the store uses. */
export interface StoreFiles {
  /** The names of the folders directly in `folder`; none when it does not exist. */
  folderNames(folder: string): Promise<string[]>;
  /** The text of the file; none when it cannot be read. */
  readText(file: string): Promise<string | undefined>;
}

/** The folder of the store under the extension's global storage. */
export function storeRootOf(globalStorage: string): string {
  return path.join(globalStorage, 'configs');
}

function slotNamed(root: string, name: string): StoredSlot {
  const folder = path.join(root, name);
  return {
    name,
    folder,
    configFile: path.join(folder, '.devcontainer', 'devcontainer.json'),
  };
}

/** The folder a slot's marker names; none when the marker cannot be read. */
async function ownerOf(
  slot: StoredSlot,
  files: StoreFiles,
): Promise<string | undefined> {
  const text = await files.readText(path.join(slot.folder, MARKER_FILE));
  if (text === undefined) {
    return undefined;
  }
  const json = text
    .split('\n')
    .filter(line => !line.trimStart().startsWith('//'))
    .join('\n');
  try {
    const parsed: unknown = JSON.parse(json);
    const owner = (parsed as {rootFolder?: unknown} | null)?.rootFolder;
    return typeof owner === 'string' ? owner : undefined;
  } catch {
    return undefined;
  }
}

/** The slot that belongs to exactly `workspaceFolder`; none when there is not one. */
export async function slotOf(
  root: string,
  workspaceFolder: string,
  files: StoreFiles,
): Promise<StoredSlot | undefined> {
  for (const name of await files.folderNames(root)) {
    const slot = slotNamed(root, name);
    if ((await ownerOf(slot, files)) === workspaceFolder) {
      return slot;
    }
  }
  return undefined;
}

/** The slot for a folder that has none: its basename, or the first `-2`, `-3` … that is not taken. */
export async function newSlot(
  root: string,
  workspaceFolder: string,
  files: StoreFiles,
): Promise<StoredSlot> {
  const taken = new Set(await files.folderNames(root));
  const base = path.basename(workspaceFolder);
  let name = base;
  for (let count = 2; taken.has(name); count += 1) {
    name = `${base}-${String(count)}`;
  }
  return slotNamed(root, name);
}

/** Writes the marker of the slot folder: the folder it belongs to. */
export async function writeMarker(
  slotFolder: string,
  workspaceFolder: string,
  write: (file: string, text: string) => Promise<void>,
): Promise<void> {
  await write(
    path.join(slotFolder, MARKER_FILE),
    `${MARKER_COMMENT}\n${JSON.stringify({rootFolder: workspaceFolder})}\n`,
  );
}

/** The file with the home folder written as `~`, for a text the user reads. */
export function tildePath(file: string, home: string): string {
  const relative = path.relative(home, file);
  return relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
    ? file
    : path.join('~', relative);
}
