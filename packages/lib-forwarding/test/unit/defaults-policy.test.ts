import {deepStrictEqual} from 'node:assert';
import {shouldApplyDefaults} from '../../src/index.ts';

describe('shouldApplyDefaults (card forwarding-06)', () => {
  it('F-2507.BR-4: applies on a connection of its own: a first, a retry or a reload', () => {
    deepStrictEqual(shouldApplyDefaults(false), true);
  });

  it('F-2507.BR-5: does not apply on any attempt of a reconnection', () => {
    deepStrictEqual(shouldApplyDefaults(true), false);
  });
});
