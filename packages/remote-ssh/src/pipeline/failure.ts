/**
 * @fileoverview What a failed connect looks like to the window, and how each failure of the steps behind it becomes
 * one: the closed list of kinds, the reading of every library's failures, and the rule that says whether the editor
 * should try again.
 */

import type {Failed, FailureReason} from 'lib-authority';
import type {ChannelFailure} from 'lib-host';
import type {
  PlanFailure,
  ProbeFailure,
  ScriptStatus,
  StartFailure,
  CliServeError,
  TransferFailure,
} from 'lib-server';
import type {AcquireFailure} from 'lib-helper';
import type {TemplateProblem} from 'lib-product';
import type {ConnectionFailure, FailureHint, FailureKind} from 'lib-ssh';

/** The kinds of a failed connect: the failures of `ssh` itself and those of the server install and start. */
export type FailedKind =
  | FailureKind
  | 'unsupportedPlatform'
  | 'prerequisiteMissing'
  | 'noServerSource'
  | 'invalidServerTemplate'
  | 'licenceDeclined'
  | 'serverDownload'
  | 'serverInstall'
  | 'serverStart'
  | 'invalidSetting'
  | 'preconnectFailed'
  /** Reserved for the client-side lock on the host; no step reports it yet. */
  | 'lockTimeout'
  | 'retriesExhausted'
  | 'cancelled';

/** The kind of a failure and the reason it gives, before the connect adds what it knows around it. */
export interface FailureDetail {
  kind: FailedKind;
  /** Absent when the failure has no reason of its own; the window then names only the host. */
  reason?: FailureReason;
  /** What the library said, for the log only; never shown. */
  logDetail?: string;
}

/** A failure that shows no library text: the library's words go to the log. */
function logged(
  kind: FailedKind,
  logDetail: string | undefined,
  reason?: FailureReason,
): FailureDetail {
  return {
    kind,
    ...(reason === undefined ? {} : {reason}),
    ...(logDetail === undefined || logDetail === '' ? {} : {logDetail}),
  };
}

/** The reason of a server install that failed: the extension's own text. */
const INSTALL_FAILED: FailureReason = {id: 'S075'};

/** The reason of a server download that failed: the extension's own text. */
const DOWNLOAD_FAILED: FailureReason = {id: 'S043'};

/**
 * What a failed client download's reason names: `Failed to fetch` for the network, `Server returned <status>` for an
 * HTTP error status, and the file system's own text for the client's file.
 */
function localDownloadValue(
  failure: Extract<TransferFailure, {kind: 'localDownload'}>,
): string {
  if (failure.cause === 'httpStatus') {
    return `Server returned ${String(failure.status)}`;
  }
  return failure.cause === 'clientFile' ? failure.detail : 'Failed to fetch';
}

/** The failure of a host channel: a closed or timed out connection, a cancel, or a copy that did not work. */
export function ofChannel(failure: ChannelFailure): FailureDetail {
  switch (failure.kind) {
    case 'channelClosed':
      return logged('channelClosed', failure.detail);
    case 'timeout':
      return logged('timeout', failure.detail);
    case 'cancelled':
      return {kind: 'cancelled'};
    case 'copyToolMissing':
      return logged('prerequisiteMissing', failure.detail);
    case 'copyFailed':
      return logged('serverInstall', failure.detail, INSTALL_FAILED);
    default:
      return logged('unknown', failure.detail);
  }
}

const STATUS_KINDS: ReadonlyMap<string, FailedKind> = new Map<
  ScriptStatus,
  FailedKind
>([
  ['LockBusy', 'retriesExhausted'],
  ['NoDownloaderAvailable', 'serverDownload'],
  ['UnpackFailed', 'serverInstall'],
  ['ServerDownloadFailed', 'serverDownload'],
  ['CreateInstallDirFailed', 'serverInstall'],
  ['UnsupportedArch', 'unsupportedPlatform'],
  ['UnsupportedPlatform', 'unsupportedPlatform'],
  ['LinuxPrereqs', 'prerequisiteMissing'],
  ['NoBash', 'prerequisiteMissing'],
  ['ServerFailedToStart', 'serverStart'],
]);

