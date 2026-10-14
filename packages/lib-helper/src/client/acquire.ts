/**
 * @fileoverview The client side of a helper: acquire a lease (claim the key and start the helper, or join the
 * helper that holds it, replacing a stale one once), and stop a helper.
 */

import {endpointPath} from '../endpoint/path.ts';
import type {
  EndpointConnection,
  EndpointPort,
  HelperMessage,
} from '../endpoint/protocol.ts';
import {claim} from '../registry/claim.ts';
import {recordPath, type RegistryFilePort} from '../registry/file-port.ts';
import {removeOwnRecord} from '../registry/own-record.ts';
import {isStale, replaceStale} from '../registry/stale.ts';
import {
  type EndPolicy,
  type HelperRecord,
  parseRecord,
  serializeRecord,
} from '../types.ts';
import {HelperLease, type Timer} from './lease.ts';
import {type Spawner, spawnSpecification} from './spawn.ts';

/** What the client side needs from its surroundings. */
export interface ClientEnvironment {
  files: RegistryFilePort;
  endpoints: EndpointPort;
  spawn: Spawner;
  timer: Timer;
  clock: () => number;
  /** A fresh, unguessable nonce for each helper. */
  newNonce: () => string;
  /** The editor's own executable, which runs helper scripts. */
  runtime: string;
  /** The folder for endpoints (see runtimeFolder). */
  endpointFolder: string;
  processId: number;
  parentEnvironment: Readonly<Record<string, string | undefined>>;
  /** How long a helper may take to welcome a hello, a started one included. */
  helloLimitMilliseconds: number;
  /** How long a started helper may take to listen. */
  startLimitMilliseconds: number;
  /** How long to wait between attempts to reach a starting helper. */
  retryMilliseconds: number;
}

/** What a starter decides once it has the key: the start values of the helper, or why it will not start one. */
export type PreparedStart<Refusal> =
  | {
      kind: 'ready';
      options: Record<string, string | number | boolean>;
      payload: Record<string, string | number | boolean>;
    }
  | {kind: 'refused'; refusal: Refusal};

/** One helper to acquire. */
export interface AcquireRequest<Refusal = never> {
  /** The registry folder: per profile or per user, as the consumer needs. */
  folder: string;
  namespace: string;
  helperKey: string;
  /** The bundled helper script and its own start values. */
  script: string;
  policy: EndPolicy;
  /**
   * Called once, and only by the window that claims the key, after the claim and before the helper starts: it makes the
   * helper's start values and payload. A window that joins a running helper never calls it.
   */
  prepare: () => Promise<PreparedStart<Refusal>>;
  cancellation: AbortSignal;
}

/** Why no lease was acquired. */
export type AcquireFailure =
  'spawnFailed' | 'endpointUnreachable' | 'cancelled';

/** A lease, or why there is none. */
export type AcquireOutcome<Refusal = never> =
  | {kind: 'acquired'; lease: HelperLease}
  | ([Refusal] extends [never] ? never : {kind: 'refused'; refusal: Refusal})
  | {kind: 'failed'; failure: AcquireFailure};

function waitFor(timer: Timer, milliseconds: number): Promise<void> {
  return new Promise(resolve => {
    timer(milliseconds, resolve);
  });
}

/** Connects and says hello with the nonce; undefined when the helper does not welcome within the limit. */
async function hello(
  environment: ClientEnvironment,
  record: HelperRecord,
  startedByMe: boolean,
): Promise<HelperLease | undefined> {
  const started = environment.clock();
  const connection = await environment.endpoints
    .connect(record.endpoint)
    .catch(() => undefined);
  if (connection === undefined) {
    return undefined;
  }
  const welcome = await new Promise<
    Extract<HelperMessage, {type: 'welcome'}> | undefined
  >(resolve => {
    const cancel = environment.timer(environment.helloLimitMilliseconds, () => {
      resolve(undefined);
    });
    connection.onMessage(message => {
      cancel();
      // The first message of a helper of this library is its welcome.
      resolve(message as Extract<HelperMessage, {type: 'welcome'}>);
    });
    connection.onClose(() => {
      cancel();
      resolve(undefined);
    });
    connection.send({type: 'hello', nonce: record.nonce});
  });
  const answered = welcome !== undefined;
  if (
    !answered ||
    isStale(
      record,
      {
        answered,
        nonceMatched: true,
        elapsedMilliseconds: environment.clock() - started,
      },
      environment.helloLimitMilliseconds,
    )
  ) {
    connection.close();
    return undefined;
  }
  return new HelperLease(connection, welcome, startedByMe, environment.timer);
}

