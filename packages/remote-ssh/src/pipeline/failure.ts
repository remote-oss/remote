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
  TransferFailure,
} from 'lib-server';
import type {AcquireFailure} from 'lib-helper';
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
}

function detailOf(kind: FailedKind, text?: string): FailureDetail {
  return text === undefined || text === '' ? {kind} : {kind, reason: {text}};
}

/** The failure of a host channel: a closed or timed out connection, a cancel, or a copy that did not work. */
export function ofChannel(failure: ChannelFailure): FailureDetail {
  switch (failure.kind) {
    case 'channelClosed':
      return detailOf('channelClosed', failure.detail);
    case 'timeout':
      return detailOf('timeout', failure.detail);
    case 'cancelled':
      return detailOf('cancelled');
    case 'copyToolMissing':
      return detailOf('prerequisiteMissing', failure.detail);
    case 'copyFailed':
      return detailOf('serverInstall', failure.detail);
    default:
      return detailOf('unknown', failure.detail);
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

/** The failure a bootstrap script's status word stands for; a word outside the list is `unknown`. */
function ofStatus(status: string): FailureDetail {
  return {kind: STATUS_KINDS.get(status) ?? 'unknown'};
}

/** The failure of the host probe. */
export function ofProbe(failure: ProbeFailure): FailureDetail {
  switch (failure.kind) {
    case 'unsupportedPlatform':
    case 'unsupportedArch':
      return detailOf('unsupportedPlatform', failure.reported);
    case 'prerequisiteMissing':
      return detailOf('prerequisiteMissing', failure.missing.join(', '));
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
        ? detailOf('prerequisiteMissing', failure.detail)
        : detailOf('unknown', failure.detail);
    case 'helperRefused':
      return detailOf('unknown', failure.reason);
    case 'timeout':
      return {kind: 'timeout'};
    case 'cancelled':
      return {kind: 'cancelled'};
    default:
      return {kind: 'channelClosed'};
  }
}

/** The failure of the install plan, which is made before the host is asked anything. */
export function ofPlan(failure: PlanFailure): FailureDetail {
  switch (failure.kind) {
    case 'noSource':
      return {kind: 'noServerSource'};
    case 'invalidOverride':
      return detailOf('invalidServerTemplate', failure.problem);
    default:
      return detailOf('invalidSetting', failure.reason);
  }
}

/** The failure of the server transfer. */
export function ofTransfer(failure: TransferFailure): FailureDetail {
  switch (failure.kind) {
    case 'serverDownload':
      return detailOf('serverDownload', failure.cause);
    case 'localDownload':
      return detailOf('serverDownload', failure.detail);
    case 'downloadTimeout':
      return detailOf('serverDownload', failure.reason);
    case 'verification':
      return detailOf('serverDownload', failure.mismatch);
    case 'unpack':
      return {kind: 'serverInstall'};
    case 'copy':
      return ofChannel(failure.failure);
    case 'cancelled':
      return {kind: 'cancelled'};
    case 'retriesExhausted':
      return {kind: 'retriesExhausted'};
    case 'scriptFailed':
      return ofStatus(failure.status);
    case 'noResultBlock':
      return {kind: 'channelClosed'};
    default:
      return ofChannel(failure.failure);
  }
}

/** The failure of the server start. */
export function ofStart(failure: StartFailure): FailureDetail {
  switch (failure.kind) {
    case 'invalidPortRange':
      return {kind: 'invalidSetting'};
    case 'serverStart':
    case 'unreadableServerFacts':
      return {kind: 'serverStart'};
    case 'prerequisitesMissing':
      return {kind: 'prerequisiteMissing'};
    case 'retriesExhausted':
      return {kind: 'retriesExhausted'};
    case 'scriptFailed':
      return ofStatus(failure.status);
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
