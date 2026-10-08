/** A log level, from the most detailed to the most severe. */
export type Level = 'trace' | 'debug' | 'info' | 'warn' | 'error';

/**
 * The levels in severity order: a level is at or above another when its index is not smaller.
 * Frozen, because the logger compares by index.
 */
export const LEVEL_ORDER: readonly Level[] = Object.freeze([
  'trace',
  'debug',
  'info',
  'warn',
  'error',
]);
