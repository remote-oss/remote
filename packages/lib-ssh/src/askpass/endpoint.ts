/**
 * @fileoverview The helper's askpass endpoint: `ssh` runs the askpass program once per question, the program
 * connects here with the askpass nonce, and the question stays open until a window answers it or `ssh` drops it. No
 * answer is stored or logged: it passes from the window's request to the program's connection and is gone.
 */

import type {EndpointConnection} from 'lib-helper';
import {PromptBook, type OpenPrompt} from '../connection-server/ownership.ts';
import {classifyPrompt} from '../prompts/classify.ts';
import {readAskRequest} from './messages.ts';

/** What the endpoint needs to know and tell. */
export interface AskpassHooks {
  /** The nonce the program must present; any other connection is closed. */
  nonce: string;
  /** The host as the user named it, for the texts of the surfaces. */
  displayHost: string;
  /** A question opened. */
  onPrompt(prompt: OpenPrompt): void;
  /** A question closed without an answer from a window. */
  onPromptClosed(promptId: number): void;
}

/** A question whose program waits for the answer. */
interface Waiting {
  connection: EndpointConnection;
  deliver: (text: string) => void;
}

/** The askpass side of one shared connection. */
export class AskpassEndpoint {
  private readonly hooks: AskpassHooks;
  private readonly book = new PromptBook();
  private readonly waiting = new Map<number, Waiting>();
  private readonly connections = new Set<EndpointConnection>();

  /** An endpoint with no question open. */
  constructor(hooks: AskpassHooks) {
    this.hooks = hooks;
  }

  /** Takes a connection of the askpass program; pass it to the endpoint port's `listen`. */
  accept(connection: EndpointConnection): void {
    this.connections.add(connection);
    let promptId: number | undefined;
    connection.onClose(() => {
      this.connections.delete(connection);
      if (promptId !== undefined && this.waiting.delete(promptId)) {
        this.book.close(promptId);
        this.hooks.onPromptClosed(promptId);
      }
    });
    connection.onMessage(value => {
      const request = readAskRequest(value);
      if (promptId !== undefined || request?.nonce !== this.hooks.nonce) {
        connection.close();
        return;
      }
      const prompt = this.book.open(
        classifyPrompt(request.text, this.hooks.displayHost).surface,
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
  pending(): OpenPrompt[] {
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

  /** The login ended: every question closes unanswered and every connection is closed. */
  closeAll(): void {
    for (const promptId of this.book.closeAll()) {
      this.waiting.delete(promptId);
      this.hooks.onPromptClosed(promptId);
    }
    for (const connection of [...this.connections]) {
      connection.close();
    }
  }
}
