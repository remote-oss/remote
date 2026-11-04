/**
 * @fileoverview What the runner needs of the machine: starting `wsl.exe`, and reading and finding local files. A test
 * replaces both with a fake, so every decision around a process runs without one.
 */

/** A started `wsl.exe`. Its output is bytes, since the management verbs print UTF-16 and the distro's programs UTF-8. */
export interface WslProcess {
  /** Calls `listener` with each piece of standard output, in order. */
  onOutput(listener: (chunk: Uint8Array) => void): void;
  /** Calls `listener` with each piece of standard error, in order. */
  onError(listener: (chunk: Uint8Array) => void): void;
  /** Calls `listener` once, with the exit status, or undefined when a signal ended the process. */
  onExit(listener: (status: number | undefined) => void): void;
  /** Writes to standard input; resolves when the data has been handed on, so a caller can pace itself. */
  write(data: Uint8Array): Promise<void>;
  /** Closes standard input. */
  endInput(): void;
  /** Ends the process. */
  kill(): void;
}

/** What to start: the program, its arguments, and the complete environment. */
export interface WslProcessSpecification {
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
export type WslProcessSpawner = (
  specification: WslProcessSpecification,
) => Promise<WslProcess>;

/** The local files the runner reads or looks for. */
export interface WslFiles {
  /** Whether `file` exists. */
  exists(file: string): Promise<boolean>;
  /** The bytes of `file`, in order; rejects when it cannot be read. */
  read(file: string): AsyncIterable<Uint8Array>;
}

/** What the runner knows of the Windows session it runs in. */
export interface WslSession {
  /** `%SystemRoot%`, when the session has it. */
  systemRoot: string | undefined;
  /** The environment `wsl.exe` inherits, before the added variables. */
  environment: Readonly<Record<string, string>>;
}
