/**
 * @fileoverview The helper's askpass endpoint: the client (`ssh`, `git`) runs the askpass program once per question, the program
 * connects here with the askpass nonce, and the question stays open until a window answers it or `ssh` drops it. No
 * answer is stored or logged: it passes from the window's request to the program's connection and is gone.
 */

import type {EndpointConnection} from '../endpoint/protocol.ts';
import type {Scheduler} from '../runtime/end-policy.ts';
import {readAskRequest} from './messages.ts';
import {PromptBook, type OpenPrompt} from './prompt-book.ts';

/** What the endpoint needs to know and tell; `Surface` is the classifier's kind of question. */
export interface AskpassHooks<Surface extends string = string> {
  /** The nonce the program must present; any other connection is closed. */
  nonce: string;
  /** The kind of question a prompt's text is, which decides how a window shows it. */
  classify(text: string): Surface;
  scheduler: Scheduler;
  /** How long a connection may take to send its question before it is closed; no wait is unbounded. */
  firstMessageMilliseconds: number;
  logLine: (line: string) => void;
  /** A question opened. */
  onPrompt(prompt: OpenPrompt<Surface>): void;
  /** A question closed without an answer from a window. */
  onPromptClosed(promptId: number): void;
}

/** The default for `AskpassHooks.firstMessageMilliseconds`: a launcher that speaks does so at once. */
export const DEFAULT_FIRST_MESSAGE_MILLISECONDS = 5000;

/** A question whose program waits for the answer. */
interface Waiting {
  connection: EndpointConnection;
  deliver: (text: string) => void;
}

/** The askpass side of one shared connection. */
export class AskpassEndpoint<Surface extends string = string> {
  private readonly hooks: AskpassHooks<Surface>;
  private readonly book = new PromptBook<Surface>();
  private readonly waiting = new Map<number, Waiting>();
  private readonly connections = new Set<EndpointConnection>();
  private runRefused = false;

  /** An endpoint with no question open. */
  constructor(hooks: AskpassHooks<Surface>) {
    this.hooks = hooks;
  }

  /** Takes a connection of the askpass program; pass it to the endpoint port's `listen`. */
  accept(connection: EndpointConnection): void {
    this.connections.add(connection);
    let promptId: number | undefined;
    const cancelDeadline = this.hooks.scheduler.setTimer(
      this.hooks.firstMessageMilliseconds,
      () => {
        this.hooks.logLine('an askpass connection sent no question in time');
        connection.close();
      },
    );
    connection.onClose(() => {
      cancelDeadline();
      this.connections.delete(connection);
      if (promptId !== undefined && this.waiting.delete(promptId)) {
        this.book.close(promptId);
        this.hooks.onPromptClosed(promptId);
      }
    });
    connection.onMessage(value => {
      cancelDeadline();
      const request = readAskRequest(value);
      if (promptId !== undefined || request?.nonce !== this.hooks.nonce) {
        connection.close();
        return;
      }
      if (this.runRefused) {
        connection.close();
        return;
      }
      const prompt = this.book.open(
        this.hooks.classify(request.text),
        request.text,
      );
      promptId = prompt.promptId;
      this.waiting.set(prompt.promptId, {
        connection,
        deliver: text => {
          connection.send({type: 'answer', text});
          connection.close();
        },
      });
      this.hooks.onPrompt(prompt);
    });
  }

  /** The questions still open, oldest first, for a window that joined late. */
  pending(): Array<OpenPrompt<Surface>> {
    return this.book.pending();
  }

  /** Passes the first answer to an open question to its program; false when the question is not open. */
  answer(promptId: number, text: string): boolean {
    const entry = this.waiting.get(promptId);
    if (entry === undefined) {
      return false;
    }
    this.waiting.delete(promptId);
    return this.book.answer(promptId, text, entry.deliver);
  }

  /**
   * Closes one open question unanswered: its program gets the close and exits 1, which `ssh` takes as a cancelled
   * prompt. False when the question is not open; the close, the answer and the `promptClosed` the windows hear are
   * the same as for a question that `ssh` dropped.
   */
  refuse(promptId: number): boolean {
    const entry = this.waiting.get(promptId);
    if (entry === undefined) {
      return false;
    }
    this.waiting.delete(promptId);
    this.book.close(promptId);
    entry.connection.close();
    this.hooks.onPromptClosed(promptId);
    return true;
  }

  /**
   * Marks the run the owner refused its question: every question the run asks from now on is closed on arrival,
   * before the windows hear of it. The mark clears when the run ends and `closeAll` runs.
   */
  refuseRun(): void {
    this.runRefused = true;
  }

  /** The login ended: every question closes unanswered and every connection is closed. */
  closeAll(): void {
    for (const promptId of this.book.closeAll()) {
      this.waiting.delete(promptId);
      this.hooks.onPromptClosed(promptId);
    }
    for (const connection of [...this.connections]) {
      connection.close();
    }
    this.runRefused = false;
  }
}