/** The hint that the host lock can be kept in the temporary folder, for a lock file the host could not use. */
const LOCK_HINT =
  "The host lock file can't be used here. On a distributed file system such as NFS or AFS, setting remote.SSH.lockfilesInTmp to true keeps the lock in /tmp.";

/** The log text of a write failure: the path and the error, then the hint when the unusable file is a lock outside /tmp. */
function writeDetail(failure: {
  path: string;
  error: string;
  lockInTemporary?: boolean;
}): string {
  const text = `cannot write ${failure.path}: ${failure.error}`;
  return failure.lockInTemporary === false ? `${text}\n${LOCK_HINT}` : text;
}

/** The failure a bootstrap script's status word stands for; a word outside the list is `unknown`. */
function ofStatus(
  status: string,
  writeFailure?: {path: string; error: string; lockInTemporary?: boolean},
): FailureDetail {
  const kind = STATUS_KINDS.get(status) ?? 'unknown';
  if (kind === 'serverDownload') {
    return {kind, reason: DOWNLOAD_FAILED};
  }
  if (kind === 'serverInstall') {
    return writeFailure === undefined
      ? {kind, reason: INSTALL_FAILED}
      : logged(kind, writeDetail(writeFailure), INSTALL_FAILED);
  }
  return {kind};
}

/** The failure of a loop that gave up on a busy host lock, with the lock file when the host named it. */
function ofExhausted(failure: {
  attempts: number;
  lockPath?: string;
}): FailureDetail {
  return logged(
    'retriesExhausted',
    failure.lockPath === undefined
      ? `the host lock was still held after ${String(failure.attempts)} attempts`
      : `the host lock ${failure.lockPath} was still held after ${String(failure.attempts)} attempts`,
  );
}

/** The failure of the host probe. */
export function ofProbe(failure: ProbeFailure): FailureDetail {
  switch (failure.kind) {
    case 'unsupportedPlatform':
      return logged('unsupportedPlatform', `reported: ${failure.reported}`);
    case 'unsupportedArch':
      return logged('unsupportedPlatform', `reported: ${failure.reported}`, {
        id: 'S146',
      });
    case 'prerequisiteMissing':
      return logged(
        'prerequisiteMissing',
        `missing: ${failure.missing.join(', ')}`,
      );
    case 'probeFailed':
      return ofStatus(failure.status);
    case 'unreadableFacts':
      return {kind: 'unknown'};
    case 'noResultBlock':
      return {kind: 'channelClosed'};
    default:
      return ofChannel(failure.failure);
  }
}

/**
 * The failure to take a lease on the connection server's helper: a cancel, or a helper that could not be reached or
 * started, which has no reason of its own for the window; the caller logs the cause.
 */
export function ofAcquire(failure: AcquireFailure): FailureDetail {
  return failure === 'cancelled' ? {kind: 'cancelled'} : {kind: 'unknown'};
}

/**
 * The failure of a shared connection's login, with the hints the login classification gave. An `ssh` that could not
 * be started is `prerequisiteMissing` when the client vanished after it was found, else unknown; the other cases of the
 * connection are a refused helper, a timeout, a cancel, and a channel that closed.
 */
export function ofConnection(
  failure: ConnectionFailure,
): FailureDetail & {hints?: readonly FailureHint[]} {
  switch (failure.kind) {
    case 'loginFailed':
      return {
        kind: failure.failure,
        ...(failure.reason === undefined ? {} : {reason: failure.reason}),
        hints: failure.hints,
      };
    case 'spawnFailed':
      return failure.cause === 'clientVanished'
        ? logged('prerequisiteMissing', failure.detail)
        : logged('unknown', failure.detail);
    case 'helperRefused':
      return logged('unknown', failure.reason);
    case 'timeout':
      return {kind: 'timeout'};
    case 'cancelled':
      return {kind: 'cancelled'};
    default:
      return {kind: 'channelClosed'};
  }
}

