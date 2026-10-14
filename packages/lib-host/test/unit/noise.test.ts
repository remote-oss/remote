import {deepStrictEqual} from 'node:assert';
import {NOISE_LINES, withNoise} from '../../src/testing/noise.ts';

describe('the noise of ADR-0010', () => {
  it('ADR-0010: the noise is N1 to N4, then the same lines ending in a carriage return', () => {
    deepStrictEqual(
      [
        NOISE_LINES.length,
        NOISE_LINES.slice(5).every(line => line.endsWith('\r')),
      ],
      [10, true],
    );
  });

  it('ADR-0010: withNoise puts the noise before, between and after the lines', () => {
    deepStrictEqual(withNoise(['a', 'b']), [
      ...NOISE_LINES,
      'a',
      ...NOISE_LINES,
      'b',
      ...NOISE_LINES,
    ]);
  });
});
