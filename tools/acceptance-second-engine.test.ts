import {deepStrictEqual} from 'node:assert';
import {SECOND_ENGINE_IMAGE} from './acceptance-second-engine.ts';

describe('the second engine of the rows', () => {
  it('pins the image by tag and by the digest of its index', () => {
    deepStrictEqual(
      /^docker:29-dind@sha256:[0-9a-f]{64}$/.test(SECOND_ENGINE_IMAGE),
      true,
    );
  });
});
