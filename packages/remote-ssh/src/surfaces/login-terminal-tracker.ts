/**
 * @fileoverview The login terminals of a window, tracked so that "details" can reveal the one that is asking: the
 * latest terminal opened and not yet ended.
 */

import type {
  Invocation,
  LoginTerminalName,
  LoginTerminals,
  LoginTerminalSession,
} from 'lib-ssh';

/** Login terminals that remember the latest one still running. */
export class LoginTerminalTracker implements LoginTerminals {
  private latest: LoginTerminalSession | undefined;

  private readonly terminals: LoginTerminals;

  /** Tracks the terminals `terminals` opens. */
  constructor(terminals: LoginTerminals) {
    this.terminals = terminals;
  }

  /** Opens the terminal through the wrapped terminals and remembers it as the latest. */
  open(
    invocation: Invocation,
    name: LoginTerminalName,
    reveal: boolean,
  ): LoginTerminalSession {
    const session = this.terminals.open(invocation, name, reveal);
    this.latest = session;
    session.onEnd(() => {
      if (this.latest === session) {
        this.latest = undefined;
      }
    });
    return session;
  }

  /**
   * The "details" of a connect: in the terminal mode the latest running login terminal, shown and focused, and
   * otherwise (or with none running) what `showLog` shows.
   */
  revealDetails(terminalMode: boolean, showLog: () => void): void {
    if (terminalMode && this.latest !== undefined) {
      this.latest.reveal();
      return;
    }
    showLog();
  }
}
