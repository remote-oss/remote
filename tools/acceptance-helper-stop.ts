/**
 * @fileoverview The helper processes a run's windows leave running. A helper that left the editor's process tree
 * outlives the editor, so at the end of every launch, and in the clean-up of a run that was killed, the run stops each
 * helper recorded under its user-data folder. The acceptance package's program does the stop with the helpers' own
 * library; this side finds the folders and runs it.
 */

import {existsSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {checked, type CommandRunner, runCommand} from './command-runner.ts';
import {REPOSITORY_ROOT} from './repository.ts';

/** The program that stops the helpers recorded under each user-data folder it is given. */
export const STOP_PROGRAM = path.join(
  REPOSITORY_ROOT,
  'tests',
  'acceptance',
  'server',
  'stop-helpers.ts',
);

/** A record file's name: the first 32 hex characters of its key's digest. */
const RECORD_FILE = /^[0-9a-f]{32}\.json$/;

/** Whether anything under the user-data folder's `User` folder is named as a helper's record is. */
export function holdsRecordFiles(userDataFolder: string): boolean {
  const userFolder = path.join(userDataFolder, 'User');
  return (
    existsSync(userFolder) &&
    readdirSync(userFolder, {recursive: true, encoding: 'utf8'}).some(name =>
      RECORD_FILE.test(path.basename(name)),
    )
  );
}

/** Stops the helpers recorded under a user-data folder with the stop program; without a record file, it runs nothing. */
export function stopHelpersUnder(
  userDataFolder: string,
  command: CommandRunner = runCommand,
): void {
  if (holdsRecordFiles(userDataFolder)) {
    checked(command, process.execPath, [STOP_PROGRAM, userDataFolder]);
  }
}

/** The user-data folders of the run `runId` under `temporaryFolder`, named as the run names its folder. */
export function runUserDataFolders(
  temporaryFolder: string,
  runId: string,
): string[] {
  const prefix = `acceptance-${runId}-`;
  return readdirSync(temporaryFolder)
    .filter(
      name =>
        name.startsWith(prefix) &&
        /^[A-Za-z0-9]+$/.test(name.slice(prefix.length)),
    )
    .sort()
    .map(name => path.join(temporaryFolder, name, 'user-data'));
}

/** Stops the helpers of every folder the run `runId` left under `temporaryFolder`. */
export function stopRunHelpers(
  temporaryFolder: string,
  runId: string,
  stopUnder: (userDataFolder: string) => void = stopHelpersUnder,
): void {
  for (const userDataFolder of runUserDataFolders(temporaryFolder, runId)) {
    stopUnder(userDataFolder);
  }
}
