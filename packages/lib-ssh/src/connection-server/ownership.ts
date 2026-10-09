/**
 * @fileoverview Who owns the login of a shared connection, and which question is open. The first lease owns the
 * login; when the owner cancels, its lease closes or its login fails, the oldest lease that still waits takes
 * over. The first answer to a question closes it for everyone.
 */

import type {PromptSurface} from './messages.ts';

/** The owner of the login among the live leases. */
export class LoginOwnership {
  private readonly onOwnerChanged: (owner: number) => void;
  private owner: number | undefined;
  private live: readonly number[] = [];
  private readonly gaveUp = new Set<number>();
  private finished = false;

  /** Tracking with no lease yet; `onOwnerChanged` is told each time a lease becomes the owner. */
  constructor(onOwnerChanged: (owner: number) => void) {
    this.onOwnerChanged = onOwnerChanged;
  }

  /** The owner's lease, or undefined while there is none. */
  current(): number | undefined {
    return this.owner;
  }

  /** The live leases that are not the owner, oldest first. */
  waiting(): number[] {
    return this.live.filter(leaseId => leaseId !== this.owner);
  }

  /** The live leases changed, `leaseIds` oldest first. A lease that closed can no longer own the login. */
  leasesChanged(leaseIds: readonly number[]): void {
    this.live = [...leaseIds];
    for (const leaseId of this.gaveUp) {
      if (!leaseIds.includes(leaseId)) {
        this.gaveUp.delete(leaseId);
      }
    }
    if (this.owner === undefined || !leaseIds.includes(this.owner)) {
      this.choose();
    }
  }

  /** The owner cancelled or its login failed: the oldest lease that has not given up takes over. */
  ownerGaveUp(): void {
    if (this.owner !== undefined) {
      this.gaveUp.add(this.owner);
    }
    this.choose();
  }

  /** The login is over, for better or worse: ownership no longer changes. */
  finish(): void {
    this.finished = true;
  }

  private choose(): void {
    if (this.finished) {
      return;
    }
    const next = this.live.find(leaseId => !this.gaveUp.has(leaseId));
    if (next === this.owner) {
      return;
    }
    this.owner = next;
    if (next !== undefined) {
      this.onOwnerChanged(next);
    }
  }
}

/** A question `ssh` asked and nobody has answered yet. */
export interface OpenPrompt {
  promptId: number;
  surface: PromptSurface;
  text: string;
}

/** The questions asked and not answered. The text of an answer passes through and is not kept. */
export class PromptBook {
  private readonly prompts = new Map<number, OpenPrompt>();
  private lastPromptId = 0;

  /** Records a new question and returns it with its number. */
  open(surface: PromptSurface, text: string): OpenPrompt {
    this.lastPromptId += 1;
    const prompt = {promptId: this.lastPromptId, surface, text};
    this.prompts.set(prompt.promptId, prompt);
    return prompt;
  }

  /** The questions still open, oldest first. */
  pending(): OpenPrompt[] {
    return [...this.prompts.values()];
  }

  /**
   * Takes the first answer to an open question: `deliver` receives its text and the question closes. False when the
   * question is closed already or never existed, and then nothing is delivered. The question closes before the
   * delivery, so an answer is lost when `deliver` throws and the user is asked again by the next question.
   */
  answer(
    promptId: number,
    text: string,
    deliver: (text: string) => void,
  ): boolean {
    if (!this.prompts.delete(promptId)) {
      return false;
    }
    deliver(text);
    return true;
  }

  /** Closes one open question that nobody answered, for example because `ssh` dropped it; false when none is open. */
  close(promptId: number): boolean {
    return this.prompts.delete(promptId);
  }

  /** Closes every open question, for a login that ended; returns their numbers. */
  closeAll(): number[] {
    const closed = [...this.prompts.keys()];
    this.prompts.clear();
    return closed;
  }
}
