/**
 * @fileoverview The archive transfer (V4): gets the server archive onto the host and unpacked into its install
 * folder, by a download on the host, a download on the client followed by a delivery, or both, in the order the plan
 * gives.
 */

import path from 'node:path';
import {hostPathOf, type ChannelFailure, type HostChannel} from 'lib-host';
import type {Logger} from 'lib-log';
import {allowedRedirectHosts} from 'lib-product';
import type {Plan} from '../install/plan.ts';
import {runStep, type StepRun} from '../lifecycle/run-step.ts';
import type {HostLockLoop} from '../lifecycle/runtime.ts';
import type {Verification} from '../policy/record.ts';
import type {ScriptParameters} from '../scripts/bootstrap.ts';
import {
  parseProgressLine,
  type ProgressStep,
} from '../scripts/progress-line.ts';
import type {ScriptStatus} from '../scripts/result-block.ts';
import type {
  ClientFilePort,
  DownloadBounds,
  DownloadPort,
  DownloadResult,
} from './ports.ts';
import {verifyArchive} from './verify.ts';

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

/** Where a downloaded archive lives: a temporary file, or the cache that later connects reuse. */
export type ArchiveCache =
  | {kind: 'none'}
  | {
      /** The full path of the archive in the cache; the folder is the caller's. */
      kind: 'kept';
      archivePath: string;
    };

