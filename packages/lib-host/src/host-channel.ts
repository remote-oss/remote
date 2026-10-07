/**
 * @fileoverview The host channel: how the server lifecycle runs a script on a remote side and puts a file there,
 * whatever carries it (an SSH connection, a container's exec, a WSL distribution).
 */

/** The interpreter a script is written for. */
export type Interpreter = 'posixShell' | 'powershell';

/** What a channel knows of the remote side's operating system before any probe has run. */
export type PlatformHint = 'linux' | 'macOS' | 'windows' | 'unknown';

/**
 * Why a channel could not complete an operation. The set is closed: an implementation maps every error of its
 * transport to one of these.
 */
export type ChannelFailureKind =
  | 'channelClosed'
  | 'spawnFailed'
  | 'copyToolMissing'
  | 'copyFailed'
  | 'timeout'
  | 'cancelled';

/** A failed operation: its kind, and the transport's original message. */
export interface ChannelFailure {
  kind: ChannelFailureKind;
  detail: string;
}

/**
 * What a script reads on its standard input, which is closed after it: a text, or the bytes of a local file
 * streamed unchanged.
 */
export type ScriptInput =
  {kind: 'text'; text: string} | {kind: 'file'; localFile: string};

/** A script to run on the remote side. */
export interface ScriptRequest {
  script: string;
  interpreter: Interpreter;
  /** Variables added to the remote environment for this script only. */
  environment: Readonly<Record<string, string>>;
  /** A local file that does not exist fails the run with `spawnFailed`, naming the file, before anything runs. */
  input: ScriptInput;
  cancellation: AbortSignal;
}

/** A local file to place on the remote side. */
export interface CopyRequest {
  localFile: string;
  remotePath: string;
  cancellation: AbortSignal;
}

/** A script that ran to its end. Its status is a result for the caller to interpret, never a failure. */
interface ScriptExited {
  kind: 'exited';
  status: number;
}

/** A file that reached the remote side. */
interface FileCopied {
  kind: 'copied';
}

/** An operation the channel could not complete. */
export interface OperationFailed {
  kind: 'failed';
  failure: ChannelFailure;
}

/** How a `runScript` call ended. */
export type ScriptOutcome = ScriptExited | OperationFailed;

/** How a `copyToHost` call ended. */
export type CopyOutcome = FileCopied | OperationFailed;

/**
 * The narrow interface between the server lifecycle and a transport. A channel never interprets a script's
 * output and never retries an operation by itself.
 */
export interface HostChannel {
  /**
   * Runs a script. `onLine` receives each output line in the order the script wrote it, all of them before the
   * outcome settles.
   */
  runScript(
    request: ScriptRequest,
    onLine: (line: string) => void,
  ): Promise<ScriptOutcome>;

  /** Places a local file at a path on the remote side. */
  copyToHost(request: CopyRequest): Promise<CopyOutcome>;

  /**
   * The key that names the host in locks and records: the host as the user wrote it, a container id, or a
   * distribution name.
   */
  identity(): string;

  /** The remote side's operating system as far as the transport knows it without a probe. */
  platformHint(): PlatformHint;

  /**
   * A path at which the host reads a client file directly, without a copy, or undefined when it cannot. Callers
   * ask through `hostPathOf`, which also covers a channel without this operation.
   */
  clientPathOnHost?(localFile: string): Promise<string | undefined>;
}

/** A failed outcome of `kind` whose detail is the message of the value an implementation caught. */
export function failFrom(
  kind: ChannelFailureKind,
  caught: unknown,
): OperationFailed {
  return {
    kind: 'failed',
    failure: {
      kind,
      detail: caught instanceof Error ? caught.message : String(caught),
    },
  };
}

/**
 * The path at which the channel's host reads a client file directly, or undefined when it cannot: the channel has
 * no such operation, finds no path, or fails to answer.
 */
export async function hostPathOf(
  channel: HostChannel,
  localFile: string,
): Promise<string | undefined> {
  try {
    return await channel.clientPathOnHost?.(localFile);
  } catch {
    // A channel that cannot answer has no direct path; the caller copies the file instead.
    return undefined;
  }
}
