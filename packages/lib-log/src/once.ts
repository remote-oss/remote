import type {Level} from './levels.ts';
import type {Logger} from './logger.ts';

// The keys already logged in this process; a new session resets the set, which clears the whole table.
const seenKeys = new Set<string>();

/**
 * Log `message` through `logger`, at `level` (default `info`), once per session: the first call for a
 * key writes and returns true, later calls for the same key return false and write nothing. A
 * sink-less logger counts the first call as written.
 */
export function logOncePerSession(
  logger: Logger,
  onceKey: string,
  message: string,
  level: Level = 'info',
): boolean {
  if (seenKeys.has(onceKey)) {
    return false;
  }
  seenKeys.add(onceKey);
  logger[level](message);
  return true;
}

/** Forget every key; a new session starts with a clean table. For tests. */
export function resetOncePerSession(): void {
  seenKeys.clear();
}
