/**
 * @fileoverview The questions an askpass program asked and nobody has answered yet. The text of an answer passes
 * through and is not kept.
 */

/** A question the askpass program asked and nobody has answered yet; `Surface` is the classifier's kind of question. */
export interface OpenPrompt<Surface extends string = string> {
  promptId: number;
  surface: Surface;
  text: string;
}

/** The questions asked and not answered. The text of an answer passes through and is not kept. */
export class PromptBook<Surface extends string = string> {
  private readonly prompts = new Map<number, OpenPrompt<Surface>>();
  private lastPromptId = 0;

  /** Records a new question and returns it with its number. */
  open(surface: Surface, text: string): OpenPrompt<Surface> {
    this.lastPromptId += 1;
    const prompt = {promptId: this.lastPromptId, surface, text};
    this.prompts.set(prompt.promptId, prompt);
    return prompt;
  }

  /** The questions still open, oldest first. */
  pending(): Array<OpenPrompt<Surface>> {
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
