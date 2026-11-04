/**
 * @fileoverview The questions that an SSH Docker endpoint asks through the askpass relay: the window's memory of the
 * answers, the box that asks, and who may open one. A question with a remembered answer gets it at once; one whose
 * text already has a box of the same endpoint waits for that box; one asked by no user action is refused; any other opens a box. Answers and boxes belong to the endpoint that asked, never to its text alone. The memory
 * lives in the window alone and is never written, logged or put in an environment.
 */

import {deferred} from '../deferred.ts';
import {isHostKeyQuestion} from '../askpass-text.ts';

/** Who started the operation whose `docker` processes may ask: whether a question may open a box. */
export type QuestionMode = 'command' | 'view' | 'automatic';

/** What the window remembers of a question's text. */
type Remembered = {kind: 'answer'; text: string} | {kind: 'declined'};

/** What an operation's questions came to, for the one that shows its result. */
export interface QuestionOutcome {
  /** A box of the operation was answered or dismissed. */
  boxClosed: boolean;
  /** A question was refused for lack of an answer, or by a remembered decline. */
  refused: boolean;
  /** A remembered answer was given. */
  replayed: boolean;
  /** A remembered decline was applied. */
  declinedApplied: boolean;
}

/** An operation that may ask, with the mode it was started in, the endpoint it talks to and what its questions came to. */
export interface QuestionOperation {
  readonly mode: QuestionMode;
  /** The Docker endpoint (its ssh address) whose processes ask: an answer is for this endpoint alone. */
  readonly endpoint: string;
  readonly outcome: QuestionOutcome;
}

/** A new operation started in `mode` against `endpoint`. */
export function operationOf(
  mode: QuestionMode,
  endpoint: string,
): QuestionOperation {
  return {
    mode,
    endpoint,
    outcome: {
      boxClosed: false,
      refused: false,
      replayed: false,
      declinedApplied: false,
    },
  };
}

/** What the relay answers a question with. */
type QuestionResult =
  | {kind: 'answer'; text: string}
  | {kind: 'refused'; reason: 'declined' | 'noAnswer'};

/** What the router needs of the editor. */
export interface QuestionPorts {
  /** Opens the box: `prompt` is its text, `masked` hides the input. Gives the text typed, or none when it closed without Enter. */
  openBox(prompt: string, masked: boolean): Promise<string | undefined>;
  /** Whether the window has the focus of the system. */
  windowFocused(): boolean;
  /** Shows the notice that points at the box, until `closed` settles. */
  pointAtBox(closed: Promise<void>): void;
  /** The prompt of a box whose question has no text. */
  emptyPrompt: string;
}

/** The router of one window's questions. */
export interface QuestionRouter {
  /** Answers `question` for `operation`. */
  ask(operation: QuestionOperation, question: string): Promise<QuestionResult>;
  /** How many boxes are open now. */
  openBoxes(): number;
  /** Calls `listener` with the number of open boxes each time it changes; gives the way to stop. */
  onBoxes(listener: (open: number) => void): () => void;
  /** Whether the window remembers something for `question` asked by `endpoint`. */
  remembers(endpoint: string, question: string): Remembered | undefined;
}

/** The key of a question: its text alone does not tell which host asks, so the endpoint is part of it. */
function keyOf(endpoint: string, question: string): string {
  return JSON.stringify([endpoint, question]);
}

/** The router over `ports`, with an empty memory. */
export function createQuestionRouter(ports: QuestionPorts): QuestionRouter {
  const memory = new Map<string, Remembered>();
  const boxes = new Map<string, Promise<Remembered>>();
  const listeners = new Set<(open: number) => void>();

  /** Tells the listeners how many boxes are open. */
  function changed(): void {
    for (const listener of listeners) {
      listener(boxes.size);
    }
  }

  /** Opens the box of `question` under `key`, keeps its result and gives it. */
  function openBoxFor(key: string, question: string): Promise<Remembered> {
    const masked = !isHostKeyQuestion(question);
    const closed = deferred<void>();
    if (!ports.windowFocused()) {
      ports.pointAtBox(closed.promise);
    }
    const result = ports
      .openBox(question === '' ? ports.emptyPrompt : question, masked)
      .then((text): Remembered =>
        text === undefined ? {kind: 'declined'} : {kind: 'answer', text},
      )
      .then(remembered => {
        memory.set(key, remembered);
        boxes.delete(key);
        closed.resolve();
        changed();
        return remembered;
      });
    boxes.set(key, result);
    changed();
    return result;
  }

  /** The result of a remembered decline or answer as the relay's answer. */
  function resultOf(
    remembered: Remembered,
    operation: QuestionOperation,
    fromBox: boolean,
  ): QuestionResult {
    if (fromBox) {
      operation.outcome.boxClosed = true;
    }
    if (remembered.kind === 'answer') {
      if (!fromBox) {
        operation.outcome.replayed = true;
      }
      return {kind: 'answer', text: remembered.text};
    }
    if (!fromBox) {
      operation.outcome.declinedApplied = true;
      operation.outcome.refused = true;
    }
    return {kind: 'refused', reason: 'declined'};
  }

  return {
    ask: async (operation, question) => {
      const key = keyOf(operation.endpoint, question);
      const known = memory.get(key);
      if (known !== undefined) {
        return resultOf(known, operation, false);
      }
      const open = boxes.get(key);
      if (open !== undefined) {
        return resultOf(await open, operation, true);
      }
      if (operation.mode === 'automatic') {
        operation.outcome.refused = true;
        return {kind: 'refused', reason: 'noAnswer'};
      }
      return resultOf(await openBoxFor(key, question), operation, true);
    },
    openBoxes: () => boxes.size,
    onBoxes: listener => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    remembers: (endpoint, question) => memory.get(keyOf(endpoint, question)),
  };
}
