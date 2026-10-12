/**
 * @fileoverview Login terminals for tests: they record what was opened and sent, and a test drives their output and
 * their end. No bundle imports this module.
 */

import type {Invocation} from '../arguments/invocation.ts';
import type {
  LoginTerminalName,
  LoginTerminals,
  LoginTerminalSession,
  TerminalEnd,
} from '../terminal/login-terminal.ts';
import {TerminalStream} from '../terminal/terminal-stream.ts';

/** One opened terminal: what it was opened with, what was sent to it, and the test's controls. */
export interface RecordingTerminal {
  readonly invocation: Invocation;
  readonly name: LoginTerminalName;
  readonly revealedAtOpen: boolean;
  /** The texts given to `send`, in order. */
  readonly sent: string[];
  /** How often `reveal` was called after the open. */
  revealCount: number;
  disposed: boolean;
  /** Delivers `data` as the terminal's output, through the same `PlainTextFilter` the adapter uses. */
  write(data: string): void;
  /** Ends the terminal with `code` and `reason` (hadOutput is computed). */
  end(code: number | undefined, reason?: TerminalEnd['reason']): void;
}

/** Login terminals that record what was opened and sent, and that a test drives. */
export class RecordingTerminals implements LoginTerminals {
  /** Every terminal opened, in order. */
  readonly opened: RecordingTerminal[] = [];

  /** Records the opening and gives the session; the test drives the terminal through `opened`. */
  open(
    invocation: Invocation,
    name: LoginTerminalName,
    reveal: boolean,
  ): LoginTerminalSession {
    const stream = new TerminalStream();
    const terminal: RecordingTerminal = {
      invocation,
      name,
      revealedAtOpen: reveal,
      sent: [],
      revealCount: 0,
      disposed: false,
      write: data => {
        stream.write(data);
      },
      end: (code, reason = 'process') => {
        stream.end(code, reason);
      },
    };
    this.opened.push(terminal);
    return {
      onOutput: listener => {
        stream.onOutput(listener);
      },
      onEnd: listener => {
        stream.onEnd(listener);
      },
      send: text => {
        terminal.sent.push(text);
      },
      reveal: () => {
        terminal.revealCount++;
      },
      dispose: () => {
        terminal.disposed = true;
        terminal.end(undefined, 'extension');
      },
    };
  }
}
