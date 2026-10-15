/**
 * @fileoverview The elapsed-time phrase of a row's tooltip the count is the elapsed time in the chosen
 * unit, rounded to the nearest whole number, and the unit is the largest one whose rounded count is at least 1, so each
 * unit takes over at half of itself.
 */

import {filled} from '../surfaces/filled.ts';
import type {Translate} from '../surfaces/engine-dialogs.ts';

/** The English template of each unit, by its string id; the singular form has the id of the plural with `One`. */
const TIME_TEMPLATES = {
  S430: '{0} days',
  S430One: '{0} day',
  S431: '{0} hours',
  S431One: '{0} hour',
  S434: '{0} minutes',
  S434One: '{0} minute',
  S435: '{0} seconds',
  S435One: '{0} second',
  S436: '{0} years',
  S436One: '{0} year',
} as const;

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const ONE_DAY = 24 * HOUR;
const YEAR = 365 * ONE_DAY;

/** A unit: its milliseconds and its singular and plural templates. */
interface TimeUnit {
  size: number;
  singular: string;
  plural: string;
}

const SECOND_UNIT: TimeUnit = {
  size: SECOND,
  singular: TIME_TEMPLATES.S435One,
  plural: TIME_TEMPLATES.S435,
};

/** The units above seconds, from the largest. */
const LARGER_UNITS: readonly TimeUnit[] = [
  {size: YEAR, singular: TIME_TEMPLATES.S436One, plural: TIME_TEMPLATES.S436},
  {
    size: ONE_DAY,
    singular: TIME_TEMPLATES.S430One,
    plural: TIME_TEMPLATES.S430,
  },
  {size: HOUR, singular: TIME_TEMPLATES.S431One, plural: TIME_TEMPLATES.S431},
  {size: MINUTE, singular: TIME_TEMPLATES.S434One, plural: TIME_TEMPLATES.S434},
];

/** The elapsed-time phrase without "ago", for example "1 minute" or "5 hours". */
export function elapsedPhraseOf(
  milliseconds: number,
  translate: Translate,
): string {
  const elapsed = Math.max(0, milliseconds);
  const unit =
    LARGER_UNITS.find(candidate => Math.round(elapsed / candidate.size) >= 1) ??
    SECOND_UNIT;
  const count = Math.round(elapsed / unit.size);
  return filled(translate, count === 1 ? unit.singular : unit.plural, [
    String(count),
  ]);
}