/** What is wrong with the user's download address template, in words of ours. */
function templateReason(problem: TemplateProblem): FailureReason {
  return problem.kind === 'unknownPlaceholder'
    ? {
        id: 'templateUnknownPlaceholder',
        values: [`\${${problem.name}}`],
      }
    : {id: 'templateNotHttp', values: []};
}

/** The failure of the install plan, which is made before the host is asked anything. */
export function ofPlan(failure: PlanFailure): FailureDetail {
  switch (failure.kind) {
    case 'noSource':
      return {kind: 'noServerSource'};
    case 'invalidOverride':
      return logged(
        'invalidServerTemplate',
        JSON.stringify(failure.problem),
        templateReason(failure.problem),
      );
    default:
      return logged('invalidSetting', failure.reason);
  }
}

/** Where a server download went, for the failure that names the host's architecture. */
export interface DownloadContext {
  /** The step of the archive's resolution; a download from the user's own template is never a missing build. */
  step: 'override' | 'productTemplate' | 'builtInTable' | undefined;
  /** The architecture token of the host. */
  architecture: string;
  address: string;
}

/**
 * The failure of the server transfer. A host-side download of the server archive that ended on a 404 from a built-in
 * source says the variant has no build for the host's architecture; the user's own template, and every other status,
 * is a failed download.
 */
export function ofTransfer(
  failure: TransferFailure,
  context?: DownloadContext,
): FailureDetail {
  switch (failure.kind) {
    case 'serverDownload':
      if (
        failure.status === 404 &&
        context?.step !== undefined &&
        context.step !== 'override'
      ) {
        return logged(
          'unsupportedPlatform',
          `no server build for ${context.architecture} at ${context.address}`,
          {id: 'S146'},
        );
      }
      return logged('serverDownload', failure.cause, DOWNLOAD_FAILED);
    case 'localDownload':
      return logged('serverDownload', failure.detail, {
        id: 'S071',
        values: [localDownloadValue(failure)],
      });
    case 'downloadTimeout':
      return logged('serverDownload', failure.reason, DOWNLOAD_FAILED);
    case 'verification':
      return logged('serverDownload', failure.mismatch, DOWNLOAD_FAILED);
    case 'unpack':
      return {kind: 'serverInstall', reason: INSTALL_FAILED};
    case 'copy':
      return ofChannel(failure.failure);
    case 'cancelled':
      return {kind: 'cancelled'};
    case 'retriesExhausted':
      return ofExhausted(failure);
    case 'scriptFailed':
      return ofStatus(failure.status, failure.writeFailure);
    case 'noResultBlock':
      return {kind: 'channelClosed'};
    default:
      return ofChannel(failure.failure);
  }
}

/**
 * The failure of the CLI's `serve`, after the window resolved: a download the CLI could not make, a server template it
 * could not use for its own release, or another fault of the install or the start. The CLI's words go to the log.
 */
export function ofCliServe(
  error: CliServeError,
  errorLine: string | undefined,
): FailureDetail {
  const logDetail = [errorLine, JSON.stringify(error)]
    .filter(part => part !== undefined)
    .join(' ');
  switch (error.kind) {
    case 'download':
      return logged('serverDownload', logDetail, DOWNLOAD_FAILED);
    case 'template':
    case 'commitMismatch':
      return logged('invalidServerTemplate', logDetail);
    default:
      return logged('serverInstall', logDetail, INSTALL_FAILED);
  }
}

/**
 * The reason a failed start gives: the server's own cause when it named one, else, when `useExecServer` is off, that it
 * failed to start. With it on and no cause, the dialog names only the host.
 */
