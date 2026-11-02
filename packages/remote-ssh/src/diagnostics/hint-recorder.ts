/**
 * @fileoverview The recorder of the session hints: it keeps each hint of a connect in the record that connect started,
 * in the hint store of the extension's global state.
 */

import type {FailureHint, FilledString} from 'lib-ssh';
import {ownText} from '../surfaces/own-strings.ts';
import type {Translate} from '../surfaces/strings.ts';
import {
  addHint,
  emptyHintStore,
  HINT_STORE_KEY,
  type HintStore,
  type SessionRecord,
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
}

/** The recorder of one window's hints. */
export interface HintRecorder {
  /** Starts the record of a connect; the hints that follow belong to it. */
  begin(): void;
  /** Keeps `hint` in the record of the connect that is running. */
  record(hint: FailureHint): void;
}

/** The text of a hint's message or mitigation. */
function textOf(part: string | FilledString, translate: Translate): string {
  return typeof part === 'string' ? part : ownText(part, translate);
}

/** The recorder over `state`. */
export function hintRecorderOf(
  state: HintRecorderState,
  environment: HintRecorderEnvironment,
): HintRecorder {
  let started = environment.now().toISOString();
  let writing: PromiseLike<void> = Promise.resolve();
  return {
    begin: () => {
      started = environment.now().toISOString();
    },
    record: hint => {
      const mine = started;
      const entry: SessionRecord = {
        started: mine,
        hints: [
          {
            kind: 'error',
            status: hint.status,
            message: textOf(hint.message, environment.translate),
            mitigations: hint.mitigations.map(each =>
              textOf(each, environment.translate),
            ),
            resources: hint.resources.map(() => environment.documentation()),
          },
        ],
      };
      writing = writing.then(() => {
        const store = state.get(HINT_STORE_KEY) ?? emptyHintStore();
        const same = store.records.find(each => each.started === mine);
        return state.update(
          HINT_STORE_KEY,
          addHint(store, {
            started: mine,
            hints: [...(same?.hints ?? []), ...entry.hints],
          }),
        );
      });
    },
  };
}
