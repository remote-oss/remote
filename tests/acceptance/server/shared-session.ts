/**
 * @fileoverview The shared connection of the acceptance tests: the helper of a host run inside the test process on
 * real sockets and the real `ssh` client, a window's lease on it, and the host channel that runs scripts on its one
 * `ssh` session.
 */

import {mkdtempSync, rmSync} from 'node:fs';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {type HelperParameters, nodeEndpointPort} from 'lib-helper';
import {MemoryFilePort} from 'lib-helper/testing/memory-file-port';
import {
  acquireConnection,
  type ConnectOutcome,
  nodeLauncherFiles,
  nodeLocalFiles,
  nodeProcessSpawner,
  runConnectionHelper,
  SharedSessionChannel,
  type SshRequest,
} from 'lib-ssh';
import type {RunningHost} from './host-fixture.ts';

const PARAMETERS = 'REMOTE_OSS_HELPER_PARAMETERS';

const GRACE_MILLISECONDS = 200;

/** A shared connection to a host and what to do with it. */
export interface SharedSession {
  /** The host channel whose scripts run on the shared `ssh` session. */
  channel: SharedSessionChannel;
  /** The loopback port of the SOCKS forward that rides the same session. */
  socksPort: number;
  /** Ends the window's lease and the helper. */
  stop(): Promise<void>;
}

/** A free loopback port: bound and released at once. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        resolve(
          typeof address === 'object' && address !== null ? address.port : 0,
        );
      });
    });
  });
}

function setTimer(milliseconds: number, callback: () => void): () => void {
  const timer = setTimeout(callback, milliseconds);
  return () => {
    clearTimeout(timer);
  };
}

/** How an attempt at a shared session ended: the session, or why the login failed; and what the helper logged. */
export type SharedSessionAttempt =
  | {kind: 'connected'; session: SharedSession; logged: string[]}
  | {
      kind: 'failed';
      failure: Extract<ConnectOutcome, {kind: 'failed'}>['failure'];
      logged: string[];
      stop(): Promise<void>;
    };

/**
 * Starts the helper of the host, takes a lease and waits for the login: the channel over its session when the login
 * succeeds, or the failure the window is told, with the lines the helper logged.
 */
export async function attemptSharedSession(
  host: RunningHost,
): Promise<SharedSessionAttempt> {
  const runtimeFolder = mkdtempSync(path.join(tmpdir(), 'shared-session-'));
  const files = new MemoryFilePort();
  const endpoints = nodeEndpointPort();
  let nonces = 0;
  function newNonce(): string {
    nonces += 1;
    return `acceptance${String(nonces)}${Date.now().toString(16)}`;
  }
  const helpers: Array<Promise<unknown>> = [];
  const logged: string[] = [];
  const environment = {
    freePort,
    helper: {
      files,
      endpoints,
      spawn: (specification: {environment: Record<string, string>}) => {
        const parameters = JSON.parse(
          specification.environment[PARAMETERS] ?? '',
        ) as HelperParameters;
        helpers.push(
          runConnectionHelper({
            parameters,
            port: endpoints,
            clock: Date.now,
            scheduler: {setTimer},
            files,
            launcherFiles: nodeLauncherFiles,
            newNonce,
            spawner: nodeProcessSpawner,
            editorEnvironment: process.env,
            helloLimitMilliseconds: 2000,
            logLine: line => logged.push(line),
          }),
        );
        return Promise.resolve();
      },
      timer: setTimer,
      clock: Date.now,
      newNonce,
      runtime: process.execPath,
      endpointFolder: runtimeFolder,
      processId: process.pid,
      parentEnvironment: process.env,
      helloLimitMilliseconds: 2000,
      startLimitMilliseconds: 10000,
      retryMilliseconds: 50,
    },
  };
  const request: SshRequest = {...host.base, purpose: 'connection'};
  const acquired = await acquireConnection(
    environment,
    {
      folder: path.join(runtimeFolder, 'registry'),
      hostString: 'harness',
      script: 'unused: the helper runs in this process',
      options: {
        request: JSON.stringify(request),
        unboundedWaitSeconds: 60,
        runtimeFolder,
        runtime: process.execPath,
        askpassProgram: 'unused: key login asks nothing',
        displayHost: 'harness',
        externalAskpass: false,
        askpassFirstMessageMilliseconds: 5000,
      },
      policy: {kind: 'graceAfterLastLease', milliseconds: GRACE_MILLISECONDS},
      cancellation: new AbortController().signal,
    },
    {requestMilliseconds: 10000, loginMilliseconds: 60000},
  );
  if (acquired.kind !== 'acquired') {
    throw new Error(`no lease on the helper: ${acquired.failure}`);
  }
  const {connection} = acquired;
  const connected = await connection.connect(new AbortController().signal);
  async function stop(): Promise<void> {
    connection.release();
    await Promise.all(helpers);
    rmSync(runtimeFolder, {recursive: true, force: true});
  }
  if (connected.kind !== 'connected') {
    return {kind: 'failed', failure: connected.failure, logged, stop};
  }
  return {
    kind: 'connected',
    logged,
    session: {
      socksPort: connected.socksPort,
      channel: new SharedSessionChannel({
        session: connection,
        direct: host.channel,
        files: nodeLocalFiles,
        runDeadlineMilliseconds: 60000,
        runWaitMilliseconds: 120000,
        maximumInputBytes: 16 * 1024 * 1024,
      }),
      stop,
    },
  };
}

/** Starts the helper of the host, takes a lease, waits for the login, and gives the channel over its session. */
export async function openSharedSession(
  host: RunningHost,
): Promise<SharedSession> {
  const attempt = await attemptSharedSession(host);
  if (attempt.kind === 'failed') {
    await attempt.stop();
    throw new Error(`no connection: ${JSON.stringify(attempt.failure)}`);
  }
  return attempt.session;
}
