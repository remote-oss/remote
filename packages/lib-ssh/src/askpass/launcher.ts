/**
 * @fileoverview The launcher `ssh` runs as its askpass: `ssh` can only run a program, so a small script starts the
 * bundled askpass program on the editor's own runtime. It is written for the user alone, mode 0700.
 */

import {chmod, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {posixQuote} from '../process/remote-program.ts';
import {launcherPath} from './paths.ts';

/** The script text: the editor's executable runs the askpass program as Node.js and passes `ssh`'s arguments on. */
export function launcherText(runtime: string, program: string): string {
  return [
    '#!/bin/sh',
    `ELECTRON_RUN_AS_NODE=1 exec ${posixQuote(runtime)} ${posixQuote(program)} "$@"`,
    '',
  ].join('\n');
}

/** The file access the launcher needs. */
export interface LauncherFiles {
  /**
   * Writes an executable file that only the user can read, write or run, in a folder that only the user can enter;
   * the folder is created as needed and its mode is set again when it exists. A folder that is not the user's cannot
   * be set and is refused with the system's error.
   */
  writeExecutable(file: string, text: string): Promise<void>;
}

/** The launcher files of this machine. */
export const nodeLauncherFiles: LauncherFiles = {
  writeExecutable: async (file, text) => {
    const folder = path.dirname(file);
    await mkdir(folder, {recursive: true, mode: 0o700});
    await chmod(folder, 0o700);
    await writeFile(file, text, {mode: 0o700});
    // The mode of a file that already existed is not changed by writing it.
    await chmod(file, 0o700);
  },
};

/** Writes the launcher into the runtime folder and returns its path. */
export async function installLauncher(
  files: LauncherFiles,
  runtimeFolder: string,
  runtime: string,
  program: string,
): Promise<string> {
  const text = launcherText(runtime, program);
  const file = launcherPath(runtimeFolder, text);
  await files.writeExecutable(file, text);
  return file;
}
