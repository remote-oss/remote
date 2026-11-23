/**
 * @fileoverview When the declared forwards may open: core labels a forwarded port from the port attributes in effect
 * when the port is registered, and the container's machine settings reach the window a moment after the connection.
 * The forwards wait until the attributes the connection wrote are in effect in the window, or a bound passed.
 */

import type {Scheduler} from 'lib-helper';
import {isRecord} from '../extensions/extension-list.ts';
import type {MachineSettings} from '../settings/machine-settings.ts';

/** The window's settings as the wait reads them, as ports so that the wait unit-tests without the editor. */
export interface AttributeEvents {
  /** The value of setting `key` in effect in the window now. */
  effective(key: string): unknown;
  /** Calls `listener` when a change reaches the port attribute settings; gives back what removes the listener. */
  onChanged(listener: () => void): {dispose(): void};
}

/**
 * The longest the forwards wait for the attributes. The window's machine settings arrive within about one and a half
 * seconds of the connection on the runners; settings that never arrive, because their write failed, must not hold the
 * forwards back longer than this.
 */
export const ATTRIBUTES_BOUND_MILLISECONDS = 3_000;

/** What ended the wait: nothing to wait for, the attributes in effect, or the bound. */
export type AttributesWait = 'none' | 'inEffect' | 'bound';

/**
 * Whether `effective` holds `written`: every property of a written object is held by the effective one, at any depth,
 * and any other value is equal. The window merges an object setting with the user's own value of it, so the effective
 * value may hold more than was written.
 */
function holds(effective: unknown, written: unknown): boolean {
  if (isRecord(written)) {
    return (
      isRecord(effective) &&
      Object.entries(written).every(([key, value]) =>
        holds(effective[key], value),
      )
    );
  }
  return JSON.stringify(effective) === JSON.stringify(written);
}

/** Whether every setting of `written` is in effect in the window. */
export function attributesInEffect(
  written: MachineSettings,
  events: Pick<AttributeEvents, 'effective'>,
): boolean {
  return Object.entries(written).every(([key, value]) =>
    holds(events.effective(key), value),
  );
}

/**
 * Resolves once the settings of `written` are all in effect in the window, at once when they already are or when there
 * are none, or when `bound` passes. The listener and the timer are removed once it resolves.
 */
export function untilAttributesInEffect(
  written: MachineSettings,
  events: AttributeEvents,
  scheduler: Scheduler,
  bound = ATTRIBUTES_BOUND_MILLISECONDS,
): Promise<AttributesWait> {
  if (Object.keys(written).length === 0) {
    return Promise.resolve('none');
  }
  if (attributesInEffect(written, events)) {
    return Promise.resolve('inEffect');
  }
  return new Promise(resolve => {
    const listener = events.onChanged(() => {
      if (attributesInEffect(written, events)) {
        finish('inEffect');
      }
    });
    const cancel = scheduler.setTimer(bound, () => {
      finish('bound');
    });
    function finish(outcome: AttributesWait): void {
      listener.dispose();
      cancel();
      resolve(outcome);
    }
  });
}
