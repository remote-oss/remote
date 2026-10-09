/**
 * @fileoverview What a connect hands back to the resolver host: a connection, or a failure. The host reads the
 * structured fields and never interprets a kind, so a kind is a string here and each extension narrows it to its own
 * closed list.
 */

/** A text of the extension's string table with the values of its placeholders. */
export interface FilledString {
  id: string;
  values: readonly string[];
}

/** The reason a failure carries: a string of the table, or a text the failing step wrote. */
export type FailureReason = {id: string} | {text: string};

/** A hint kept for the session and shown by the troubleshooting view. */
export interface FailureHint {
  /** The hint's type name. */
  status: string;
  /** The message: a fixed text naming the type, or a string of the table. */
  message: string | FilledString;
  /** The reason the hint carries; absent when it has none. */
  details?: FailureReason;
  mitigations: readonly FilledString[];
  /** Documentation topics. */
  resources: readonly string[];
}

/** A connect that did not end in a connection. */
export interface Failed {
  /** The extension's own kind of failure; the host passes it on and never reads it. */
  kind: string;
  /** Absent when the failure has no reason of its own; the window then names only the host. */
  reason?: FailureReason;
  /** Whether the editor should try again by itself: only for a lost connection that may come back. */
  retryable: boolean;
  /** Whether the host answers the editor with a plain "not available" and shows no dialog, as for a stopped container. */
  silent: boolean;
  /** Whether the user has already been told, by a dialog of the connect itself. */
  userAlreadyNotified: boolean;
  hints: readonly FailureHint[];
  /** Lines for the extension's log, without secrets. */
  diagnostics: readonly string[];
}

/**
 * A connect that ended in a connection. The pieces whose shapes belong to the editor's proposed API are type
 * parameters, so this package needs no editor types: the resolver host that registers with the editor fixes them.
 */
export interface Connected<
  Tunnel = unknown,
  Features = unknown,
  Factory = unknown,
> {
  /** Where the editor connects to reach the server: a port on this machine. */
  address: {host: string; port: number};
  /** The secret the server expects from the editor. It must not reach a log. */
  connectionToken: string;
  /** Variables added to the environment of the remote extension host. */
  extensionHostEnv: Readonly<Record<string, string | null>>;
  /** Ports forwarded for the whole window from the start. */
  environmentTunnels: readonly Tunnel[];
  /** What the window's port forwarding offers; handed to the editor unchanged. */
  tunnelFeatures?: Features;
  /** Opens a forwarded port; handed to the editor unchanged. */
  tunnelFactory?: Factory;
  /** Whether the remote side counts as trusted; the host passes it on only where the family allows it. */
  trusted: boolean;
}
