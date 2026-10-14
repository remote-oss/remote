/**
 * @fileoverview What the server acceptance tests share: script parameters for the stand-in server, the stand-in
 * archive on a started host, and the steps of the lifecycle as the extension would run them.
 */

import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {createServer} from 'node:net';
import path from 'node:path';
import {type Duplex, type WaitLimits} from 'lib-forwarding';
import type {HostChannel} from 'lib-host';
import {
  type HostLockLoop,
  hostLockLoopOf,
  runStep,
  type ScriptParameters,
  type StartedServer,
} from 'lib-server';
import type {RunningHost} from './host-fixture.ts';
import {
  STAND_IN_LAUNCHER,
  standInArchivePath,
  type StandInBehaviour,
  type StandInLayout,
  writeStandInArchive,
} from './stand-in-server.ts';

/** Where the archive of a stand-in behaviour lies on the host. */
export function hostArchiveOf(
  behaviour: StandInBehaviour = 'serving',
  layout: StandInLayout = 'wrapped',
): string {
  return `/tmp/stand-in-${behaviour}-${layout}.tar.gz`;
}

/** Where the archive of the serving stand-in lies on the host. */
export const HOST_ARCHIVE = hostArchiveOf();

/** The home folder of the host's user: the one the host image gives the user `harness`. */
export const HOST_HOME = '/home/harness';

/** The commit every test installs unless it says otherwise. */
const COMMIT = 'acceptancecommit';

let dataFolderCount = 0;

/**
 * The parameters of a step on the stand-in server, each call with a data folder of its own so that the tests of one
 * host do not see each other's servers.
 */
export function parametersFor(
  changes: Partial<ScriptParameters> = {},
): ScriptParameters {
  dataFolderCount += 1;
  return {
    installRoot: '',
    dataFolderName: `.stand-in-data-${String(dataFolderCount)}`,
    launcher: STAND_IN_LAUNCHER,
    commit: COMMIT,
    archiveUrl: 'https://example.invalid/server.tar.gz',
    archivePath: HOST_ARCHIVE,
    removeArchive: false,
    archiveFormat: 'tar.gz',
    epochMilliseconds: 1700000000000,
    installTree: '',
    proxy: {http: '', https: ''},
    downloader: {useConfigurationFiles: false, timeoutSeconds: 30},
    lock: {
      method: 'link',
      inTemporaryFolder: false,
      filePrefix: 'boot-lock.user',
    },
    environmentSetup: '',
    cleanup: {kind: 'keepNewest', count: 5},
    start: {
      bindHost: '127.0.0.1',
      port: '0',
      licenceAccepted: false,
      graceSeconds: 0,
      extensions: [],
      fileWatcherPollingMilliseconds: 0,
      useHostProxy: false,
      readySeconds: 10,
      socketMode: false,
    },
    ...changes,
  };
}

/** The data folder of a parameter set, on the host. */
export function dataFolderOf(parameters: ScriptParameters): string {
  return `${HOST_HOME}/${parameters.dataFolderName}`;
}

/** The install folder of a parameter set, on the host. */
export function installFolderOf(parameters: ScriptParameters): string {
  return `${dataFolderOf(parameters)}/bin/${parameters.commit}`;
}

/** Builds the stand-in archive of a behaviour and puts it on the host at `hostArchiveOf(behaviour)`. */
export function placeStandInArchive(
  host: RunningHost,
  behaviour: StandInBehaviour = 'serving',
  layout: StandInLayout = 'wrapped',
): void {
  const folder = mkdtempSync(path.join(tmpdir(), 'stand-in-'));
  try {
    const archive = standInArchivePath(folder);
    writeStandInArchive(archive, behaviour, layout);
    host.copyIn(archive, hostArchiveOf(behaviour, layout));
  } finally {
    rmSync(folder, {recursive: true, force: true});
  }
}

/**
 * Runs the install step once on the channel of a host or of a session, and returns the result block's status, or the
 * way the run failed.
 */
export async function installStatus(
  host: {channel: HostChannel},
  parameters: ScriptParameters,
): Promise<string> {
  const stepRun = await runStep(
    host.channel,
    {installMode: 'singleScript', step: 'install'},
    parameters,
    {cancellation: new AbortController().signal},
  );
  return stepRun.kind === 'result' ? stepRun.block.status : stepRun.kind;
}

/** The port on the host where a stand-in echo service listens. */
export const ECHO_PORT = 7777;

/** The longest a test waits for bytes to come back. */
const RECEIVE_BOUND_MILLISECONDS = 30000;

/** How long a forward waits for its tunnel, and how many bytes it may hold meanwhile. */
export const LIMITS: WaitLimits = {
  readyMilliseconds: 10000,
  retryMilliseconds: 100,
  heldBytesMaximum: 10_000_000,
};

/** The timers of the tests, over the real clock. */
export const scheduler = {
  setTimer: (milliseconds: number, callback: () => void) => {
    const timer = setTimeout(callback, milliseconds);
    return () => {
      clearTimeout(timer);
    };
  },
};

/** A free loopback port: bound and released at once. */
export function freePort(): Promise<number> {
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

/** The first `length` bytes the connection delivers; rejects when they have not arrived within the bound. */
export function receivedBytes(
  connection: Duplex,
  length: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(`only ${String(total)} of ${String(length)} bytes came`),
      );
    }, RECEIVE_BOUND_MILLISECONDS);
    connection.onData(chunk => {
      chunks.push(Buffer.from(chunk));
      total += chunk.length;
      if (total >= length) {
        clearTimeout(timer);
        resolve(Buffer.concat(chunks));
      }
    });
  });
}

/** The port of a started server that listens on one; -1 for a server on a socket, which no test here expects. */
export function portOfStarted(server: StartedServer): number {
  return server.endpoint.kind === 'port' ? server.endpoint.port : -1;
}

/** The real clock, for the host lock loop. */
const REAL_CLOCK = {
  now: Date.now,
  wait: (milliseconds: number) =>
    new Promise<void>(resolve => setTimeout(resolve, milliseconds)),
};

/** The host lock loop of the extension, with short waits so a test does not stand by for 30 seconds. */
export function lockLoop(
  attempts = 30,
  intervalMilliseconds = 100,
): HostLockLoop {
  return hostLockLoopOf(REAL_CLOCK, attempts, intervalMilliseconds);
}
