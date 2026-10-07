/**
 * @fileoverview The texts `ssh` writes on its error output that the classifier recognises, and what each one
 * means. Recognition is a case-sensitive substring test against each line.
 */

/** A failure kind, closed: every failure maps to exactly one. */
export type FailureKind =
  | 'unreachable'
  | 'timeout'
  | 'authentication'
  | 'hostKeyChanged'
  | 'hostKeyRejected'
  | 'forwardingDisabled'
  | 'channelClosed'
  | 'brokenPipe'
  | 'unknown';

/** The string ids of the reasons and hint texts the classifier returns. */
export type DiagnosticStringId =
  | 'S005'
  | 'S014'
  | 'S032'
  | 'S046'
  | 'S079'
  | 'S094'
  | 'S097'
  | 'S107'
  | 'S111'
  | 'S116'
  | 'S137'
  | 'S140'
  | 'S142'
  | 'S150';

/** A network text and the reason it gives, in priority order: when several match, the first listed wins. */
export interface NetworkRule {
  text: string;
  kind: 'unreachable' | 'timeout';
  reason: DiagnosticStringId;
}

/** The network texts, highest priority first, whatever the order of the lines. */
export const NETWORK_RULES: readonly NetworkRule[] = [
  {text: 'Network is unreachable', kind: 'unreachable', reason: 'S094'},
  {text: 'Could not resolve hostname', kind: 'unreachable', reason: 'S032'},
  {
    text: 'The process tried to write to a nonexistent pipe',
    kind: 'unreachable',
    reason: 'S142',
  },
  {text: 'Connection timed out', kind: 'timeout', reason: 'S137'},
  {text: 'Operation timed out', kind: 'timeout', reason: 'S140'},
  {text: 'No route to host', kind: 'unreachable', reason: 'S097'},
  {text: "Can't assign requested address", kind: 'unreachable', reason: 'S014'},
];

/** The other texts the classifier looks for. */
export const FAILURE_TEXTS = {
  hostKeyChanged: 'REMOTE HOST IDENTIFICATION HAS CHANGED',
  hostKeyRejected: 'Host key verification failed.',
  permissionDenied: 'Permission denied (',
  invalidHostName: 'hostname contains invalid characters',
  forwardingProhibited: 'administratively prohibited',
  forwardingDisabledByClient:
    'Port forwarding is disabled to avoid man-in-the-middle attacks',
  brokenPipe: 'send disconnect: Broken pipe',
  channelConnectFailed: 'connect failed',
} as const;

/** The reason shown when a forwarded channel fails to open on the host. */
export const CHANNEL_CLOSED_REASON = 'Connection closed.';

/** The prefix of ssh's first-level debug lines. */
export const DEBUG1_PREFIX = 'debug1: ';

/** The one first-level debug line kept for the log. */
export const SERVER_HOST_KEY_TEXT = 'Server host key';

/** The sshd setting and file named by the forwarding hint's first mitigation. */
export const FORWARDING_SETTING = {
  setting: 'AllowTcpForwarding yes',
  file: '/etc/ssh/sshd_config',
} as const;

/** The documentation topic the forwarding hint points to. */
export const FAILING_CONNECTIONS_TOPIC = 'hangingOrFailingConnections';

/** Characters that already end a sentence, so no full stop is added after them. */
export const SENTENCE_ENDINGS = /[.!?。．！？]$/u;
