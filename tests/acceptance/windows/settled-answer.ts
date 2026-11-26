/** What the quick input box of a window shows, as far as an answer to it depends on. */
export interface InputBoxFacts {
  /** Whether the box is open. */
  open: boolean;
  /** The text in its input. */
  value: string;
  /** The message under the input: a validation error or a hint; empty when there is none. */
  message: string;
  /** Whether the box shows that it is still validating the value. */
  validating: boolean;
  /** Whether the input has the focus. */
  focused: boolean;
}

/** What an answer to an input box is made of. */
export interface SettledAnswerPorts {
  /** What the box shows now. */
  facts(): Promise<InputBoxFacts>;
  /** Sets the value of the box's input, as a user's typing would. */
  type(text: string): Promise<void>;
  /** Presses Enter in the box. */
  enter(): Promise<void>;
  sleep(milliseconds: number): Promise<void>;
  now(): number;
}

/** How long each wait of an answer lasts before it gives up, in milliseconds. */
const ANSWER_WAIT_MILLISECONDS = 5000;

/** How often the box is read while an answer waits, in milliseconds. */
const READ_EVERY_MILLISECONDS = 100;

/** How long an Enter has to close the box before it is pressed once more, in milliseconds. */
const ENTER_TAKEN_MILLISECONDS = 3000;

/** The box's facts as a line, for the message of an answer that did not go through. */
export function describedBox(facts: InputBoxFacts): string {
  return JSON.stringify(facts);
}

/** Reads the box until `done` holds of what it shows, or the wait is over; gives the last reading. */
async function readUntil(
  ports: SettledAnswerPorts,
  done: (facts: InputBoxFacts) => boolean,
  milliseconds: number,
): Promise<InputBoxFacts> {
  const deadline = ports.now() + milliseconds;
  let facts = await ports.facts();
  while (!done(facts) && ports.now() < deadline) {
    await ports.sleep(READ_EVERY_MILLISECONDS);
    facts = await ports.facts();
  }
  return facts;
}

/** How many times an answer types its text and presses Enter before it leaves the box to the caller's bound. */
const ANSWER_ATTEMPTS = 2;

/**
 * Answers the input box that is open with `text`, as a user does: it types the text, waits until the box has taken it and
 * has finished validating it, and presses Enter. A box that is still open `ENTER_TAKEN_MILLISECONDS` later lost the Enter
 * or its value (the box's own update may clear what was typed while it opened), so the answer types the text again and
 * presses Enter once more. An answer that cannot be given fails with what the box showed.
 */
export async function answerSettled(
  ports: SettledAnswerPorts,
  text: string,
): Promise<void> {
  const opened = await readUntil(
    ports,
    facts => facts.open,
    ANSWER_WAIT_MILLISECONDS,
  );
  if (!opened.open) {
    throw new Error(`no input box opened to answer: ${describedBox(opened)}`);
  }
  for (let attempt = 0; attempt < ANSWER_ATTEMPTS; attempt += 1) {
    await ports.type(text);
    const settled = await readUntil(
      ports,
      facts => facts.value === text && !facts.validating,
      ANSWER_WAIT_MILLISECONDS,
    );
    if (settled.value !== text || settled.validating) {
      throw new Error(
        `the input box did not take ${JSON.stringify(text)} and settle: ${describedBox(settled)}`,
      );
    }
    await ports.enter();
    const answered = await readUntil(
      ports,
      facts => !facts.open,
      ENTER_TAKEN_MILLISECONDS,
    );
    if (!answered.open) {
      return;
    }
  }
}
