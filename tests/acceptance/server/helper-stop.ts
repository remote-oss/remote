/**
 * @fileoverview Stopping the helpers recorded under a user-data folder, with the helpers' own library: each record's
 * helper is stopped as a window stops it, and one that still answers afterwards is killed by its nonce. The harness
 * runs it through `stop-helpers.ts` at the end of every launch and in the clean-up of a run that was killed.
 */

import {existsSync, readdirSync, readFileSync, rmSync} from 'node:fs';
import path from 'node:path';
import {
  type EndpointPort,
  type HelperRecord,
  nodeClientEnvironment,
  nodeEndpointPort,
  parseRecord,
  recordPath,
  stop,
} from 'lib-helper';

/** How long a helper may take to welcome a hello, or to end after a stop, in milliseconds. */
const HELLO_LIMIT_MILLISECONDS = 2000;

/** A record file's name: the first 32 hex characters of its key's digest. */
const RECORD_FILE = /^[0-9a-f]{32}\.json$/;

/** One helper's record under a user-data folder: the file, its registry folder and what it holds. */
export interface FoundRecord {
  file: string;
  folder: string;
  record: HelperRecord;
}

/** What stopping a run's helpers needs of the world; the run passes the real one. */
export interface HelperStopWorld {
  /** Ends the helper that holds the key, as lib-helper's `stop` does. */
  stop(folder: string, namespace: string, recordKey: string): Promise<void>;
  /** Whether a helper at the record's endpoint welcomes a hello with the record's nonce. */
  answers(record: HelperRecord): Promise<boolean>;
  /** The ids of the processes whose environment holds `text`. */
  processesHolding(text: string): number[];
  kill(processId: number, signal: 'SIGKILL'): void;
}

/** The record a file holds, when it is a helper's record at its own key's path. */
function foundRecord(file: string): FoundRecord | undefined {
  const record = parseRecord(readFileSync(file, 'utf8'));
  const folder = path.dirname(path.dirname(file));
  return record !== undefined &&
    recordPath(folder, record.namespace, record.recordKey) === file
    ? {file, folder, record}
    : undefined;
}

/**
 * The helpers' records under a user-data folder, in every profile's global storage and in the instance's: each
 * `<folder>/<namespace>/<32 hex>.json` that holds a record of that namespace whose key's digest names the file.
 */
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

/** Whether a helper at the record's endpoint welcomes a hello with the record's nonce within the limit. */
export async function helloAnswered(
  endpoints: EndpointPort,
  record: HelperRecord,
  limitMilliseconds: number,
): Promise<boolean> {
  const connection = await endpoints
    .connect(record.endpoint)
    .catch(() => undefined);
  if (connection === undefined) {
    return false;
  }
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      resolve(false);
      connection.close();
    }, limitMilliseconds);
    connection.onMessage(() => {
      clearTimeout(timer);
      resolve(true);
      connection.close();
    });
    connection.onClose(() => {
      clearTimeout(timer);
      resolve(false);
    });
    connection.send({type: 'hello', nonce: record.nonce});
  });
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

/** This machine: lib-helper's stop and hello over real sockets, /proc and real signals. */
function nodeHelperStopWorld(): HelperStopWorld {
  const environment = nodeClientEnvironment(process.execPath, {
    helloLimitMilliseconds: HELLO_LIMIT_MILLISECONDS,
    startLimitMilliseconds: HELLO_LIMIT_MILLISECONDS,
    retryMilliseconds: 100,
  });
  const endpoints = nodeEndpointPort();
  return {
    stop: (folder, namespace, recordKey) =>
      stop(environment, folder, namespace, recordKey),
    answers: record =>
      helloAnswered(endpoints, record, HELLO_LIMIT_MILLISECONDS),
    processesHolding,
    kill: process.kill.bind(process),
  };
}

/**
 * Stops every helper recorded under a user-data folder. A helper that still answers a hello afterwards is killed,
 * with every process whose environment holds its record's nonce, and its record is removed.
 */
export async function stopHelpersUnder(
  userDataFolder: string,
  world: HelperStopWorld = nodeHelperStopWorld(),
): Promise<void> {
  for (const found of helperRecords(userDataFolder)) {
    const {namespace, recordKey} = found.record;
    await world.stop(found.folder, namespace, recordKey);
    if (await world.answers(found.record)) {
      for (const processId of world.processesHolding(found.record.nonce)) {
        world.kill(processId, 'SIGKILL');
      }
      rmSync(found.file, {force: true});
    }
  }
}
