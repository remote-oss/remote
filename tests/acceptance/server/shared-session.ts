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

/** Starts the helper of the host, takes a lease, waits for the login, and gives the channel over its session. */
export async function openSharedSession(
  host: RunningHost,
): Promise<SharedSession> {
  const runtimeFolder = mkdtempSync(path.join(tmpdir(), 'shared-session-'));
  const files = new MemoryFilePort();
  const endpoints = nodeEndpointPort();
  let nonces = 0;
  function newNonce(): string {
    nonces += 1;
    return `acceptance${String(nonces)}${Date.now().toString(16)}`;
  }
  const helpers: Array<Promise<unknown>> = [];
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
            logLine: () => undefined,
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
  if (connected.kind !== 'connected') {
    throw new Error(`no connection: ${JSON.stringify(connected.failure)}`);
  }
  return {
    socksPort: connected.socksPort,
    channel: new SharedSessionChannel({
      session: connection,
      direct: host.channel,
      files: nodeLocalFiles,
      runDeadlineMilliseconds: 60000,
      runWaitMilliseconds: 120000,
      maximumInputBytes: 16 * 1024 * 1024,
    }),
    stop: async () => {
      connection.release();
      await Promise.all(helpers);
      rmSync(runtimeFolder, {recursive: true, force: true});
    },
  };
}
