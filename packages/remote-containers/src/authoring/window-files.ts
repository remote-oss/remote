/**
 * @fileoverview The files the authoring command reads and writes, and where each lives. A window's folder may be on
 * another file system than the extension's host (a dev container's folder is in the container), so each path goes to
 * the window's file system when it is the window's folder or below it, and stays on the host otherwise: the scratch
 * folder, the user-data store and the CLI's output are the host's.
 */

import {
  access,
  constants as fileConstants,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import type {RootEntry} from './curated-templates.ts';

/** What is at a path. */
export type EntryKind = 'file' | 'folder' | 'missing';

/** What the wizard, the write and the stored copy do with files, by the path of each. */
export interface AuthoringFiles {
  /** What is at the path. */
  kindOf(file: string): Promise<EntryKind>;
  /** Whether anything is at the path. */
  exists(file: string): Promise<boolean>;
  /** The entries of a folder, with what each is; none for a folder that cannot be listed. */
  list(folder: string): Promise<RootEntry[]>;
  read(file: string): Promise<Uint8Array>;
  /** Writes the bytes, replacing the file. */
  write(file: string, bytes: Uint8Array): Promise<void>;
  /** Creates the folder and the ones above it that are missing. */
  makeFolder(folder: string): Promise<void>;
  /** Removes the file; none if it is not there. */
  removeFile(file: string): Promise<void>;
  /** Removes the folder and what is in it; none if it is not there. */
  removeFolder(folder: string): Promise<void>;
  /** Why files could not be created in the folder (it may not exist yet): the file system's words; none when they can. */
  creationProblem(folder: string): Promise<string | undefined>;
}

/** The files of the machine the extension runs on. */
export function hostFiles(): AuthoringFiles {
  async function kindOf(file: string): Promise<EntryKind> {
    const found = await stat(file).catch(() => undefined);
    if (found === undefined) {
      return 'missing';
    }
    return found.isDirectory() ? 'folder' : 'file';
  }
  return {
    kindOf,
    exists: async file => (await kindOf(file)) !== 'missing',
    list: async folder =>
      (await readdir(folder, {withFileTypes: true}).catch(() => [])).map(
        entry => ({
          name: entry.name,
          kind: entry.isFile()
            ? 'file'
            : entry.isDirectory()
              ? 'folder'
              : 'other',
        }),
      ),
    read: file => readFile(file),
    write: (file, bytes) => writeFile(file, bytes),
    makeFolder: async folder => {
      await mkdir(folder, {recursive: true});
    },
    removeFile: file => rm(file, {force: true}),
    removeFolder: folder => rm(folder, {recursive: true, force: true}),
    creationProblem: async folder => {
      let nearest = folder;
      while (!(await stat(nearest).catch(() => undefined))) {
        nearest = path.dirname(nearest);
      }
      return access(nearest, fileConstants.W_OK).then(
        () => undefined,
        (caught: unknown) =>
          caught instanceof Error ? caught.message : String(caught),
      );
    },
  };
}

/** The part of `vscode.workspace.fs` the window's files use, over any kind of address. */
export interface WindowFileSystem<Address> {
  stat(address: Address): PromiseLike<{type: number}>;
  readDirectory(address: Address): PromiseLike<Array<[string, number]>>;
  readFile(address: Address): PromiseLike<Uint8Array>;
  writeFile(address: Address, bytes: Uint8Array): PromiseLike<void>;
  /** Creates the folder and the ones above it that are missing. */
  createDirectory(address: Address): PromiseLike<void>;
  delete(
    address: Address,
    options: {recursive: boolean; useTrash: boolean},
  ): PromiseLike<void>;
}

/** The bits of `vscode.FileType` the window's files tell apart. */
export interface WindowFileTypes {
  file: number;
  directory: number;
}

/**
 * The files of the window's file system, which has no access check: `creationProblem` gives none, and a write that
 * fails then names its cause through the write's own dialog. `addressOf` gives the address of a path.
 */
export function windowFiles<Address>(
  fileSystem: WindowFileSystem<Address>,
  fileTypes: WindowFileTypes,
  addressOf: (file: string) => Address,
): AuthoringFiles {
  async function kindOf(file: string): Promise<EntryKind> {
    const found = await Promise.resolve(fileSystem.stat(addressOf(file))).catch(
      () => undefined,
    );
    if (found === undefined) {
      return 'missing';
    }
    return (found.type & fileTypes.directory) === 0 ? 'file' : 'folder';
  }
  /** Removes `target`; a path that is not there is not an error. */
  async function remove(target: string, recursive: boolean): Promise<void> {
    try {
      await fileSystem.delete(addressOf(target), {recursive, useTrash: false});
    } catch (caught) {
      if ((await kindOf(target)) !== 'missing') {
        throw caught;
      }
    }
  }
  return {
    kindOf,
    exists: async file => (await kindOf(file)) !== 'missing',
    list: async folder =>
      (
        await Promise.resolve(
          fileSystem.readDirectory(addressOf(folder)),
        ).catch((): Array<[string, number]> => [])
      ).map(([name, type]) => ({
        name,
        kind:
          (type & fileTypes.directory) !== 0
            ? 'folder'
            : (type & fileTypes.file) !== 0
              ? 'file'
              : 'other',
      })),
    read: async file => fileSystem.readFile(addressOf(file)),
    write: async (file, bytes) => fileSystem.writeFile(addressOf(file), bytes),
    makeFolder: async folder => fileSystem.createDirectory(addressOf(folder)),
    removeFile: file => remove(file, false),
    removeFolder: folder => remove(folder, true),
    creationProblem: () => Promise.resolve(undefined),
  };
}

/** Whether `file` is `folder` or lies below it, by the segments of the paths. */
export function isUnder(folder: string, file: string): boolean {
  const relative = path.posix.relative(folder, file);
  return (
    relative === '' ||
    (relative.split('/')[0] !== '..' && !path.posix.isAbsolute(relative))
  );
}

/**
 * Each call goes to the window's files when its path is the window's `folder` or below it, and to the host's otherwise.
 * With no folder every call goes to the host. `folder` may be given as a function, read at each call.
 */
export function routedFiles(
  host: AuthoringFiles,
  window: AuthoringFiles,
  folder: string | undefined | (() => string | undefined),
): AuthoringFiles {
  function filesOf(file: string): AuthoringFiles {
    const current = typeof folder === 'function' ? folder() : folder;
    return current !== undefined && isUnder(current, file) ? window : host;
  }
  return {
    kindOf: file => filesOf(file).kindOf(file),
    exists: file => filesOf(file).exists(file),
    list: target => filesOf(target).list(target),
    read: file => filesOf(file).read(file),
    write: (file, bytes) => filesOf(file).write(file, bytes),
    makeFolder: target => filesOf(target).makeFolder(target),
    removeFile: file => filesOf(file).removeFile(file),
    removeFolder: target => filesOf(target).removeFolder(target),
    creationProblem: target => filesOf(target).creationProblem(target),
  };
}
