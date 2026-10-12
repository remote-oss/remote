/**
 * @fileoverview The questions of a login terminal, shown to the user: each question the reader reports is shown as
 * the classifier chose and the answer is sent back to the terminal, one input at a time. A question the user
 * dismisses is refused for the rest of the attempt: it and every later question are answered without an input,
 * an empty line for a credential and no for a host key.
 */

import {classifyPrompt, type TerminalLogin} from 'lib-ssh';
import {askQuestion, type PromptEditor} from './prompt-surface.ts';

/**
 * Shows each question the reader reports and answers the terminal; a dismissal refuses the rest of the attempt,
 * and the returned handle takes an open input down.
 */
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
  let refusing = false;
  let controller: AbortController | undefined;

  /** The refusing answer for this question: an empty line for a credential, no for a host key. */
  function refusalFor(text: string): string {
    return classifyPrompt(text, displayHost).surface === 'maskedInput'
      ? '\r'
      : 'no\r';
  }

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
      const answer = refusing
        ? undefined
        : await askQuestion(editor, text, displayHost, current.signal);
      controller = undefined;
      if (!disposed) {
        if (answer !== undefined) {
          terminal.send(`${answer}\r`);
        } else {
          refusing = true;
          terminal.send(refusalFor(text));
        }
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
