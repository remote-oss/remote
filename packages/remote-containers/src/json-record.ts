/**
 * @fileoverview The one reading of a parsed JSON value as a plain object, shared by the readers of JSON the package
 * gets from the engine and from an authority.
 */

/** The value as an object when it is a plain one (not null, not a list), else none. */
export function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
