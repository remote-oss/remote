import {deepStrictEqual} from 'node:assert';
import {
  agoPhraseOf,
  elapsedPhraseOf,
} from '../../src/explorer/relative-time.ts';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const ONE_DAY = 24 * HOUR;

/** The phrase of an elapsed time given as `[days, hours, minutes, seconds]`. */
function phrase(
  days: number,
  hours: number,
  minutes: number,
  seconds: number,
): string {
  return elapsedPhraseOf(
    days * ONE_DAY + hours * HOUR + minutes * MINUTE + seconds * SECOND,
    template => template,
  );
}

describe('the elapsed-time phrase (card containers-29)', () => {
  it('F-0901 AC-11: 0 seconds, and exactly 1 minute in the singular', () => {
    deepStrictEqual(
      [phrase(0, 0, 0, 0), phrase(0, 0, 1, 0), phrase(0, 0, 0, 1)],
      ['0 seconds', '1 minute', '1 second'],
    );
  });

  it('F-0901 AC-54, VS-25: each reading of the table, rounded to the nearest unit', () => {
    deepStrictEqual(
      [
        phrase(0, 0, 0, 23),
        phrase(0, 0, 0, 28),
        phrase(0, 0, 0, 33),
        phrase(0, 0, 1, 28),
        phrase(0, 0, 1, 35),
        phrase(0, 0, 29, 55),
        phrase(0, 0, 30, 15),
        phrase(0, 5, 21, 0),
        phrase(0, 7, 8, 0),
        phrase(0, 12, 18, 0),
        phrase(4, 17, 39, 0),
        phrase(0, 7, 49, 0),
      ],
      [
        '23 seconds',
        '28 seconds',
        '1 minute',
        '1 minute',
        '2 minutes',
        '30 minutes',
        '1 hour',
        '5 hours',
        '7 hours',
        '1 day',
        '5 days',
        '8 hours',
      ],
    );
  });

  it('F-0901 AC-36: about 66 minutes is 1 hour', () => {
    deepStrictEqual(phrase(0, 1, 6, 0), '1 hour');
  });

  it('F-0901 BR-5: each unit takes over at half of itself', () => {
    deepStrictEqual(
      [
        elapsedPhraseOf(29_999, template => template),
        elapsedPhraseOf(30_000, template => template),
        elapsedPhraseOf(30 * MINUTE - 1, template => template),
        elapsedPhraseOf(30 * MINUTE, template => template),
        elapsedPhraseOf(12 * HOUR - 1, template => template),
        elapsedPhraseOf(12 * HOUR, template => template),
      ],
      ['30 seconds', '1 minute', '30 minutes', '1 hour', '12 hours', '1 day'],
    );
  });

  it('F-0901 7.E3, S436: past half a year the unit is years, with the singular at one', () => {
    deepStrictEqual(
      [
        elapsedPhraseOf(364 * ONE_DAY, template => template),
        elapsedPhraseOf(2 * 365 * ONE_DAY, template => template),
        elapsedPhraseOf(183 * ONE_DAY, template => template),
        elapsedPhraseOf(182 * ONE_DAY, template => template),
      ],
      ['1 year', '2 years', '1 year', '182 days'],
    );
  });

  it('F-0901 BR-5: a negative elapsed time reads as none', () => {
    deepStrictEqual(
      elapsedPhraseOf(-5 * SECOND, template => template),
      '0 seconds',
    );
  });

  it('F-0901 §3.4: the unit is translated before its count is put in', () => {
    deepStrictEqual(
      elapsedPhraseOf(2 * HOUR, template =>
        template === '{0} hours' ? 'il y a {0} heures' : template,
      ),
      'il y a 2 heures',
    );
  });

  it('F-0904 BR-4: a time in the future counted, not clamped, reads as its negative number of seconds, whatever its size, and the table is the same for the past', () => {
    const same = (milliseconds: number): string =>
      elapsedPhraseOf(milliseconds, template => template, 'counted');
    deepStrictEqual(
      [
        same(-1 * SECOND),
        same(-7199 * SECOND),
        same(-400),
        same(0),
        same(29 * SECOND),
        same(30 * SECOND),
        same(183 * ONE_DAY),
        elapsedPhraseOf(-5 * SECOND, template => template, 'clamped'),
      ],
      [
        '-1 seconds',
        '-7199 seconds',
        '0 seconds',
        '0 seconds',
        '29 seconds',
        '1 minute',
        '1 year',
        '0 seconds',
      ],
    );
  });

  it('F-0904 BR-4: the phrase with ago puts "ago" after it, and takes the future reading it is given', () => {
    deepStrictEqual(
      [
        agoPhraseOf(2 * HOUR, template => template),
        agoPhraseOf(-3 * SECOND, template => template, 'counted'),
        agoPhraseOf(-3 * SECOND, template => template),
      ],
      ['2 hours ago', '-3 seconds ago', '0 seconds ago'],
    );
  });
});
