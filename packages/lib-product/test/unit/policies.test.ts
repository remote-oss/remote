import {strictEqual} from 'node:assert';
import {OVERRIDE_POLICIES} from '../../src/index.ts';

describe('override policies', () => {
  it('has no remote-wsl policy until its rules are decided', () => {
    strictEqual(OVERRIDE_POLICIES['remote-wsl'], undefined);
  });
});
