/**
 * @fileoverview Helpers the repository tools share: directory listing in a fixed order, path containment, the
 * package folders under packages/, and running a module as a script.
 */

import {readdirSync, realpathSync, type Dirent} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

/** The extension folders under packages/ (layout.md, rule 1). */
export const EXTENSION_FOLDERS = [
  'remote-containers',
  'remote-ssh',
  'remote-ssh-edit',
  'remote-explorer',
  'remote-wsl',
  'remote-server',
  'remote-extensionpack',
] as const;

/**
 * The package name a folder's package.json must carry: the folder name, except for the pack, whose name is the
 * `<x>` of its extension id.
 */
export function expectedPackageName(folder: string): string {
  return folder === 'remote-extensionpack'
    ? 'vscode-remote-extensionpack'
    : folder;
}

/** Whether a package folder holds a library (`lib-*`) rather than an extension. */
export function isLibraryFolder(folder: string): boolean {
  return folder.startsWith('lib-');
}

/** The entries of a directory, sorted by name so that every report has the same order on every platform. */
export function sortedEntries(directory: string): Dirent[] {
  return readdirSync(directory, {withFileTypes: true}).sort((left, right) =>
    left.name < right.name ? -1 : 1,
  );
}

/** Whether `candidate` is `directory` itself or lies below it. */
export function isInside(directory: string, candidate: string): boolean {
  const relative = path.relative(directory, candidate);
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

/** The folder names under `<root>/packages`, sorted. */
export function packageFolders(root: string): string[] {
  return sortedEntries(path.join(root, 'packages'))
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name);
}

/**
 * Whether the module at `moduleUrl` is the script Node was started with. It compares real paths instead of using
 * `import.meta.main`, so it works on every Node version that can load the module.
 */
export function isMainModule(moduleUrl: string): boolean {
  const started = process.argv[1];
  return (
    started !== undefined &&
    realpathSync(started) === realpathSync(fileURLToPath(moduleUrl))
  );
}

/** The file a package's binary lives in, `c8/bin/c8.js` for example, resolved from the tools' own dependencies. */
export function resolveBinary(specifier: string): string {
  return fileURLToPath(import.meta.resolve(specifier));
}

/** The message of a caught value, which is an Error in every case the tools expect. */
export function messageOf(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

/** The repository root, one folder above tools/. */
export const REPOSITORY_ROOT = path.dirname(
  path.dirname(fileURLToPath(import.meta.url)),
);
