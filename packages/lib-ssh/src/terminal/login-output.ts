/**
 * @fileoverview What a login terminal's output goes to, the same for every login that runs in one: the wait for the
 * connection stops at the first output, and each piece is read for questions and cut into lines.
 */

import type {LoginTerminalSession} from './login-terminal.ts';

/** Where the output of a login goes. */
export interface LoginOutputSinks {
  /** Whether the login has ended; output after that reaches nothing. */
  isFinished(): boolean;
  /** Called once, for the first piece of output. */
  onFirstOutput(): void;
  /** Reads the output for the questions it asks. */
  reader: {push(text: string): void};
  /** Cuts the output into lines. */
  lines: {push(text: string): void};
}

/** Sends the output of `terminal` to the sinks of a login. */
export function followLoginOutput(
  terminal: Pick<LoginTerminalSession, 'onOutput'>,
  sinks: LoginOutputSinks,
): void {
  let heardOutput = false;
  terminal.onOutput(text => {
    if (sinks.isFinished()) {
      return;
    }
    if (!heardOutput) {
      heardOutput = true;
      sinks.onFirstOutput();
    }
    sinks.reader.push(text);
    sinks.lines.push(text);
  });
}
