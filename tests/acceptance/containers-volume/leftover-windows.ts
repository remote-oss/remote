/**
 * @fileoverview The windows a row left open: which are open now, and closing all but those a suite keeps, so a row
 * that failed before closing its own windows leaves none behind for the rows after it.
 */
import {closeContained, isOpen, windowNames} from '../windows/harness.ts';

/** The windows that are open now, by name. */
export function openWindowNames(): string[] {
  return windowNames().filter(isOpen);
}

/** Closes every window that is open now and isn't in `kept`, as {@link closeContained} does. */
export async function closeWindowsBut(
  kept: readonly string[],
  dismiss: (window: string) => Promise<void>,
): Promise<void> {
  for (const name of openWindowNames()) {
    if (!kept.includes(name)) {
      await closeContained(name, dismiss);
    }
  }
}