/** What one transfer is asked to do. */
export interface TransferInput {
  plan: DownloadPlan;
  /** The install step the archive goes to; the server's by default, the CLI's for the CLI. */
  step?: 'install' | 'installCli';
  /** The script parameters of the install; the plan's address and the archive's place are filled in here. */
  parameters: ScriptParameters;
  /** The client's temporary folder, where an archive that is not kept lives until the transfer ends. */
  clientFolder: string;
  cache: ArchiveCache;
  /** The limits of a download on the client, from the policy. */
  downloadBounds: DownloadBounds;
  /**
   * Makes the names of the transfer's files differ from those of every other transfer, in this window and in the
   * others, as the process id and a counter do; the epoch alone is shared by two starts in one millisecond.
   */
  temporaryToken: string;
  /** The checks of a downloaded archive, in order; the first whose facts the response gave decides. */
  verification: readonly Verification[];
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
  | {
      kind: 'serverDownload';
      cause: 'downloadFailed' | 'noDownloader' | 'tooLarge' | 'redirectHost';
    }
  | {
      kind: 'localDownload';
      /** What failed: the request on the network, an HTTP error status, or the client's file for the archive. */
      cause: 'network' | 'httpStatus' | 'clientFile';
      detail: string;
      status?: number;
    }
  | {kind: 'downloadTimeout'; reason: 'deadline' | 'stalled'}
  | {kind: 'verification'; mismatch: 'checksum' | 'length'}
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
    : kind === 'localDownload' ||
        kind === 'verification' ||
        kind === 'downloadTimeout';
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
    dependencies.logger.warn(`copied archive left at ${remotePath}`);
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
        {installMode: 'singleScript', step: input.step ?? 'install'},
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

/** Runs the install step without an archive of its own: for an install the host already has, the step answers at once. */
export function installPlaced(
  input: TransferInput,
  dependencies: TransferDependencies,
): Promise<TransferOutcome> {
  return install(input, dependencies, {archivePath: '', removeArchive: false});
}

/**
 * The host downloads the archive itself, then unpacks it in the same run: the install stage begins with the first
 * unpack progress line, which is when the window says so.
 */
function viaHost(
  input: TransferInput,
  dependencies: TransferDependencies,
): Promise<TransferOutcome> {
  dependencies.onPhase({kind: 'downloading'});
  let installing = false;
  return install(
    input,
    {
      ...dependencies,
      onPhase: phase => {
        if (
          !installing &&
          phase.kind === 'progress' &&
          phase.step === 'unpack'
        ) {
          installing = true;
          dependencies.onPhase({kind: 'installing'});
        }
        dependencies.onPhase(phase);
      },
    },
    {archivePath: '', removeArchive: false},
  );
}

/** What tells this transfer's files from every other transfer's: the start time and the caller's token. */
function uniqueSuffix(input: TransferInput): string {
  return `${String(input.parameters.epochMilliseconds)}-${input.temporaryToken}`;
}

/** The archive file name, which both the client and the host use. */
function archiveName(input: TransferInput): string {
  return `server-${input.parameters.commit}-${uniqueSuffix(input)}.${input.parameters.archiveFormat}`;
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
  const remotePath = `${input.hostFolder}/${archiveName(input)}`;
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

/** Why the downloaded archive was not kept, or nothing when the rename made it the cache entry. */
async function keep(
  files: ClientFilePort,
  source: string,
  destination: string,
): Promise<TransferOutcome | undefined> {
  const renamed = await files.rename(source, destination);
  if (renamed.kind === 'renamed' || (await files.exists(destination))) {
    // Another window that renamed first left a complete entry, which is as good.
    return undefined;
  }
  return failed({
    kind: 'localDownload',
    cause: 'clientFile',
    detail: renamed.detail,
  });
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

/** The failure of a download the port reported as failed. */
function downloadFailure(
  failure: Extract<DownloadResult, {kind: 'failed'}>,
): TransferOutcome {
  if (failure.cause === 'tooLarge') {
    return failed({kind: 'serverDownload', cause: 'tooLarge'});
  }
  if (failure.cause === 'deadline' || failure.cause === 'stalled') {
    return failed({kind: 'downloadTimeout', reason: failure.cause});
  }
  return failed({
    kind: 'localDownload',
    cause:
      failure.cause === 'httpStatus' || failure.cause === 'clientFile'
        ? failure.cause
        : 'network',
    detail: failure.detail,
    ...(failure.status === undefined ? {} : {status: failure.status}),
  });
}

/**
 * The port's answer, or the failure `deadline` when the time runs out first, even if the port never answers. A
 * cancellation of the caller is a cancellation.
 */
function answerWithin(
  answer: Promise<DownloadResult>,
  limit: AbortSignal,
  cancellation: AbortSignal,
): Promise<DownloadResult> {
  return new Promise((resolve, reject) => {
    function settle(): void {
      resolve(
        cancellation.aborted
          ? {kind: 'cancelled'}
          : {kind: 'failed', detail: '', cause: 'deadline'},
      );
    }
    if (limit.aborted) {
      settle();
    } else {
      limit.addEventListener('abort', settle, {once: true});
    }
    answer.then(resolve, reject);
  });
}

/** How strong a scheme is: https above http, and any other scheme is no download at all. */
function schemeStrength(address: URL): number {
  if (address.protocol === 'https:') {
    return 2;
  }
  return address.protocol === 'http:' ? 1 : 0;
}

/**
 * Whether a final address is on the source's host or on a host the product table lists for that source, and not
 * reached over a weaker scheme than the source's.
 */
function isAllowedFinalHost(
  sourceAddress: string,
  finalAddress: string,
): boolean {
  if (!URL.canParse(finalAddress) || !URL.canParse(sourceAddress)) {
    return false;
  }
  const source = new URL(sourceAddress);
  const final = new URL(finalAddress);
  const finalHost = final.hostname.toLowerCase();
  const sourceHost = source.hostname.toLowerCase();
  return (
    schemeStrength(final) >= Math.max(schemeStrength(source), 1) &&
    (finalHost === sourceHost ||
      allowedRedirectHosts(sourceHost).includes(finalHost))
  );
}

/** The hosts a download from the source address may end on: the source's own and the ones the table lists for it. */
function allowedHostsOf(sourceAddress: string): readonly string[] {
  if (!URL.canParse(sourceAddress)) {
    return [];
  }
  const sourceHost = new URL(sourceAddress).hostname.toLowerCase();
  return [sourceHost, ...allowedRedirectHosts(sourceHost)];
}

/** An address for the log: its origin and path, never the query, the fragment or a user name, which may hold a token. */
function addressForLog(address: string): string {
  if (!URL.canParse(address)) {
    return '(not an address)';
  }
  const parsed = new URL(address);
  return `${parsed.origin}${parsed.pathname}`;
}

/**
 * Downloads the archive to `destination` and checks it. The failure when it did not work, or nothing when the file is
 * good. The time and the size are bounded, the final host must be the source's or one the table lists for it, and
 * the final address is logged.
 */
async function fetchVerified(
  input: TransferInput,
  dependencies: TransferDependencies,
  destination: string,
): Promise<TransferOutcome | undefined> {
  const limit = AbortSignal.any([
    input.cancellation,
    AbortSignal.timeout(input.downloadBounds.deadlineMilliseconds),
  ]);
  const downloaded = await answerWithin(
    dependencies.download.download({
      address: input.plan.address,
      destination,
      cancellation: limit,
      allowedHosts: allowedHostsOf(input.plan.address),
      ...input.downloadBounds,
      onPercent: percent => {
        dependencies.onPhase({kind: 'progress', step: 'download', percent});
      },
    }),
    limit,
    input.cancellation,
  );
  if (downloaded.kind === 'failed') {
    return downloadFailure(downloaded);
  }
  if (downloaded.kind === 'cancelled') {
    return failed({kind: 'cancelled'});
  }
  dependencies.logger.info(
    `downloaded from ${addressForLog(downloaded.finalAddress)}`,
  );
  if (!isAllowedFinalHost(input.plan.address, downloaded.finalAddress)) {
    return failed({kind: 'serverDownload', cause: 'redirectHost'});
  }
  if (
    (await dependencies.files.size(destination)) >
    input.downloadBounds.maximumBytes
  ) {
    return failed({kind: 'serverDownload', cause: 'tooLarge'});
  }
  const verdict = await verifyArchive(
    destination,
    downloaded.facts,
    input.verification,
    dependencies.files,
  );
  return verdict === 'verified'
    ? undefined
    : failed({
        kind: 'verification',
        mismatch: verdict === 'checksumMismatch' ? 'checksum' : 'length',
      });
}

/** Whether the host could not unpack the archive it was given. */
function unpackFailed(outcome: TransferOutcome): boolean {
  return outcome.kind === 'failed' && outcome.failure.kind === 'unpack';
}

/**
 * The client downloads the archive, or finds it in the cache. A download goes to a temporary file, is checked, and
 * then either becomes the cache entry by a rename or is deleted when the transfer ends. An entry that was found and
 * that the host cannot unpack is deleted and downloaded once more, so a bad entry does not fail every later connect.
 */
async function viaClient(
  input: TransferInput,
  dependencies: TransferDependencies,
): Promise<TransferOutcome> {
  const {cache} = input;
  if (
    cache.kind === 'kept' &&
    (await dependencies.files.exists(cache.archivePath))
  ) {
    const found = await deliver(input, dependencies, cache.archivePath);
    if (!unpackFailed(found)) {
      return found;
    }
    await removeQuietly(dependencies.files, cache.archivePath);
  }
  dependencies.onPhase({kind: 'downloadingLocally'});
  const temporary =
    cache.kind === 'kept'
      ? `${cache.archivePath}_${uniqueSuffix(input)}`
      : path.join(input.clientFolder, archiveName(input));
  try {
    const failure = await fetchVerified(input, dependencies, temporary);
    if (failure !== undefined) {
      return failure;
    }
    if (cache.kind === 'none') {
      return await deliver(input, dependencies, temporary);
    }
    const notKept = await keep(
      dependencies.files,
      temporary,
      cache.archivePath,
    );
    return notKept ?? (await deliver(input, dependencies, cache.archivePath));
  } finally {
    await removeQuietly(dependencies.files, temporary);
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
