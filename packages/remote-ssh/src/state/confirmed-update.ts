/**
 * @fileoverview A write to the extension's global state that is read back. The state is one object that every window
 * of the profile rewrites whole, and an older copy that arrives while a write is on its way can put the older value
 * back (remote-oss/remote#2326). The records that other windows or the harness read from it are written through here:
 * after a fixed delay the key is read, a value that is not the one written is written once more and read once more
 * after the same delay, and a value that is still not there is logged. Nothing here loops without end.
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

/** The text a value is compared by: the editor stores the state as JSON. */
function textOf(value: unknown): string {
  // JSON.stringify gives nothing for a value that is not stored at all.
  const json = JSON.stringify(value) as string | undefined;
  return json ?? '';
}

/**
 * Writes `value` under `key`, reads it back after the delay, writes it once more when it is not there and reads it
 * back once more, and logs an error line naming the key and the bytes written and read when it is still not there.
 */
export async function confirmedUpdate<Value>(
  state: ConfirmedState<Value>,
  key: string,
  value: Value,
  environment: ConfirmedUpdateEnvironment,
): Promise<void> {
  const written = textOf(value);
  for (const rewritten of [false, true]) {
    await state.update(key, value);
    await environment.delay(READ_BACK_DELAY_MILLISECONDS);
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
    }
  }
}

/** The delay of the editor: a timer. */
export function timerDelay(milliseconds: number): PromiseLike<void> {
  return new Promise(resolve => {
    setTimeout(resolve, milliseconds);
  });
}
