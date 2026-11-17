/**
 * @fileoverview The forms `ssh` writes on its error output that the classifier recognises, and what each one means.
 * A form is a regular expression anchored at the start of a line: a text in the middle of a line, such as remote text a
 * startup file prints, is not ssh's message. The two timeout forms are the exception in the shared server's stream,
 * where the exact, case-sensitive timeout text counts wherever it stands in a line; in a terminal's stream only the
 * anchored forms count, because that stream also carries what a question or a proxy command wrote.
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
  | 'S003'
  | 'S042'
  | 'S043'
  | 'S049'
  | 'S052'
  | 'S054'
  | 'S055'
  | 'S080'
  | 'S081'
  | 'S083'
  | 'S109'
  | 'S113'
  | 'S151'
  | 'S152'
  | 'S154'
  | 'S159'
  | 'S050'
  | 'S033'
  | 'S038'
  | 'S048'
  | 'S053'
  | 'S056'
  | 'S058'
  | 'S061'
  | 'S070'
  | 'S112'
  | 'S139'
  | 'S143'
  | 'S079'
  | 'S094'
  | 'S097'
  | 'S107'
  | 'S111'
  | 'S116'
  | 'S137'
  | 'S140'
  | 'S142'
  | 'S150'
  | 'S155'
  | 'S059'
  | 'S019';

/** How the connection runs: through the shared local connection server, or in a terminal of its own. */
export type ConnectionMode = 'shared' | 'terminal';

/** A network form and the reason it gives, in priority order: when several match, the first listed wins. */
export interface NetworkRule {
  pattern: RegExp;
  kind: 'unreachable' | 'timeout';
  reason: DiagnosticStringId;
}

/** The start of a line `ssh` writes about its own run: `scp` puts its name before the lines of the `ssh` it starts. */
const OWN_PREFIX = '(?:scp: )?ssh: ';

/** The line `ssh` prints when it cannot connect to the host, ending in `text`. */
function connectError(text: string): RegExp {
  return new RegExp(`^${OWN_PREFIX}connect to host \\S+ port \\d+: ${text}$`);
}

/**
 * The network forms, highest priority first, whatever the order of the lines. The two timeout forms match the
 * contained text only in the shared server's stream, where ssh appends them to more than one diagnostic; in a
 * terminal's stream a question or a proxy command can write the same text in its own line, so only the anchored
 * `connect to host` form gives the reason there.
 */
export function networkRules(mode: ConnectionMode): readonly NetworkRule[] {
  return [
    {
      pattern: connectError('Network is unreachable'),
      kind: 'unreachable',
      reason: 'S094',
    },
    {
      pattern: new RegExp(`^${OWN_PREFIX}Could not resolve hostname \\S+: `),
      kind: 'unreachable',
      reason: 'S032',
    },
    {
      pattern:
        /^(?:scp: )?(?:ssh: connect to host \S+ port \d+: )?The process tried to write to a nonexistent pipe/,
      kind: 'unreachable',
      reason: 'S142',
    },
    {
      pattern:
        mode === 'terminal'
          ? connectError('Connection timed out')
          : /Connection timed out/,
      kind: 'timeout',
      reason: 'S137',
    },
    {
      pattern:
        mode === 'terminal'
          ? connectError('Operation timed out')
          : /Operation timed out/,
      kind: 'timeout',
      reason: 'S140',
    },
    {
      pattern: connectError('No route to host'),
      kind: 'unreachable',
      reason: 'S097',
    },
    {
      pattern: connectError("Can't assign requested address"),
      kind: 'unreachable',
      reason: 'S014',
    },
  ];
}

/**
 * The other forms the classifier looks for, each anchored at the start of a line. A line is read after one trailing
 * carriage return is removed.
 */
export const FAILURE_PATTERNS = {
  hostKeyChanged: /^@\s+WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!\s+@$/,
  hostKeyRejected: /^Host key verification failed\.$/,
  permissionDenied: /^(?:\S+@\S+: )?Permission denied \([^)]*\)\.?\s*$/,
  invalidHostName: /^(?:scp: )?(?:ssh: )?hostname contains invalid characters$/,
  forwardingProhibited:
    /^channel \d+: open failed: administratively prohibited: /,
  forwardingDisabledByClient:
    /^(?:Warning: )?Port forwarding is disabled to avoid man-in-the-middle attacks\.$/,
  brokenPipe:
    /^(?:\S+: )?(?:Connection to \S+ port \d+: )?send disconnect: Broken pipe$/,
  connectionClosed: /^Connection closed\.$/,
  configFileUnreadable: /^Can't open user config file .*: Permission denied$/,
} as const;

/** The text a permission-denied reason keeps from. */
export const PERMISSION_DENIED_START = 'Permission denied (';

/** The reason text of a closed connection. */
export const CONNECTION_CLOSED_TEXT = 'Connection closed.';

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
