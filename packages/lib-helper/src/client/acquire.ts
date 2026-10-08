/**
 * @fileoverview The client side of a helper: acquire a lease (claim the key and start the helper, or join the
 * helper that holds it, replacing a stale one once), and stop a helper.
 */

import {endpointPath} from '../endpoint/path.ts';
import type {EndpointPort, HelperMessage} from '../endpoint/protocol.ts';
import {claim} from '../registry/claim.ts';
import {recordPath, type RegistryFilePort} from '../registry/file-port.ts';
import {isStale, replaceStale} from '../registry/stale.ts';
import {type EndPolicy, type HelperRecord, parseRecord} from '../types.ts';
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

/** One helper to acquire. */
export interface AcquireRequest {
  /** The registry folder: per profile or per user, as the consumer needs. */
  folder: string;
  namespace: string;
  helperKey: string;
  /** The bundled helper script and its own start values. */
  script: string;
  options: Record<string, string | number | boolean>;
  policy: EndPolicy;
  payload: Record<string, string | number | boolean>;
  cancellation: AbortSignal;
}

/** Why no lease was acquired. */
export type AcquireFailure =
  'spawnFailed' | 'endpointUnreachable' | 'cancelled';

/** A lease, or why there is none. */
export type AcquireOutcome =
  | {kind: 'acquired'; lease: HelperLease}
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

/** Starts the helper of a claimed record and waits until it welcomes, within the start limit. */
async function start(
  environment: ClientEnvironment,
  request: AcquireRequest,
  record: HelperRecord,
): Promise<AcquireOutcome> {
  try {
    await environment.spawn(
      spawnSpecification(
        environment.runtime,
        request.script,
        {
          endpoint: record.endpoint,
          nonce: record.nonce,
          policy: request.policy,
          payload: request.payload,
          options: request.options,
        },
        environment.parentEnvironment,
      ),
    );
  } catch {
    // The record names a helper that never ran; removing it frees the key at once.
    await environment.files.remove(
      recordPath(request.folder, request.namespace, request.helperKey),
    );
    return {kind: 'failed', failure: 'spawnFailed'};
  }
  const deadline = environment.clock() + environment.startLimitMilliseconds;
  while (!request.cancellation.aborted) {
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

/**
 * Acquires a lease on the helper for the request's key: claims the key and starts the helper, or joins the helper
 * that holds it. A record whose helper does not answer is replaced once; a helper that cannot be reached after that
 * is `endpointUnreachable`.
 */
export async function acquire(
  environment: ClientEnvironment,
  request: AcquireRequest,
): Promise<AcquireOutcome> {
  if (request.cancellation.aborted) {
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
    payload: request.payload,
  };
  const claimed = await claim(
    environment.files,
    request.folder,
    request.namespace,
    request.helperKey,
    record,
  );
  if (claimed.outcome === 'claimed') {
    return start(environment, request, record);
  }
  if (claimed.outcome === 'existing') {
    const lease = await hello(environment, claimed.record, false);
    if (lease !== undefined) {
      return {kind: 'acquired', lease};
    }
  }
  const replaced = await replaceStale(
    environment.files,
    request.folder,
    request.namespace,
    request.helperKey,
    record,
  );
  if (replaced.outcome === 'claimed') {
    return start(environment, request, record);
  }
  const lease =
    replaced.outcome === 'existing'
      ? await hello(environment, replaced.record, false)
      : undefined;
  return lease === undefined
    ? {kind: 'failed', failure: 'endpointUnreachable'}
    : {kind: 'acquired', lease};
}

/** Tells the helper that holds the key to end; done also when no helper runs or it cannot be reached. */
export async function stop(
  environment: ClientEnvironment,
  folder: string,
  namespace: string,
  helperKey: string,
): Promise<void> {
  const text = await environment.files.read(
    recordPath(folder, namespace, helperKey),
  );
  const record = text === undefined ? undefined : parseRecord(text);
  const connection =
    record === undefined
      ? undefined
      : await environment.endpoints
          .connect(record.endpoint)
          .catch(() => undefined);
  if (record === undefined || connection === undefined) {
    return;
  }
  connection.send({type: 'hello', nonce: record.nonce});
  connection.send({type: 'stop'});
  connection.close();
}
