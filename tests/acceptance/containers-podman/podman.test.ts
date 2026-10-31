import {strictEqual} from 'node:assert';
import {engineCli} from '../windows/harness.ts';

describe('the launch of release 1 on Podman (card containers-101)', () => {
  it('the launch’s engine CLI is podman', () => {
    strictEqual(engineCli(), 'podman');
  });
});
