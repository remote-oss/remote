/**
 * @fileoverview The output and the end of one login terminal as the port promises them: plain text in order, never
 * after the end, and one end that a late listener still hears. The editor's adapter and the recording fake both use it.
 */

import type {TerminalEnd} from './login-terminal.ts';
import {PlainTextFilter} from './plain-text.ts';

/** One or more carriage returns before a line feed: a pty adds one to the line end the program wrote. */
const LINE_END = /\r+\n/g;

/** The output and the end of one terminal. */
export class TerminalStream {
  private readonly outputListeners: Array<(text: string) => void> = [];
  private readonly endListeners: Array<(end: TerminalEnd) => void> = [];
  private readonly filter = new PlainTextFilter();
  private hadOutput = false;
  private heldReturns = '';
  private ended: TerminalEnd | undefined;

  /** Calls `listener` with each piece of output as plain text. */
  onOutput(listener: (text: string) => void): void {
    this.outputListeners.push(listener);
  }

  /** Calls `listener` once when the terminal ends; at once if it has already ended. */
  onEnd(listener: (end: TerminalEnd) => void): void {
    if (this.ended === undefined) {
      this.endListeners.push(listener);
    } else {
      listener(this.ended);
    }
  }

  /**
   * Delivers the plain text of `data` with its line ends normalised, unless the terminal has ended or nothing is left
   * to deliver. A run of carriage returns that ends the text waits for the next piece, which decides what it was.
   */
  write(data: string): void {
    if (this.ended !== undefined) {
      return;
    }
    const text = this.heldReturns + this.filter.push(data);
    const trailing = /\r+$/.exec(text)?.[0] ?? '';
    this.heldReturns = trailing;
    this.deliver(
      text.slice(0, text.length - trailing.length).replace(LINE_END, '\n'),
    );
  }

  /** Tells the listeners `text`, unless it is empty; any text counts as output. */
  private deliver(text: string): void {
    if (text === '') {
      return;
    }
    this.hadOutput = true;
    for (const listener of this.outputListeners) {
      listener(text);
    }
  }

  /** Ends the terminal, once: the first end is the one every listener hears. */
  end(code: number | undefined, reason: TerminalEnd['reason']): void {
    if (this.ended !== undefined) {
      return;
    }
    const released = this.heldReturns;
    this.heldReturns = '';
    this.deliver(released);
    const finished: TerminalEnd = {code, reason, hadOutput: this.hadOutput};
    this.ended = finished;
    for (const listener of this.endListeners) {
      listener(finished);
    }
  }
}
