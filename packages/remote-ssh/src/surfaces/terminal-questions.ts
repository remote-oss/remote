/**
 * @fileoverview The questions of a login terminal, shown to the user: each question the reader reports is shown as
 * the classifier chose and the answer is sent back to the terminal, one input at a time.
 */

import type {LoginTerminalSession, PromptReader} from 'lib-ssh';
import {askQuestion, type PromptEditor} from './prompt-surface.ts';

/** The terminal and the reader one login's questions come from. */
export interface TerminalLogin {
  terminal: Pick<LoginTerminalSession, 'send'>;
  reader: Pick<PromptReader, 'inputOpened' | 'inputClosed'>;
}

/** Shows each question the reader reports and answers the terminal; the returned handle takes an open input down. */
export function attachTerminalQuestions(
  login: TerminalLogin,
  editor: PromptEditor,
  displayHost: string,
): {
  /** Give this as the reader's `onQuestion`. */
  onQuestion(text: string): void;
  dispose(): void;
} {
  const {terminal, reader} = login;
  const queue: string[] = [];
  let draining = false;
  let disposed = false;
  let controller: AbortController | undefined;

  function onQuestion(text: string): void {
    if (disposed) {
      return;
    }
    queue.push(text);
    if (!draining) {
      draining = true;
      void showNext();
    }
  }

  async function showNext(): Promise<void> {
    for (;;) {
      const text = queue.shift();
      if (text === undefined) {
        draining = false;
        return;
      }
      reader.inputOpened();
      const current = new AbortController();
      controller = current;
      const answer = await askQuestion(
        editor,
        text,
        displayHost,
        current.signal,
      );
      controller = undefined;
      if (!disposed && answer !== undefined) {
        terminal.send(`${answer}\r`);
      }
      reader.inputClosed();
    }
  }

  function dispose(): void {
    disposed = true;
    queue.length = 0;
    controller?.abort();
  }

  return {onQuestion, dispose};
}
