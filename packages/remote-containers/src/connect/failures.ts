/**
 * @fileoverview Every failure the container connector ends a connect with: its kind, its reason and the flags that
 * tell the resolver host what to show.
 */

import type {FailureReason, Failed} from 'lib-authority';
import type {DaemonRefusal} from '../cli/cli-lines.ts';

/** A failure of `kind`; none has a hint or a diagnostic of its own. */
function failure(
  kind: string,
  flags: {retryable?: boolean; silent?: boolean},
  reason?: FailureReason,
): Failed {
  return {
    kind,
    ...(reason === undefined ? {} : {reason}),
    retryable: flags.retryable ?? false,
    silent: flags.silent ?? false,
    userAlreadyNotified: false,
    hints: [],
    diagnostics: [],
  };
}

/** The generic reason: the dialog shows the string S034. */
const GENERIC: FailureReason = {id: 'S034'};

/** The authority is not a payload the connector reads, or is the legacy form that waits for configuration discovery. */
export function malformedAuthority(): Failed {
  return failure('malformedAuthority', {});
}

/** The target has an outer hop: the engine would be a remote one. */
export function remoteEngine(): Failed {
  return failure('remoteEngine', {}, GENERIC);
}

/** The second check of the engine failed; `stringId` is the text it gives. */
export function engineCheckFailed(stringId: 'S339' | 'S104' | 'S144'): Failed {
  return failure('engineCheckFailed', {}, {id: stringId});
}

/** The container found cannot be used. */
export function containerUnusable(): Failed {
  return failure('containerUnusable', {}, GENERIC);
}

/** The string of each refusal the Docker daemon words: a mount it rejects, a port that is already taken. */
const REFUSAL_REASONS: Record<DaemonRefusal, FailureReason> = {
  invalidMount: {id: 'S018'},
  portAllocated: {id: 'S019'},
};

/** The container could not be found, started or created; `refusal` is why the daemon refused, when it said. */
export function containerSetupFailed(refusal?: DaemonRefusal): Failed {
  return failure(
    'containerSetupFailed',
    {},
    refusal === undefined ? GENERIC : REFUSAL_REASONS[refusal],
  );
}

/** No place is known to download the server from for this editor. */
export function noServerSource(applicationName: string): Failed {
  return failure(
    'noServerSource',
    {},
    {
      id: 'noServerSource',
      values: ['remote-oss.remote-containers', applicationName],
    },
  );
}

/** The container's machine is not one the server runs on; `stringId` tells the kind. */
export function unsupportedPlatform(
  stringId: 'S031' | 'S359',
  machineName: string,
): Failed {
  return failure(
    'unsupportedPlatform',
    {},
    {id: stringId, values: [machineName]},
  );
}

/** The container lacks something the server needs; `text` is the check's own output. */
export function requirementsNotMet(text: string): Failed {
  return failure('requirementsNotMet', {}, {text});
}

/** The server could not be installed or started. */
export function serverFailed(): Failed {
  return failure('serverFailed', {}, GENERIC);
}

/** The host listener or the relay into the container could not be set up. */
export function relayFailed(): Failed {
  return failure('relayFailed', {}, GENERIC);
}

/** The folder is not trusted: the window opens it as a local folder, and the editor is told nothing. */
export function trustDeclined(): Failed {
  return failure('trustDeclined', {silent: true});
}

/** The connect was cancelled; the editor is told nothing. */
export function cancelled(): Failed {
  return failure('cancelled', {silent: true});
}

/** The container is stopped, missing or restarted; the editor is told nothing. */
export function containerGone(): Failed {
  return failure('containerGone', {silent: true});
}

/** The connection is lost but may come back; the editor retries by itself. */
export function transportLost(): Failed {
  return failure('transportLost', {retryable: true});
}
