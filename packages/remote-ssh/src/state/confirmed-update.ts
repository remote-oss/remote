/**
 * @fileoverview A write to the extension's global state that is read back. The state is one object that every window
 * of the profile rewrites whole, and an older copy that arrives while a write is on its way can put the older value
 * back (remote-oss/remote#2326). The records that other windows or the harness read from it are written through here:
 * the value goes out at once, and in the background the key is read after a fixed delay; a value that is not the one
 * last written is written again, once, and read again after the same delay; a value that is still not there is
 * logged. The caller never waits for the read, so a record is stored when its write returns, and nothing here loops
 * without end.
 */

import type {Logger} from 'lib-log';

/** The part of the editor's state memento the write uses. */
export interface ConfirmedState<Value> {
  get(key: string): Value | undefined;
  update(key: string, value: Value): PromiseLike<void>;
}

/** What the write needs besides the state. */
export interface ConfirmedUpdateEnvironment {
  /** Waits for `milliseconds`; the memento has no change event to wait for instead. */
  delay(milliseconds: number): PromiseLike<void>;
  logger: Logger;
}

/** How long the write waits before it reads the key back: longer than an echo of the memento takes to arrive. */
export const READ_BACK_DELAY_MILLISECONDS = 500;

/** One key of the state, written and read back. */
export interface ConfirmedKey<Value> {
  /** Writes `value` and returns once the state took it; the read back goes on in the background. */
  write(value: Value): Promise<void>;
  /** Resolves when every read back that is going on has ended. */
  verified(): Promise<void>;
}

/** The text a value is compared by: the editor stores the state as JSON. */
function textOf(value: unknown): string {
  // JSON.stringify gives nothing for a value that is not stored at all.
  const json = JSON.stringify(value) as string | undefined;
  return json ?? '';
}

/**
 * The writes of `key` in `state`. A read back checks the value written last, never an earlier one, so a later write
 * is not undone by the check of an earlier one.
 */
export function confirmedKeyOf<Value>(
  state: ConfirmedState<Value>,
  key: string,
  environment: ConfirmedUpdateEnvironment,
): ConfirmedKey<Value> {
  let latest: Value | undefined;
  const checks = new Set<Promise<void>>();

  /** Reads the key after the delay, and once more after one write again; logs what is still not there. */
  async function check(): Promise<void> {
    for (const rewritten of [false, true]) {
      await environment.delay(READ_BACK_DELAY_MILLISECONDS);
      const written = textOf(latest);
      const read = textOf(state.get(key));
      if (read === written) {
        if (rewritten) {
          environment.logger.warn(
            `the global state key ${key} did not hold what was written, and holds it after a second write`,
          );
        }
        return;
      }
      if (rewritten) {
        environment.logger.error(
          `the global state key ${key} does not hold what was written: ${String(written.length)} bytes written, ${String(read.length)} read`,
        );
        return;
      }
      await state.update(key, latest as Value);
    }
  }

  return {
    write: async value => {
      latest = value;
      await state.update(key, value);
      const pending = check()
        .catch(() => undefined)
        .finally(() => {
          checks.delete(pending);
        });
      checks.add(pending);
    },
    verified: async () => {
      while (checks.size > 0) {
        await Promise.all([...checks]);
      }
    },
  };
}

/** The delay of the editor: a timer. */
export function timerDelay(milliseconds: number): PromiseLike<void> {
  return new Promise(resolve => {
    setTimeout(resolve, milliseconds);
  });
}
