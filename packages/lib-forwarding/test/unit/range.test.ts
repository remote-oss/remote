import {deepStrictEqual} from 'node:assert';
import {parseRange} from '../../src/index.ts';

describe('parseRange (card forwarding-01 table)', () => {
  it("parseRange('40000-40010') -> {first:40000, last:40010}", () => {
    deepStrictEqual(parseRange('40000-40010'), {
      range: {first: 40000, last: 40010},
    });
  });

  it("parseRange(' 1 - 65535 ') -> {first:1, last:65535}", () => {
    deepStrictEqual(parseRange(' 1 - 65535 '), {
      range: {first: 1, last: 65535},
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

  it("parseRange(''), parseRange('   ') -> none empty", () => {
    deepStrictEqual(
      [parseRange(''), parseRange('   ')],
      [
        {none: true, reason: 'empty'},
        {none: true, reason: 'empty'},
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
