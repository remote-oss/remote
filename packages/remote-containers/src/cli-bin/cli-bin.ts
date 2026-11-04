/**
 * @fileoverview The `cli-bin` folder of the extension's global storage: the launchers of the `devcontainer` command and
 * the data files they read, written at every activation in two groups that are refreshed on their own, each when the
 * file that keys it is missing or no longer holds what it should. A file is written under a temporary name and renamed,
 * so two windows that activate together never leave a half-written one.
 */

import path from 'node:path';
import {
  EDITOR_PATH_FILE,
  EXTENSION_PATH_FILE,
  POSIX_LAUNCHER,
  WINDOWS_LAUNCHER,
} from './launcher-scripts.ts';

/** What the launchers record of the running extension and editor. */
export interface CliBinFacts {
  /** The extension's install folder. */
  extensionPath: string;
  /** The editor's application root. */
  appRoot: string;
  /** The editor's program. */
  editorPath: string;
  /** The product's quality; `insider` renames the launchers. */
  quality: string;
}

/** The file system the folder is written on. */
export interface CliBinFs {
  /** The text of a file, or none when it isn't there. */
  readText(file: string): Promise<string | undefined>;
  /** Makes the folder and its parents, readable by the user only. */
  makeFolder(folder: string): Promise<void>;
  /** Writes `text` to a file of its own with `mode`. */
  writeText(file: string, text: string, mode: number): Promise<void>;
  /** Moves `from` over `target`. */
  rename(from: string, target: string): Promise<void>;
  /** A text that no other writer of the folder uses at the same time. */
  unique(): string;
}

/** A file of the folder: its name, its text and its mode. */
interface CliBinFile {
  name: string;
  text: string;
  mode: number;
}

const LAUNCHER_MODE = 0o755;
const DATA_MODE = 0o644;

/** The name of the launcher, which the product's quality decides. */
function launcherNameOf(quality: string): string {
  return quality === 'insider' ? 'devcontainer-insiders' : 'devcontainer';
}

/** A group of files refreshed together: the file that keys it, written last, and the files it keys. */
interface CliBinGroup {
  key: CliBinFile;
  keyed: CliBinFile[];
}

/** The group keyed by the extension's install folder: the launchers. */
function extensionGroupOf(facts: CliBinFacts): CliBinGroup {
  const name = launcherNameOf(facts.quality);
  return {
    key: {
      name: EXTENSION_PATH_FILE,
      text: facts.extensionPath,
      mode: DATA_MODE,
    },
    keyed: [
      {name, text: POSIX_LAUNCHER, mode: LAUNCHER_MODE},
      {name: `${name}.cmd`, text: WINDOWS_LAUNCHER, mode: LAUNCHER_MODE},
    ],
  };
}

/** The group keyed by the editor's program: the other data files. */
function editorGroupOf(facts: CliBinFacts): CliBinGroup {
  return {
    key: {name: EDITOR_PATH_FILE, text: facts.editorPath, mode: DATA_MODE},
    keyed: [
      {name: 'vscode-app-root', text: facts.appRoot, mode: DATA_MODE},
      {name: 'vscode-quality', text: facts.quality, mode: DATA_MODE},
    ],
  };
}

/**
 * Writes `cli-bin` under `storage` as far as it is out of date. A group whose key file holds what it should isn't
 * touched. It throws when the file system does, and the caller logs that.
 */
export async function refreshCliBin(
  storage: string,
  facts: CliBinFacts,
  files: CliBinFs,
): Promise<void> {
  const folder = path.join(storage, 'cli-bin');
  const stale: CliBinGroup[] = [];
  for (const group of [extensionGroupOf(facts), editorGroupOf(facts)]) {
    if (
      (await files.readText(path.join(folder, group.key.name))) !==
      group.key.text
    ) {
      stale.push(group);
    }
  }
  if (stale.length === 0) {
    return;
  }
  await files.makeFolder(folder);
  // A key is written after the files it keys, so a refresh that stops half way is made again at the next activation.
  for (const file of stale.flatMap(group => [...group.keyed, group.key])) {
    const temporary = path.join(folder, `${file.name}.${files.unique()}.tmp`);
    await files.writeText(temporary, file.text, file.mode);
    await files.rename(temporary, path.join(folder, file.name));
  }
}
