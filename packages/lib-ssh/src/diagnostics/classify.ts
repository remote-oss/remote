/**
 * @fileoverview Maps the error lines of one `ssh` run to a failure kind, the reason shown to the user and the
 * hints kept for the session. Prompts and their answers never pass through here.
 */

import type {DiagnosticStringId, FailureKind} from './rules.ts';
import {
  FAILING_CONNECTIONS_TOPIC,
  CHANNEL_CLOSED_REASON,
  DEBUG1_PREFIX,
  FAILURE_TEXTS,
  FORWARDING_SETTING,
  NETWORK_RULES,
  SENTENCE_ENDINGS,
  SERVER_HOST_KEY_TEXT,
} from './rules.ts';

/** What the `ssh` run was for. */
export type ClassifyPurpose = 'connection' | 'tunnel' | 'oneShot' | 'copy';

/** How the connection runs: through the shared local connection server, or in a terminal of its own. */
export type ConnectionMode = 'shared' | 'terminal';

/** A reason: a string of the extension's table, or a line of `ssh` shown as it is. */
export type FailureReason = {id: DiagnosticStringId} | {text: string};

/** A string of the table with the values of its placeholders. */
export interface FilledString {
  id: DiagnosticStringId;
  values: string[];
}

/** A hint kept for the session and shown by the troubleshooting view. */
export interface FailureHint {
  /** The hint's type name. */
  status: string;
  /** The message: a fixed text naming the type, or a string of the table. */
  message: string | FilledString;
  /** The reason the hint carries; absent when it has none. */
  details?: FailureReason;
  mitigations: FilledString[];
  /** Documentation topics. */
  resources: string[];
}

/** The classification of one failed run. */
export interface Classification {
  kind: FailureKind;
  /** Absent when the failure has no reason of its own; the dialog then names only the host. */
  reason?: FailureReason;
  hints: FailureHint[];
  /** Strings written once to the extension's log. */
  logLines: DiagnosticStringId[];
}

/**
 * Classifies the error lines of one run, in the order `ssh` wrote them. The exit status is part of the contract and
 * does not change the outcome: every rule is decided by the text.
 */
export function classify(
  errorLines: readonly string[],
  exitStatus: number | undefined,
  purpose: ClassifyPurpose,
  mode: ConnectionMode,
): Classification {
  function contains(text: string): boolean {
    return errorLines.some(line => line.includes(text));
  }
  if (mode === 'shared' && contains(FAILURE_TEXTS.hostKeyChanged)) {
    return plain('hostKeyChanged', {id: 'S111'});
  }
  if (contains(FAILURE_TEXTS.hostKeyRejected)) {
    return plain('hostKeyRejected');
  }
  const denied = lastPermissionDenied(errorLines);
  if (denied !== undefined) {
    return {
      kind: 'authentication',
      reason: {text: denied},
      hints: [
        {
          status: 'PermissionDenied',
          message: 'Error: PermissionDenied',
          details: {text: denied},
          mitigations: [],
          resources: [],
        },
      ],
      logLines: [],
    };
  }
  if (purpose === 'connection' && contains(FAILURE_TEXTS.invalidHostName)) {
    return plain('unreachable', {id: 'S079'});
  }
  const network = NETWORK_RULES.find(rule => contains(rule.text));
  if (network !== undefined) {
    return {
      kind: network.kind,
      reason: {id: network.reason},
      hints: [
        {
          status: 'OfflineError',
          message: 'Error: OfflineError',
          details: {id: network.reason},
          mitigations: [],
          resources: [],
        },
      ],
      logLines: [],
    };
  }
  if (
    mode === 'terminal' &&
    contains(FAILURE_TEXTS.forwardingDisabledByClient)
  ) {
    return {
      kind: 'forwardingDisabled',
      reason: {id: 'S107'},
      hints: [
        {
          status: 'MitmPortForwardingDisabled',
          message: 'Error: MitmPortForwardingDisabled',
          details: {id: 'S107'},
          mitigations: [],
          resources: [],
        },
      ],
      logLines: [],
    };
  }
  if (contains(FAILURE_TEXTS.forwardingProhibited)) {
    return {
      kind: 'forwardingDisabled',
      hints: [
        {
          status: 'AllowTcpForwardingDisabled',
          message: {id: 'S150', values: []},
          mitigations: [
            {
              id: 'S005',
              values: [FORWARDING_SETTING.setting, FORWARDING_SETTING.file],
            },
            {id: 'S116', values: []},
          ],
          resources: [FAILING_CONNECTIONS_TOPIC],
        },
      ],
      logLines: ['S046'],
    };
  }
  if (contains(FAILURE_TEXTS.brokenPipe)) {
    return {
      kind: 'brokenPipe',
      hints: [
        {
          status: 'SendDisconnectBrokenPipe',
          message: 'Error: SendDisconnectBrokenPipe',
          mitigations: [],
          resources: [],
        },
      ],
      logLines: [],
    };
  }
  if (contains(FAILURE_TEXTS.channelConnectFailed)) {
    return plain('channelClosed', {text: CHANNEL_CLOSED_REASON});
  }
  return plain('unknown');
}

/**
 * The lines of one run that go to the extension's log: every line except ssh's `debug1` lines, of which only the
 * server host key line is kept.
 */
export function logLinesOf(errorLines: readonly string[]): string[] {
  return errorLines.filter(
    line =>
      !line.startsWith(DEBUG1_PREFIX) || line.includes(SERVER_HOST_KEY_TEXT),
  );
}

/** A classification without hints or log lines. */
function plain(kind: FailureKind, reason?: FailureReason): Classification {
  return reason === undefined
    ? {kind, hints: [], logLines: []}
    : {kind, reason, hints: [], logLines: []};
}

/** The last "Permission denied (...)" line with its `user@host: ` prefix removed. */
function lastPermissionDenied(
  errorLines: readonly string[],
): string | undefined {
  for (let index = errorLines.length - 1; index >= 0; index--) {
    const line = errorLines[index] ?? '';
    const start = line.indexOf(FAILURE_TEXTS.permissionDenied);
    if (start >= 0) {
      return line.slice(start).trimEnd();
    }
  }
  return undefined;
}

/**
 * A reason as the failure dialog shows it: with one closing full stop, which is not added after text that already
 * ends a sentence.
 */
export function endWithFullStop(text: string): string {
  if (SENTENCE_ENDINGS.test(text)) {
    return text;
  }
  return `${text}.`;
}
