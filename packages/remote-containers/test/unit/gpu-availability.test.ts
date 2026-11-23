import {deepStrictEqual} from 'node:assert';
import {gpuAvailabilityOf} from '../../src/connect/gpu-availability.ts';

describe('the GPU availability setting (card containers-202, F-0206)', () => {
  it('F-0206 BR-5, BR-16: a string goes as written, for the CLI to refuse one it does not know, and anything else is detect', () => {
    deepStrictEqual(
      ['all', 'none', 'sometimes', undefined, null, true, {}].map(
        gpuAvailabilityOf,
      ),
      ['all', 'none', 'sometimes', 'detect', 'detect', 'detect', 'detect'],
    );
  });
});
