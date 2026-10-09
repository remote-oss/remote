/**
 * @fileoverview The launcher `ssh` runs as its askpass: `ssh` can only run a program, so a small script starts the
 * bundled askpass program on the editor's own runtime. It is written for the user alone, mode 0700.
 */

import {createHash} from 'node:crypto';
import {chmod, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {posixQuote} from '../process/remote-program.ts';

const NAME_DIGEST_LENGTH = 16;

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
  /** Writes an executable file that only the user can read, write or run, creating the folder as needed. */
  writeExecutable(file: string, text: string): Promise<void>;
}

/** The launcher files of this machine. */
export const nodeLauncherFiles: LauncherFiles = {
  writeExecutable: async (file, text) => {
    await mkdir(path.dirname(file), {recursive: true, mode: 0o700});
    await writeFile(file, text, {mode: 0o700});
    // The mode of a file that already existed is not changed by writing it.
    await chmod(file, 0o700);
  },
};

/** Writes the launcher into `folder`, named by a digest of its text, and returns its path. */
export async function installLauncher(
  files: LauncherFiles,
  folder: string,
  runtime: string,
  program: string,
): Promise<string> {
  const text = launcherText(runtime, program);
  const digest = createHash('sha256').update(text).digest('hex');
  const file = path.join(
    folder,
    `askpass-${digest.slice(0, NAME_DIGEST_LENGTH)}.sh`,
  );
  await files.writeExecutable(file, text);
  return file;
}
