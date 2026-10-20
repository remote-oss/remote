/**
 * @fileoverview A program: stops the helpers recorded under each user-data folder its arguments name, with the
 * helpers' own library. Each record's helper is stopped as a window stops it; one that still answers a hello
 * afterwards is killed, with every process whose environment holds its record's nonce, and its record is removed. It
 * exits 1 with the reason when it can't.
 *
 *     node tests/acceptance/server/helper-stop.ts <user-data folder>...
 */

import {rmSync} from 'node:fs';
import {
  type EndpointPort,
  nodeClientEnvironment,
  nodeEndpointPort,
  stop,
} from 'lib-helper';
import {
  type FoundRecord,
  helperRecords,
  processesHolding,
} from '../../../tools/acceptance-helper-stop.ts';
import {isMainModule, messageOf} from '../../../tools/repository.ts';

/** How long a helper may take to welcome a hello, or to end after a stop, in milliseconds. */
const HELLO_LIMIT_MILLISECONDS = 2000;

/** What stopping the recorded helpers needs of the world; the program passes the real one. */
export interface HelperStopWorld {
  /** Ends the helper that holds the key, as lib-helper's `stop` does. */
  stop(folder: string, namespace: string, recordKey: string): Promise<void>;
  /** Whether a helper at the record's endpoint welcomes a hello with the record's nonce. */
  answers(record: FoundRecord): Promise<boolean>;
  /** The ids of the processes whose environment holds `text`. */
  processesHolding(text: string): number[];
  kill(processId: number, signal: 'SIGKILL'): void;
}

/** Whether a helper at the record's endpoint welcomes a hello with the record's nonce within the limit. */
export async function helloAnswered(
  endpoints: EndpointPort,
  record: Pick<FoundRecord, 'endpoint' | 'nonce'>,
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

/** Stops every helper recorded under a user-data folder, and kills one that still answers afterwards. */
export async function stopRecordedHelpers(
  userDataFolder: string,
  world: HelperStopWorld = nodeHelperStopWorld(),
): Promise<void> {
  for (const found of helperRecords(userDataFolder)) {
    await world.stop(found.folder, found.namespace, found.recordKey);
    if (await world.answers(found)) {
      for (const processId of world.processesHolding(found.nonce)) {
        world.kill(processId, 'SIGKILL');
      }
      rmSync(found.file, {force: true});
    }
  }
}

if (isMainModule(import.meta.url)) {
  try {
    for (const userDataFolder of process.argv.slice(2)) {
      await stopRecordedHelpers(userDataFolder);
    }
  } catch (error) {
    console.error(`helper-stop: ${messageOf(error)}`);
    process.exitCode = 1;
  }
}
