/**
 * @fileoverview The process port of the `ssh` client: what a session needs from a started process, so that the
 * decisions around it run without one.
 */

/** A started client process. */
export interface ProcessHandle {
  /** Calls `listener` with each piece of standard output, in order. */
  onOutput(listener: (chunk: string) => void): void;
  /** Calls `listener` with each piece of standard error, in order. */
  onError(listener: (chunk: string) => void): void;
  /** Calls `listener` once, with the exit status, or undefined when a signal ended the process. */
  onExit(listener: (status: number | undefined) => void): void;
  /** Writes to standard input, bytes unchanged; resolves when the data has been handed on, so a caller can pace itself. */
  write(data: string | Uint8Array): Promise<void>;
  /** Closes standard input. */
  endInput(): void;
  /** Ends the process. */
  kill(): void;
}

/** What to start: the program, its arguments, and the complete environment. */
export interface ProcessSpecification {
  program: string;
  programArguments: readonly string[];
  environment: Readonly<Record<string, string>>;
}

/** Why a process could not be started: the system's error code, when it gave one, and its message. */
export interface StartError {
  code?: string;
  message: string;
}

/** Starts a process; rejects with an error that has a StartError's code and message when it cannot start. */
export type ProcessSpawner = (
  specification: ProcessSpecification,
) => Promise<ProcessHandle>;
