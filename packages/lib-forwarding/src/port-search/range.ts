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
const DIGITS = /^\d+$/;

/**
 * Reads a `remote.SSH.preferredLocalPortRange` value. Accepts a string "A-B" (digits, one hyphen, optional
 * spaces around) with 1 <= A <= B <= 65535; anything else is ignored with a reason.
 */
export function parseRange(settingValue: unknown): ParsedRange {
  if (typeof settingValue !== 'string') {
    return {none: true, reason: 'notAString'};
  }
  const trimmed = settingValue.trim();
  if (trimmed === '') {
    return {none: true, reason: 'empty'};
  }
  const hyphen = trimmed.indexOf('-');
  const firstText = hyphen === -1 ? '' : trimmed.slice(0, hyphen).trim();
  const lastText = hyphen === -1 ? '' : trimmed.slice(hyphen + 1).trim();
  if (hyphen === -1 || !DIGITS.test(firstText) || !DIGITS.test(lastText)) {
    return {none: true, reason: 'badFormat'};
  }
  const first = Number(firstText);
  const last = Number(lastText);
  if (first < MIN_PORT || last > MAX_PORT) {
    return {none: true, reason: 'outOfBounds'};
  }
  if (first > last) {
    return {none: true, reason: 'reversed'};
  }
  return {range: {first, last}};
}
