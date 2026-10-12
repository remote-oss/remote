/**
 * @fileoverview The login terminal: a terminal of the editor that runs one `ssh` invocation, with its output as plain
 * text, the input sent to it, and the way it ended. Types only; the editor's adapter and a recording fake implement it.
 */

import type {Invocation} from '../arguments/invocation.ts';

/** The names of the login terminals. */
export type LoginTerminalName =
  'install' | 'SSH Tunnel' | 'Uninstall VS Code Server';

/** How a terminal ended: its exit code when the process gave one, and why it ended, as the editor reports it. */
export interface TerminalEnd {
  /** The exit code; undefined when the process gave none (closed by the user, or never started). */
  code: number | undefined;
  reason: 'process' | 'user' | 'extension' | 'shutdown' | 'unknown';
  /** Whether any output arrived before the end. */
  hadOutput: boolean;
}

/** One login terminal running one invocation. */
export interface LoginTerminalSession {
  /** Calls `listener` with each piece of output as plain text: no escape sequences, `\r` and `\n` kept. */
  onOutput(listener: (text: string) => void): void;
  /** Calls `listener` once when the terminal ends; at once if it has already ended. */
  onEnd(listener: (end: TerminalEnd) => void): void;
  /** Writes `text` to the terminal's input exactly as given; the caller adds any line end. */
  send(text: string): void;
  /** Shows the terminal and gives it focus. */
  reveal(): void;
  /** Closes the terminal, which ends its process. Safe to call more than once and after the end. */
  dispose(): void;
}

/** What makes login terminals. */
export interface LoginTerminals {
  /** Starts the invocation in a new terminal; hidden unless `reveal` is true. */
  open(
    invocation: Invocation,
    name: LoginTerminalName,
    reveal: boolean,
  ): LoginTerminalSession;
}
