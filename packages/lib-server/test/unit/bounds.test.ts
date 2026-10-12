import {deepStrictEqual} from 'node:assert';
import {CLIENT_DOWNLOAD_BOUNDS} from '../../src/index.ts';

describe('the client download bounds', () => {
  it('ruled on #253 Q7: a minute without bytes, half an hour in all, a gibibyte without a length', () => {
    deepStrictEqual(CLIENT_DOWNLOAD_BOUNDS, {
      deadlineMilliseconds: 1800000,
      stallMilliseconds: 60000,
      maximumBytes: 1073741824,
    });
  });
});
