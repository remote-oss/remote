import {deepStrictEqual} from 'node:assert';
import {filled} from '../../src/surfaces/filled.ts';

describe('a filled template (card containers-08)', () => {
  it('contracts §1.2: the template is translated, then its places take the values', () => {
    deepStrictEqual(
      filled(template => `[${template}]`, 'a {0} b {1}', ['x', 'y']),
      '[a x b y]',
    );
  });

  it('contracts §1.2: a place with no value stays, and no values is allowed', () => {
    deepStrictEqual(
      [
        filled(template => template, '{0} {1}', ['x']),
        filled(template => template, 'plain'),
      ],
      ['x {1}', 'plain'],
    );
  });
});
