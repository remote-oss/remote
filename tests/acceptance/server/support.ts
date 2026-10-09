/**
 * @fileoverview What the server acceptance tests share: script parameters for the stand-in server, the stand-in
 * archive on a started host, and the steps of the lifecycle as the extension would run them.
 */

import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  type HostLockLoop,
  hostLockLoop,
  runStep,
  type ScriptParameters,
  type StepRun,
} from 'lib-server';
import type {RunningHost} from './host-fixture.ts';
import {
  STAND_IN_LAUNCHER,
  standInArchivePath,
  type StandInBehaviour,
  writeStandInArchive,
} from './stand-in-server.ts';

/** Where the archive of a stand-in behaviour lies on the host. */
export function hostArchiveOf(behaviour: StandInBehaviour = 'serving'): string {
  return `/tmp/stand-in-${behaviour}.tar.gz`;
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
      readySeconds: 10,
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
): void {
  const folder = mkdtempSync(path.join(tmpdir(), 'stand-in-'));
  try {
    const archive = standInArchivePath(folder);
    writeStandInArchive(archive, behaviour);
    host.copyIn(archive, hostArchiveOf(behaviour));
  } finally {
    rmSync(folder, {recursive: true, force: true});
  }
}

/** Runs the install step once and returns the result block's status, or the way the run failed. */
export async function installStatus(
  host: RunningHost,
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
  return async step => {
    const outcome = await hostLockLoop<StepRun>(
      async () => {
        const stepRun = await step();
        return stepRun.kind === 'result' && stepRun.block.status === 'LockBusy'
          ? {kind: 'lockBusy'}
          : {kind: 'result', value: stepRun};
      },
      REAL_CLOCK,
      () => undefined,
      attempts,
      intervalMilliseconds,
    );
    return outcome.kind === 'done' ? outcome.value : 'retriesExhausted';
  };
}
