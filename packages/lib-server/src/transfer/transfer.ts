/**
 * @fileoverview The archive transfer (V4): gets the server archive onto the host and unpacked into its install
 * folder, by a download on the host, a download on the client followed by a delivery, or both, in the order the plan
 * gives.
 */

import path from 'node:path';
import {hostPathOf, type ChannelFailure, type HostChannel} from 'lib-host';
import type {Logger} from 'lib-log';
import type {Plan} from '../install/plan.ts';
import {runStep, type StepRun} from '../lifecycle/run-step.ts';
import type {HostLockLoop} from '../lifecycle/runtime.ts';
import type {ScriptParameters} from '../scripts/bootstrap.ts';
import {
  parseProgressLine,
  type ProgressStep,
} from '../scripts/progress-line.ts';
import type {ScriptStatus} from '../scripts/result-block.ts';
import type {ClientFilePort, DownloadPort} from './ports.ts';

/** The plan of an install that needs an archive. */
export type DownloadPlan = Extract<Plan, {kind: 'download'}>;

/** A stage of the transfer, for the caller to show. */
export type TransferPhase =
  | {kind: 'downloading'}
  | {kind: 'downloadingLocally'}
  | {kind: 'copying'}
  | {kind: 'installing'}
  | {kind: 'progress'; step: ProgressStep; percent: number};

/**
 * How long the deletion of a copied archive may take after a failure, in milliseconds. The deletion runs after a
 * cancellation too, so a stalled connection must not hold the result back.
 */
export const DISCARD_DEADLINE_MILLISECONDS = 5000;

/** What one transfer is asked to do. */
export interface TransferInput {
  plan: DownloadPlan;
  /** The script parameters of the install; the plan's address and the archive's place are filled in here. */
  parameters: ScriptParameters;
  /** The client's temporary folder, where a downloaded archive lives until the transfer ends. */
  clientFolder: string;
  /** The host's temporary folder, where a copied archive lands. */
  hostFolder: string;
  cancellation: AbortSignal;
  /** The most the deletion of a copied archive may wait, after which the leftover is logged; see the default above. */
  discardDeadlineMilliseconds: number;
}

/** What the transfer needs from its surroundings. */
export interface TransferDependencies {
  channel: HostChannel;
  download: DownloadPort;
  files: ClientFilePort;
  lockLoop: HostLockLoop;
  logger: Logger;
  onPhase: (phase: TransferPhase) => void;
}

/** Why the server is not installed. */
export type TransferFailure =
  | {kind: 'serverDownload'; cause: 'downloadFailed' | 'noDownloader'}
  | {kind: 'localDownload'; detail: string}
  | {kind: 'unpack'}
  | {kind: 'copy'; failure: ChannelFailure}
  | {kind: 'cancelled'}
  | {kind: 'retriesExhausted'}
  | {kind: 'scriptFailed'; status: ScriptStatus}
  | {kind: 'noResultBlock'}
  | {kind: 'channelFailed'; failure: ChannelFailure};

/** The outcome of a transfer. */
export type TransferOutcome =
  | {kind: 'transferred'; installFolder: string}
  | {kind: 'failed'; failure: TransferFailure};

/** Where the archive is downloaded. */
type Source = 'host' | 'client';

/** Where the archive is, and whether the install deletes it. */
interface Delivery {
  archivePath: string;
  removeArchive: boolean;
}

function failed(failure: TransferFailure): TransferOutcome {
  return {kind: 'failed', failure};
}

/** A channel failure as a transfer failure: a cancellation stays a cancellation. */
function channelFailure(failure: ChannelFailure): TransferFailure {
  return failure.kind === 'cancelled'
    ? {kind: 'cancelled'}
    : {kind: 'channelFailed', failure};
}

/** The transfer outcome of a finished install step. */
function outcomeOf(
  stepRun: StepRun | 'retriesExhausted',
  plan: DownloadPlan,
): TransferOutcome {
  if (stepRun === 'retriesExhausted') {
    return failed({kind: 'retriesExhausted'});
  }
  if (stepRun.kind === 'channelFailed') {
    return failed(channelFailure(stepRun.failure));
  }
  if (stepRun.kind === 'noResultBlock') {
    return failed({kind: 'noResultBlock'});
  }
  const {block} = stepRun;
  switch (block.status) {
    case 'Ok':
      return {
        kind: 'transferred',
        installFolder: block.serverFacts.installDir ?? plan.installFolder,
      };
    case 'ServerDownloadFailed':
      return failed({kind: 'serverDownload', cause: 'downloadFailed'});
    case 'NoDownloaderAvailable':
      return failed({kind: 'serverDownload', cause: 'noDownloader'});
    case 'UnpackFailed':
      return failed({kind: 'unpack'});
    default:
      return failed({kind: 'scriptFailed', status: block.status});
  }
}

/**
 * Whether the other source is tried after this failure. A host that cannot download or cannot unpack what it got
 * falls back to the client; a client that cannot download falls back to the host.
 */
function fallsBack(source: Source, outcome: TransferOutcome): boolean {
  if (outcome.kind !== 'failed') {
    return false;
  }
  const {kind} = outcome.failure;
  return source === 'host'
    ? kind === 'serverDownload' || kind === 'unpack'
    : kind === 'localDownload';
}

/**
 * Whether the install script may have left a copied archive on the host: it removes the archive on every status it
 * reports, so only the endings it never reported are left.
 */
function leftArchive(outcome: TransferOutcome): boolean {
  return (
    outcome.kind === 'failed' &&
    (outcome.failure.kind === 'cancelled' ||
      outcome.failure.kind === 'channelFailed' ||
      outcome.failure.kind === 'noResultBlock' ||
      outcome.failure.kind === 'retriesExhausted')
  );
}