/**
 * Joins the helper a record names. A helper that does not answer is still alive while the window of its starter
 * counts, `startedAt` plus the start limit, so the hello is retried until that window has passed; only then is the
 * helper stale. Resolves to undefined when it is stale and to 'cancelled' when the request is cancelled.
 */
async function join(
  environment: ClientEnvironment,
  request: {cancellation: AbortSignal},
  record: HelperRecord,
): Promise<HelperLease | 'cancelled' | undefined> {
  const deadline = record.startedAt + environment.startLimitMilliseconds;
  for (;;) {
    if (request.cancellation.aborted) {
      return 'cancelled';
    }
    const lease = await hello(environment, record, false);
    if (lease !== undefined || environment.clock() >= deadline) {
      return lease;
    }
    await waitFor(environment.timer, environment.retryMilliseconds);
  }
}

/** Whether a signal has aborted; read again after each wait, since it can change while one waits. */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

/** Starts the helper of a claimed record with the prepared values, and waits until it welcomes, within the start limit. */
async function start<Refusal>(
  environment: ClientEnvironment,
  request: AcquireRequest<Refusal>,
  record: HelperRecord,
  prepared: Extract<PreparedStart<Refusal>, {kind: 'ready'}>,
): Promise<AcquireOutcome<Refusal>> {
  const recordFile = recordPath(
    request.folder,
    request.namespace,
    request.helperKey,
  );
  try {
    await environment.spawn(
      spawnSpecification(
        environment.runtime,
        request.script,
        {
          endpoint: record.endpoint,
          nonce: record.nonce,
          recordFile,
          policy: request.policy,
          payload: prepared.payload,
          options: prepared.options,
        },
        environment.parentEnvironment,
      ),
    );
  } catch {
    // The record names a helper that never ran; removing it frees the key at once.
    await environment.files.remove(recordFile);
    return {kind: 'failed', failure: 'spawnFailed'};
  }
  const deadline = environment.clock() + environment.startLimitMilliseconds;
  while (!isAborted(request.cancellation)) {
    const lease = await hello(environment, record, true);
    if (lease !== undefined) {
      return {kind: 'acquired', lease};
    }
    if (environment.clock() >= deadline) {
      return {kind: 'failed', failure: 'endpointUnreachable'};
    }
    await waitFor(environment.timer, environment.retryMilliseconds);
  }
  return {kind: 'failed', failure: 'cancelled'};
}

/** The lease of a join, or the end of the acquire when the join was cancelled; none when the record is stale. */
async function joined<Refusal>(
  environment: ClientEnvironment,
  request: AcquireRequest<Refusal>,
  record: HelperRecord,
): Promise<AcquireOutcome<Refusal> | undefined> {
  const lease = await join(environment, request, record);
  if (lease === 'cancelled') {
    return {kind: 'failed', failure: 'cancelled'};
  }
  return lease === undefined ? undefined : {kind: 'acquired', lease};
}

/**
 * Acquires a lease on the helper for the request's key: joins the helper that holds it, waiting for one that is still
 * starting, or else claims the key and starts the helper. A join never prepares anything. A window that will claim
 * prepares first, before the claim, so that the record's `startedAt`, which the join window of every other window
 * counts from, is stamped after the lookup the preparation may do and covers the spawn and the hello alone. A record
 * whose helper stays silent past its starter's window is replaced once; a helper that cannot be reached after that
 * is `endpointUnreachable`. The record carries no payload: the lease's payload is the one the helper welcomes with,
 * which the starter made in its preparation.
 */
