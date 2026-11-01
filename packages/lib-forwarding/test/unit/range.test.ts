import {deepStrictEqual} from 'node:assert';
import {parseRange} from '../../src/index.ts';

describe('parseRange (card forwarding-01 table)', () => {
  it("parseRange('40000-40010') -> {first:40000, last:40010}", () => {
    deepStrictEqual(parseRange('40000-40010'), {
      range: {first: 40000, last: 40010},
    });
  });

  it("F-2104 AC-18: parseRange(' 1 - 65535 ') -> none badFormat", () => {
    deepStrictEqual(parseRange(' 1 - 65535 '), {
      none: true,
      reason: 'badFormat',
    });
  });

  it("parseRange('40010-40000') -> none reversed", () => {
    deepStrictEqual(parseRange('40010-40000'), {
      none: true,
      reason: 'reversed',
    });
  });

  it("parseRange('0-10'), parseRange('1-70000') -> none outOfBounds", () => {
    deepStrictEqual(
      [parseRange('0-10'), parseRange('1-70000')],
      [
        {none: true, reason: 'outOfBounds'},
        {none: true, reason: 'outOfBounds'},
      ],
    );
  });

  it("parseRange('abc'), parseRange('1-2-3'), parseRange('10') -> none badFormat", () => {
    deepStrictEqual(
      [parseRange('abc'), parseRange('1-2-3'), parseRange('10')],
      [
        {none: true, reason: 'badFormat'},
        {none: true, reason: 'badFormat'},
        {none: true, reason: 'badFormat'},
      ],
    );
  });

  it('F-2104 AC-18: the range is exactly "A-B", as the setting’s pattern: spaces around or inside are badFormat, a string of spaces is badFormat, the empty string is empty, and the plain range is the range', () => {
    deepStrictEqual(
      [
        parseRange(' 41080-41081 '),
        parseRange('41080 - 41081'),
        parseRange('   '),
        parseRange(''),
        parseRange('41080-41081'),
      ],
      [
        {none: true, reason: 'badFormat'},
        {none: true, reason: 'badFormat'},
        {none: true, reason: 'badFormat'},
        {none: true, reason: 'empty'},
        {range: {first: 41080, last: 41081}},
      ],
    );
  });

  it('parseRange(42), parseRange(undefined), parseRange(null) -> none notAString', () => {
    deepStrictEqual(
      [parseRange(42), parseRange(undefined), parseRange(null)],
      [
        {none: true, reason: 'notAString'},
        {none: true, reason: 'notAString'},
        {none: true, reason: 'notAString'},
      ],
    );
  });
});
