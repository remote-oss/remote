/**
 * @fileoverview The recorder of the session hints: it keeps each hint of a connect in the record that connect started,
 * in the hint store of the extension's global state.
 */

import type {FailureHint, FailureReason, FilledString} from 'lib-authority';
import {type EnvironmentHint, statusNumberOf} from 'lib-ssh';
import {isFailureStringId, textOfId} from '../surfaces/failure-strings.ts';
import {ownText} from '../surfaces/own-strings.ts';
import type {Translate} from '../surfaces/strings.ts';
import {
  addHint,
  emptyHintStore,
  HINT_STORE_KEY,
  type HintStore,
  type SessionHint,
} from './hint-store.ts';

/** The global-state port the recorder reads and writes through. */
export interface HintRecorderState {
  get(key: string): HintStore | undefined;
  update(key: string, value: HintStore): PromiseLike<void>;
}

/** What the recorder needs besides the state. */
export interface HintRecorderEnvironment {
  translate: Translate;
  /** The address of the documentation the hints point to. */
  documentation: () => string;
  /** The time a connect starts, as the record names it. */
  now: () => Date;
  /** The environment hints a new record starts with, read as the settings are then. */
  environmentHints: () => readonly EnvironmentHint[];
  /** How many lines the log holds now: where the log text of a resolve that begins now starts. */
  logMark: () => number;
  /** The log's text from its `from`-th line on, as the log hint keeps it. */
  logText: (from: number) => string;
}

/** The recorder of one window's hints. */
export interface HintRecorder {
  /** Starts the record of a connect, with its environment hints; the hints that follow belong to it. */
  begin(): void;
  /** Keeps `hint` in the record of the connect that is running. */
  record(hint: FailureHint): void;
  /** The connect's resolve step has ended: its record gets the log hint, once. */
  end(): void;
  /** The error hints recorded for the connect that is running or ran last, in the order they were recorded. */
  errors(): SessionHint[];
}

/**
 * The text of a string of the failure table or of our own, with its values; an id in neither table gives the id itself,
 * so that no hint ever stops the connect that records it.
 */
function idText(reference: FilledString, translate: Translate): string {
  if (isFailureStringId(reference.id)) {
    return textOfId(reference.id, translate, [...reference.values]);
  }
  try {
    return ownText(
      {id: reference.id, values: [...reference.values]},
      translate,
    );
  } catch {
    return reference.id;
  }
}

/** The text of a hint's message or mitigation. */
function textOf(part: string | FilledString, translate: Translate): string {
  return typeof part === 'string' ? part : idText(part, translate);
}

/** The text of a hint's details: a reason's own text, or a string of either table. */
function reasonText(reason: FailureReason, translate: Translate): string {
  return 'text' in reason
    ? reason.text
    : idText({id: reason.id, values: []}, translate);
}

/** Whether two hints are the same error: the same status, message and details. */
function sameError(left: SessionHint, right: SessionHint): boolean {
  return (
    left.kind === 'error' &&
    right.kind === 'error' &&
    left.status === right.status &&
    left.message === right.message &&
    left.details === right.details
  );
}

/** The recorder over `state`. */
export function hintRecorderOf(
  state: HintRecorderState,
  environment: HintRecorderEnvironment,
): HintRecorder {
  let started = environment.now().toISOString();
  let begun = false;
  let logFrom = 0;
  let attemptErrors: SessionHint[] = [];
  let open = false;
  let writing: PromiseLike<void> = Promise.resolve();
  /**
   * Adds `hints` after those the record that started at `mine` already holds. An error hint the record already holds,
   * the same status, message and details, is not added again: one connect can meet the same error from two places.
   * A record that was begun and is gone, cleared or dropped as the oldest, does not come back with the hints that
   * follow it.
   */
  function append(mine: string, hints: SessionHint[], starts: boolean): void {
    const gone = begun && !starts;
    writing = writing.then(() => {
      const store = state.get(HINT_STORE_KEY) ?? emptyHintStore();
      const existing = store.records.find(each => each.started === mine);
      if (existing === undefined && gone) {
        return undefined;
      }
      const kept = existing?.hints ?? [];
      const fresh = hints.filter(
        hint =>
          hint.kind !== 'error' || !kept.some(each => sameError(each, hint)),
      );
      return state.update(
        HINT_STORE_KEY,
        addHint(store, {started: mine, hints: [...kept, ...fresh]}),
      );
    });
    // A write the state refuses does not end the writes after it, and is no unhandled rejection.
    writing = writing.then(undefined, () => undefined);
  }
  return {
    begin: () => {
      started = environment.now().toISOString();
      begun = true;
      open = true;
      attemptErrors = [];
      logFrom = environment.logMark();
      append(started, [...environment.environmentHints()], true);
    },
    record: hint => {
      const statusNumber = statusNumberOf(hint.status);
      const entry: SessionHint = {
        kind: 'error',
        status: hint.status,
        ...(statusNumber === undefined ? {} : {statusNumber}),
        message: textOf(hint.message, environment.translate),
        ...(hint.details === undefined
          ? {}
          : {details: reasonText(hint.details, environment.translate)}),
        mitigations: hint.mitigations.map(each =>
          textOf(each, environment.translate),
        ),
        resources: hint.resources.map(() => environment.documentation()),
      };
      if (!attemptErrors.some(each => sameError(each, entry))) {
        attemptErrors.push(entry);
      }
      append(started, [entry], false);
    },
    errors: () => [...attemptErrors],
    end: () => {
      if (open) {
        open = false;
        append(
          started,
          [{kind: 'log', text: environment.logText(logFrom)}],
          false,
        );
      }
    },
  };
}
