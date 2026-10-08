import {deepStrictEqual, ok} from 'node:assert';
import {LEVEL_ORDER} from '../../src/index.ts';

describe('levels (card log-01 table)', () => {
  it('LEVEL_ORDER -> equals [trace, debug, info, warn, error]', () => {
    deepStrictEqual(
      [...LEVEL_ORDER],
      ['trace', 'debug', 'info', 'warn', 'error'],
    );
  });

  it('LEVEL_ORDER -> frozen', () => {
    ok(Object.isFrozen(LEVEL_ORDER));
  });
});
