/**
 * @fileoverview Maps the error lines of one `ssh` run to a failure kind, the reason shown to the user and the
 * hints kept for the session. Prompts and their answers never pass through here.
 */

import type {DiagnosticStringId, FailureKind} from './rules.ts';
import {
  CONNECTION_CLOSED_TEXT,
  FAILING_CONNECTIONS_TOPIC,
  DEBUG1_PREFIX,
  FAILURE_PATTERNS,
  FORWARDING_SETTING,
  NETWORK_RULES,
  PERMISSION_DENIED_START,
  SENTENCE_ENDINGS,
  SERVER_HOST_KEY_TEXT,
} from './rules.ts';
import {setupMarkerOf} from './setup-report.ts';

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

/** A line with one trailing carriage return removed, the form the rules read. */
function withoutReturn(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

/**
 * Classifies the error lines of one run, in the order `ssh` wrote them. Only the lines before `Authenticated to` are
 * ssh's own diagnostics: a login's startup files run after it, and what they print is remote text. So every rule reads
 * that window, in its anchored form. The four rules for failures ssh reports after authentication (forwarding
 * prohibited or disabled, a broken pipe, a closed connection) also read the later lines, only when ssh itself exited
 * with 255. A run in which no authentication was seen has no window to cut: all its lines count.
 */
export function classify(
  errorLines: readonly string[],
  exitStatus: number | undefined,
  purpose: ClassifyPurpose,
  mode: ConnectionMode,
): Classification {
  const lines = errorLines.map(withoutReturn);
  const authenticated = lines.findIndex(
    line => setupMarkerOf(line) === 'authenticated',
  );
  const window = authenticated < 0 ? lines : lines.slice(0, authenticated);
  const after = authenticated < 0 ? [] : lines.slice(authenticated);
  function contains(form: RegExp): boolean {
    return window.some(line => form.test(line));
  }
  function containsAfterSession(form: RegExp): boolean {
    return (
      contains(form) ||
      (exitStatus === 255 && after.some(line => form.test(line)))
    );
  }
  if (
    mode === 'shared' &&
    contains(FAILURE_PATTERNS.hostKeyChanged) &&
    !containsAfterSession(FAILURE_PATTERNS.forwardingDisabledByClient)
  ) {
    return plain('hostKeyChanged', {id: 'S111'});
  }
  if (contains(FAILURE_PATTERNS.hostKeyRejected)) {
    return plain('hostKeyRejected');
  }
  if (contains(FAILURE_PATTERNS.configFileUnreadable)) {
    return plain('unknown', {text: 'Permission denied'});
  }
  const denied = lastPermissionDenied(window);
  if (denied !== undefined) {
    return withHint('authentication', 'PermissionDenied', {text: denied});
  }
  if (purpose === 'connection' && contains(FAILURE_PATTERNS.invalidHostName)) {
    return withHint('unreachable', 'InvalidHostName', {id: 'S079'});
  }
  const network = NETWORK_RULES.find(rule => contains(rule.pattern));
  if (network !== undefined) {
    return withHint(network.kind, 'OfflineError', {id: network.reason});
  }
  if (
    mode === 'terminal' &&
    containsAfterSession(FAILURE_PATTERNS.forwardingDisabledByClient)
  ) {
    return withHint('forwardingDisabled', 'MitmPortForwardingDisabled', {
      id: 'S107',
    });
  }
  if (containsAfterSession(FAILURE_PATTERNS.forwardingProhibited)) {
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
  if (containsAfterSession(FAILURE_PATTERNS.brokenPipe)) {
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
  if (containsAfterSession(FAILURE_PATTERNS.connectionClosed)) {
    return plain('channelClosed', {text: CONNECTION_CLOSED_TEXT});
  }
  return plain('unknown');
}

/** Whether a line is a debug1 line of the client's `-v`, with or without the `scp: ` that scp puts before its ssh's lines. */
export function isDebugLine(line: string): boolean {
  const body = line.startsWith('scp: ') ? line.slice(5) : line;
  return body.startsWith(DEBUG1_PREFIX);
}

/**
 * The lines of one run that go to the extension's log: every line except the client's `debug1` lines, of which only
 * the server host key line is kept.
 */
export function logLinesOf(errorLines: readonly string[]): string[] {
  return errorLines.filter(
    line => !isDebugLine(line) || line.includes(SERVER_HOST_KEY_TEXT),
  );
}

/** A classification whose reason is also the details of its one hint, named by its type. */
function withHint(
  kind: FailureKind,
  status: string,
  reason: FailureReason,
): Classification {
  return {
    kind,
    reason,
    hints: [
      {
        status,
        message: `Error: ${status}`,
        details: reason,
        mitigations: [],
        resources: [],
      },
    ],
    logLines: [],
  };
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
  const line = errorLines.findLast(errorLine =>
    FAILURE_PATTERNS.permissionDenied.test(errorLine),
  );
  return line?.slice(line.indexOf(PERMISSION_DENIED_START)).trimEnd();
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