/**
 * Deletes a copied archive through the channel, as far as the host can still be reached. It runs even when the
 * transfer was cancelled, so it has a deadline of its own; an archive it could not delete is logged.
 */
async function discardCopy(
  input: TransferInput,
  dependencies: TransferDependencies,
  remotePath: string,
): Promise<void> {
  const stepRun = await runStep(
    dependencies.channel,
    {installMode: 'singleScript', step: 'discard'},
    {...input.parameters, archivePath: remotePath, removeArchive: true},
    {
      cancellation: AbortSignal.timeout(input.discardDeadlineMilliseconds),
    },
  );
  if (stepRun.kind !== 'result' || stepRun.block.status !== 'Ok') {
    dependencies.logger.warn(`copied archive left on the host: ${remotePath}`);
  }
}

/** Runs the install step with the archive where `delivery` says, and reads how it ended. */
async function install(
  input: TransferInput,
  dependencies: TransferDependencies,
  delivery: Delivery,
): Promise<TransferOutcome> {
  const parameters: ScriptParameters = {
    ...input.parameters,
    archiveUrl: input.plan.address,
    ...delivery,
  };
  const stepRun = await dependencies.lockLoop(
    () =>
      runStep(
        dependencies.channel,
        {installMode: 'singleScript', step: 'install'},
        parameters,
        {
          cancellation: input.cancellation,
          onLine: line => {
            const progress = parseProgressLine(line);
            if (progress !== undefined) {
              dependencies.onPhase({kind: 'progress', ...progress});
            }
          },
        },
      ),
    input.cancellation,
  );
  return outcomeOf(stepRun, input.plan);
}

/** The host downloads the archive itself. */
function viaHost(
  input: TransferInput,
  dependencies: TransferDependencies,
): Promise<TransferOutcome> {
  dependencies.onPhase({kind: 'downloading'});
  return install(input, dependencies, {archivePath: '', removeArchive: false});
}

/** The archive file name, which both the client and the host use. */
function archiveName(parameters: ScriptParameters): string {
  return `server-${parameters.commit}-${String(parameters.epochMilliseconds)}.${parameters.archiveFormat}`;
}

/**
 * Puts the downloaded archive in reach of the host, where the host reads the client's file in place or after a copy
 * to its temporary folder, and installs from it.
 */
async function deliver(
  input: TransferInput,
  dependencies: TransferDependencies,
  localFile: string,
): Promise<TransferOutcome> {
  const direct = await hostPathOf(dependencies.channel, localFile);
  if (direct !== undefined) {
    dependencies.onPhase({kind: 'installing'});
    return install(input, dependencies, {
      archivePath: direct,
      removeArchive: false,
    });
  }
  dependencies.onPhase({kind: 'copying'});
  const remotePath = `${input.hostFolder}/${archiveName(input.parameters)}`;
  const copied = await dependencies.channel.copyToHost({
    localFile,
    remotePath,
    cancellation: input.cancellation,
  });
  if (copied.kind === 'failed') {
    await discardCopy(input, dependencies, remotePath);
    return failed(
      copied.failure.kind === 'cancelled'
        ? {kind: 'cancelled'}
        : {kind: 'copy', failure: copied.failure},
    );
  }
  dependencies.onPhase({kind: 'installing'});
  const outcome = await install(input, dependencies, {
    archivePath: remotePath,
    removeArchive: true,
  });
  if (leftArchive(outcome)) {
    await discardCopy(input, dependencies, remotePath);
  }
  return outcome;
}

/** Deletes a client file. A file that cannot be deleted now is left to the temporary folder's own clean-up. */
async function removeQuietly(
  files: ClientFilePort,
  file: string,
): Promise<void> {
  try {
    await files.remove(file);
  } catch {
    // The failure to delete must not replace the outcome of the transfer.
  }
}

/** The client downloads the archive to a temporary file, which is deleted when the transfer ends. */
async function viaClient(
  input: TransferInput,
  dependencies: TransferDependencies,
): Promise<TransferOutcome> {
  dependencies.onPhase({kind: 'downloadingLocally'});
  const localFile = path.join(
    input.clientFolder,
    archiveName(input.parameters),
  );
  try {
    const downloaded = await dependencies.download.download({
      address: input.plan.address,
      destination: localFile,
      cancellation: input.cancellation,
      onPercent: percent => {
        dependencies.onPhase({kind: 'progress', step: 'download', percent});
      },
    });
    if (downloaded.kind === 'failed') {
      return failed({kind: 'localDownload', detail: downloaded.detail});
    }
    if (downloaded.kind === 'cancelled') {
      return failed({kind: 'cancelled'});
    }
    return await deliver(input, dependencies, localFile);
  } finally {
    await removeQuietly(dependencies.files, localFile);
  }
}

/**
 * Installs the server archive on the host with the single-script install. The plan says where the download runs
 * first and whether the other side is tried after a failure to download; the archive reaches the host by being
 * downloaded there, by the host reading the client's file in place, or by a copy.
 */
export async function transfer(
  input: TransferInput,
  dependencies: TransferDependencies,
): Promise<TransferOutcome> {
  const first: Source = input.plan.where;
  const outcome = await (first === 'host' ? viaHost : viaClient)(
    input,
    dependencies,
  );
  if (!input.plan.clientFallback || !fallsBack(first, outcome)) {
    return outcome;
  }
  return (first === 'host' ? viaClient : viaHost)(input, dependencies);
}
