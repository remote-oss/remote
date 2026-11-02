/**
 * @fileoverview Parses the preferred local port range from the setting value, or names why the value is ignored.
 */

/** An inclusive port range: 1 <= first <= last <= 65535. */
export interface PortRange {
  first: number;
  last: number;
}

/** The outcome of reading a preferred range: the range, or why the value is ignored. */
export type ParsedRange = {range: PortRange} | {none: true; reason: string};

const MIN_PORT = 1;
const MAX_PORT = 65535;
const RANGE = /^(\d+)-(\d+)$/;

/**
 * Reads a `remote.SSH.preferredLocalPortRange` value. Accepts a string "A-B" (digits, one hyphen, nothing else)
 * with 1 <= A <= B <= 65535, as the setting's pattern does; anything else is ignored with a reason.
 */
export function parseRange(settingValue: unknown): ParsedRange {
  if (typeof settingValue !== 'string') {
    return {none: true, reason: 'notAString'};
  }
  if (settingValue === '') {
    return {none: true, reason: 'empty'};
  }
  const match = RANGE.exec(settingValue);
  if (match === null) {
    return {none: true, reason: 'badFormat'};
  }
  const first = Number(match[1]);
  const last = Number(match[2]);
  if (first < MIN_PORT || last > MAX_PORT) {
    return {none: true, reason: 'outOfBounds'};
  }
  if (first > last) {
    return {none: true, reason: 'reversed'};
  }
  return {range: {first, last}};
}
