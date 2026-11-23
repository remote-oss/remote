import {deepStrictEqual} from 'node:assert';
import {externalSourcesApply} from '../../src/config/external-sources.ts';

describe('when the sources outside a folder are consulted (card containers-161, F-0302 BR-12)', () => {
  it('F-0302 BR-12: a window of no folder or one folder consults them, a window of several folders does not', () => {
    deepStrictEqual([0, 1, 2, 3].map(externalSourcesApply), [
      true,
      true,
      false,
      false,
    ]);
  });
});
