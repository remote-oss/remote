/**
 * @fileoverview The windows a row left open: which are open now, and closing all but those a suite keeps, so a row
 * that failed before closing its own windows leaves none behind for the rows after it.
 */
import {closeContained, isOpen, windowNames} from '../windows/harness.ts';

/** The windows that are open now, by name. */
export function openWindowNames(): string[] {
  return windowNames().filter(isOpen);
}

/**
 * The launch's own window, which every row runs its harness commands through. It is never a row's leftover, even when
 * a row began before its agent had reported that it activated.
 */
const LAUNCH_WINDOW = 'local';

/** Closes every window that is open now and isn't in `kept` or the launch's own, as {@link closeContained} does. */
export async function closeWindowsBut(
  kept: readonly string[],
  dismiss: (window: string) => Promise<void>,
): Promise<void> {
  for (const name of openWindowNames()) {
    if (name !== LAUNCH_WINDOW && !kept.includes(name)) {
      await closeContained(name, dismiss);
    }
  }
}
