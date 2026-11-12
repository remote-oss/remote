/**
 * @fileoverview Asks made one at a time per key: the harness reads the report of a window's agent by the count of its
 * events, so two asks of one event of one window must not overlap. An ask that has waited longer than its limit behind
 * the ones before it does not start, so a window that answers nothing holds the others up for one wait, not for as many
 * as were queued.
 */

/** Runs `task` after the asks of `key` made before it, and gives its result. */
export type SerialAsks = <Result>(
  key: string,
  limitMilliseconds: number,
  task: () => Promise<Result>,
) => Promise<Result>;

/** The asks of one world: those of one key run one at a time, in the order they were made; `now` is its clock. */
export function createSerialAsks(now: () => number = Date.now): SerialAsks {
  /** The last ask of each key, as a promise that never rejects, so the next ask starts after it ends, however it ends. */
  const lastOfKey = new Map<string, Promise<undefined>>();
  return function serial<Result>(
    key: string,
    limitMilliseconds: number,
    task: () => Promise<Result>,
  ): Promise<Result> {
    const queuedAt = now();
    const answer = (lastOfKey.get(key) ?? Promise.resolve()).then(() => {
      const waited = now() - queuedAt;
      if (waited > limitMilliseconds) {
        throw new Error(
          `${key}: this ask waited ${String(waited)} ms behind the asks before it, more than its limit of ${String(limitMilliseconds)} ms, so it did not start`,
        );
      }
      return task();
    });
    const settled = answer.then(
      () => undefined,
      () => undefined,
    );
    lastOfKey.set(key, settled);
    void settled.then(() => {
      if (lastOfKey.get(key) === settled) {
        lastOfKey.delete(key);
      }
    });
    return answer;
  };
}