export async function acquire<Refusal = never>(
  environment: ClientEnvironment,
  request: AcquireRequest<Refusal>,
): Promise<AcquireOutcome<Refusal>> {
  if (isAborted(request.cancellation)) {
    return {kind: 'failed', failure: 'cancelled'};
  }
  const text = await environment.files.read(
    recordPath(request.folder, request.namespace, request.helperKey),
  );
  const present = text === undefined ? undefined : parseRecord(text);
  if (present !== undefined) {
    const lease = await joined(environment, request, present);
    if (lease !== undefined) {
      return lease;
    }
  }
  const prepared = await request.prepare();
  if (prepared.kind === 'refused') {
    // `refused` is a member of the outcome whenever the request has a refusal to give.
    return prepared as AcquireOutcome<Refusal>;
  }
  if (isAborted(request.cancellation)) {
    return {kind: 'failed', failure: 'cancelled'};
  }
  const nonce = environment.newNonce();
  const record: HelperRecord = {
    version: 1,
    namespace: request.namespace,
    recordKey: request.helperKey,
    endpoint: endpointPath(
      environment.endpointFolder,
      request.namespace,
      request.helperKey,
      nonce,
    ),
    nonce,
    startedByProcessId: environment.processId,
    startedAt: environment.clock(),
    payload: {},
  };
  let staleText = text ?? '';
  if (text === undefined) {
    const claimed = await claim(
      environment.files,
      request.folder,
      request.namespace,
      request.helperKey,
      record,
    );
    if (claimed.outcome === 'claimed') {
      return start(environment, request, record, prepared);
    }
    if (claimed.outcome === 'existing') {
      const lease = await joined(environment, request, claimed.record);
      if (lease !== undefined) {
        return lease;
      }
      staleText = serializeRecord(claimed.record);
    } else {
      // A corrupt file that a rival left: what is there now is what gets replaced.
      staleText =
        (await environment.files.read(
          recordPath(request.folder, request.namespace, request.helperKey),
        )) ?? '';
    }
  }
  const replaced = await replaceStale(
    environment.files,
    request.folder,
    request.namespace,
    request.helperKey,
    record,
    staleText,
  );
  if (replaced.outcome === 'claimed') {
    return start(environment, request, record, prepared);
  }
  const lease =
    replaced.outcome === 'existing'
      ? await joined(environment, request, replaced.record)
      : undefined;
  return lease ?? {kind: 'failed', failure: 'endpointUnreachable'};
}

/** Sends hello and stop; whether the connection closes, as it does once the helper has ended, within the limit. */
function closesAfterStop(
  environment: ClientEnvironment,
  connection: EndpointConnection,
  nonce: string,
): Promise<boolean> {
  return new Promise(resolve => {
    const cancel = environment.timer(environment.helloLimitMilliseconds, () => {
      connection.close();
      resolve(false);
    });
    connection.onClose(() => {
      cancel();
      resolve(true);
    });
    connection.send({type: 'hello', nonce});
    connection.send({type: 'stop'});
  });
}

/**
 * Tells the helper that holds the key to end and waits for it to close, which means it has removed its own record.
 * A helper that does not answer or does not close within the limit is gone or hung: its record is removed then, if it
 * still carries the nonce read here. Done also when no helper runs.
 */
export async function stop(
  environment: ClientEnvironment,
  folder: string,
  namespace: string,
  helperKey: string,
): Promise<void> {
  const recordFile = recordPath(folder, namespace, helperKey);
  const text = await environment.files.read(recordFile);
  const record = text === undefined ? undefined : parseRecord(text);
  if (record === undefined) {
    return;
  }
  const connection = await environment.endpoints
    .connect(record.endpoint)
    .catch(() => undefined);
  const closed =
    connection !== undefined &&
    (await closesAfterStop(environment, connection, record.nonce));
  if (!closed) {
    await removeOwnRecord(environment.files, recordFile, record.nonce).catch(
      () => undefined,
    );
  }
}