function startReason(
  failure: Extract<StartFailure, {kind: 'serverStart'}>,
  useExecServer: boolean,
): FailureReason | undefined {
  if (failure.cause === 'cveTerminated') {
    return {id: 'S136', values: []};
  }
  return failure.cause === 'noFreePort' || !useExecServer
    ? {id: 'S135', values: []}
    : undefined;
}

/** The failure of the server start. */
export function ofStart(
  failure: StartFailure,
  settings: {useExecServer: boolean},
): FailureDetail {
  switch (failure.kind) {
    case 'invalidPortRange':
      return {kind: 'invalidSetting'};
    case 'serverStart': {
      const reason = startReason(failure, settings.useExecServer);
      return reason === undefined
        ? {kind: 'serverStart'}
        : {kind: 'serverStart', reason};
    }
    case 'unreadableServerFacts':
      return {kind: 'serverStart'};
    case 'prerequisitesMissing':
      return {kind: 'prerequisiteMissing'};
    case 'retriesExhausted':
      return ofExhausted(failure);
    case 'scriptFailed':
      return ofStatus(failure.status, failure.writeFailure);
    case 'noResultBlock':
      return {kind: 'channelClosed'};
    default:
      return ofChannel(failure.failure);
  }
}

/**
 * Whether a kind may go away by itself during a reconnection (`true`), or needs the user to do something first
 * (`false`): a refused or failed login, a cancel, a host key that changed or was rejected, a declined licence, a
 * setting, source or host that cannot do, and the waits that already ran out. Every kind has its row.
 */
export const KIND_MAY_RECOVER: Readonly<Record<FailedKind, boolean>> = {
  unreachable: true,
  timeout: true,
  authentication: false,
  hostKeyChanged: false,
  hostKeyRejected: false,
  forwardingDisabled: true,
  channelClosed: true,
  brokenPipe: true,
  unknown: true,
  unsupportedPlatform: false,
  prerequisiteMissing: false,
  noServerSource: false,
  invalidServerTemplate: false,
  licenceDeclined: false,
  serverDownload: true,
  serverInstall: true,
  serverStart: true,
  invalidSetting: false,
  preconnectFailed: false,
  lockTimeout: false,
  retriesExhausted: false,
  cancelled: false,
};

/**
 * Whether the reconnection limit stops this attempt. The limit counts reconnections: the attempt number minus one.
 * It stops only attempts after the first, and a setting that is not a number is no limit; a negative number acts as 0.
 */
export function reconnectionLimitReached(
  attempt: number,
  maximumReconnectionAttempts: unknown,
): boolean {
  return (
    attempt >= 2 &&
    typeof maximumReconnectionAttempts === 'number' &&
    attempt - 1 >= Math.max(0, maximumReconnectionAttempts)
  );
}

/** What the connect knows around a failure. */
export interface FailureContext {
  attempt: number;
  isReconnection: boolean;
  /** The value of `remote.SSH.maxReconnectionAttempts`, as the user wrote it. */
  maximumReconnectionAttempts: unknown;
  userAlreadyNotified: boolean;
  hints: readonly FailureHint[];
  diagnostics: readonly string[];
}

/**
 * The failure the window gets. It is retryable only for a reconnection, only for a kind that may go away by itself,
 * and only while the reconnection limit has not been reached.
 */
export function failedWith(
  detail: FailureDetail,
  context: FailureContext,
): Failed {
  return {
    kind: detail.kind,
    ...(detail.reason === undefined ? {} : {reason: detail.reason}),
    retryable:
      context.isReconnection &&
      KIND_MAY_RECOVER[detail.kind] &&
      !reconnectionLimitReached(
        context.attempt,
        context.maximumReconnectionAttempts,
      ),
    silent: false,
    userAlreadyNotified: context.userAlreadyNotified,
    hints: context.hints,
    diagnostics: context.diagnostics,
  };
}
