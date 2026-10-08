/**
 * @fileoverview S3, the session spawner: starts an `ssh` or `scp` run from an invocation and hands back a session
 * with its output, error and input streams and its exit status. The editor's environment is passed on unchanged;
 * `SSH_ASKPASS_REQUIRE` is never set by this library.
 */

import type {Invocation} from '../arguments/invocation.ts';
import type {ProcessHandle, ProcessSpawner, StartError} from './ports.ts';

/** Why no session was started: the client is gone or unusable, or the start failed for another reason. */
export type SpawnFailure = 'clientVanished' | 'spawnFailed';

/** The system error codes that mean the client program is no longer there to run. */
const VANISHED_CODES = new Set(['ENOENT', 'EACCES']);

/** The variable that would make `ssh` call the askpass without a terminal; the library never sets it. */
const FORCE_ASKPASS_VARIABLE = 'SSH_ASKPASS_REQUIRE';

/** A running client process, with its exit status as a promise. */
export class SshSession {
  private readonly handle: ProcessHandle;
  private readonly exitStatus: Promise<number | undefined>;

  /** A session over a started process. */
  constructor(handle: ProcessHandle) {
    this.handle = handle;
    this.exitStatus = new Promise(resolve => {
      handle.onExit(resolve);
    });
  }

  /** Calls `listener` with each piece of the client's standard output. */
  onOutput(listener: (chunk: string) => void): void {
    this.handle.onOutput(listener);
  }

  /** Calls `listener` with each piece of the client's standard error. */
  onError(listener: (chunk: string) => void): void {
    this.handle.onError(listener);
  }

  /** Writes to the client's standard input; resolves when the data has been handed on. */
  write(data: string | Uint8Array): Promise<void> {
    return this.handle.write(data);
  }

  /** Closes the client's standard input. */
  endInput(): void {
    this.handle.endInput();
  }

  /** Ends the client process. */
  kill(): void {
    this.handle.kill();
  }

  /** The exit status once the process has ended, or undefined when a signal ended it. */
  exit(): Promise<number | undefined> {
    return this.exitStatus;
  }
}

/** A session, or why there is none, with the system's message. */
export type SpawnOutcome =
  | {kind: 'spawned'; session: SshSession}
  | {kind: 'failed'; failure: SpawnFailure; detail: string};

/**
 * The environment of a run: the editor's own, then the variables the invocation adds, then those of the askpass.
 * The askpass environment cannot force the askpass; that variable is dropped from it.
 */
export function sessionEnvironment(
  editorEnvironment: Readonly<Record<string, string | undefined>>,
  invocation: Invocation,
  askpassEnvironment: Readonly<Record<string, string>>,
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(editorEnvironment)) {
    if (value !== undefined) {
      environment[name] = value;
    }
  }
  Object.assign(environment, invocation.environment);
  for (const [name, value] of Object.entries(askpassEnvironment)) {
    if (name !== FORCE_ASKPASS_VARIABLE) {
      environment[name] = value;
    }
  }
  return environment;
}

/** Starts the invocation; a failure is a value, never a throw. */
export async function spawnSession(
  spawner: ProcessSpawner,
  invocation: Invocation,
  askpassEnvironment: Readonly<Record<string, string>>,
  editorEnvironment: Readonly<Record<string, string | undefined>>,
): Promise<SpawnOutcome> {
  try {
    const handle = await spawner({
      program: invocation.program,
      programArguments: invocation.arguments,
      environment: sessionEnvironment(
        editorEnvironment,
        invocation,
        askpassEnvironment,
      ),
    });
    return {kind: 'spawned', session: new SshSession(handle)};
  } catch (caught) {
    // A spawner rejects with a StartError.
    const error = caught as StartError;
    return {
      kind: 'failed',
      failure:
        error.code !== undefined && VANISHED_CODES.has(error.code)
          ? 'clientVanished'
          : 'spawnFailed',
      detail: error.message,
    };
  }
}
