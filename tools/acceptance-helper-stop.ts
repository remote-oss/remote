/**
 * @fileoverview The helper processes a run's windows leave running. A helper that left the editor's process tree
 * outlives the editor, so at the end of every launch, and in the clean-up of a run that was killed, the run stops each
 * helper recorded under its user-data folder. This side finds the records and runs the acceptance package's program,
 * which stops them with the helpers' own library.
 */

import {createHash} from 'node:crypto';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {checked, type CommandRunner, runCommand} from './command-runner.ts';
import {REPOSITORY_ROOT} from './repository.ts';

/** The program that stops the helpers recorded under each user-data folder it is given. */
export const STOP_PROGRAM = path.join(
  REPOSITORY_ROOT,
  'tests',
  'acceptance',
  'server',
  'helper-stop.ts',
);

/** A record file's name: the first 32 hex characters of its key's digest. */
const RECORD_FILE = /^[0-9a-f]{32}\.json$/;

/** One helper's record under a user-data folder: the file, its registry folder and the fields a stop needs. */
export interface FoundRecord {
  file: string;
  folder: string;
  namespace: string;
  recordKey: string;
  nonce: string;
  endpoint: string;
}

/** The text fields of a record file, or undefined when it isn't JSON or lacks one. */
function recordFields(
  file: string,
): Omit<FoundRecord, 'file' | 'folder'> | undefined {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
  // A record is a JSON object; each field read is checked below.
  const fields = (value ?? {}) as Partial<Record<string, unknown>>;
  const {namespace, recordKey, nonce, endpoint} = fields;
  return typeof namespace === 'string' &&
    typeof recordKey === 'string' &&
    typeof nonce === 'string' &&
    typeof endpoint === 'string'
    ? {namespace, recordKey, nonce, endpoint}
    : undefined;
}

/** The record a file holds, when it is a helper's record at its own key's path: `<folder>/<namespace>/<digest>.json`. */
function foundRecord(file: string): FoundRecord | undefined {
  const fields = recordFields(file);
  if (fields === undefined) {
    return undefined;
  }
  const digest = createHash('sha256')
    .update(fields.recordKey)
    .digest('hex')
    .slice(0, 32);
  return path.basename(path.dirname(file)) === fields.namespace &&
    path.basename(file) === `${digest}.json`
    ? {file, folder: path.dirname(path.dirname(file)), ...fields}
    : undefined;
}

/** The helpers' records under a user-data folder, in every profile's global storage and in the instance's. */
export function helperRecords(userDataFolder: string): FoundRecord[] {
  const userFolder = path.join(userDataFolder, 'User');
  if (!existsSync(userFolder)) {
    return [];
  }
  return readdirSync(userFolder, {recursive: true, encoding: 'utf8'})
    .filter(name => RECORD_FILE.test(path.basename(name)))
    .sort()
    .flatMap(name => foundRecord(path.join(userFolder, name)) ?? []);
}

/** The ids of the processes under `procFolder` whose environment holds `text`; one that can't be read is left out. */
export function processesHolding(text: string, procFolder = '/proc'): number[] {
  if (!existsSync(procFolder)) {
    return [];
  }
  return readdirSync(procFolder)
    .filter(entry => /^\d+$/.test(entry))
    .filter(entry => {
      try {
        return readFileSync(
          path.join(procFolder, entry, 'environ'),
          'utf8',
        ).includes(text);
      } catch {
        // The process ended, or belongs to another user.
        return false;
      }
    })
    .map(Number);
}

/** Stops the helpers recorded under a user-data folder with the stop program; without a record, it runs nothing. */
export function stopHelpersUnder(
  userDataFolder: string,
  command: CommandRunner = runCommand,
): void {
  if (helperRecords(userDataFolder).length > 0) {
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
  command: CommandRunner = runCommand,
): void {
  for (const userDataFolder of runUserDataFolders(temporaryFolder, runId)) {
    stopHelpersUnder(userDataFolder, command);
  }
}
