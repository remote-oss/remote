import {deepStrictEqual} from 'node:assert';
import {shouldApplyDefaults} from '../../src/index.ts';

describe('shouldApplyDefaults (card forwarding-02 table)', () => {
  it('F-2507.BR-4: applies on the first connection', () => {
    deepStrictEqual(shouldApplyDefaults(1, false), true);
  });

  it('F-2507.6.1: applies on a connection after a reload, the same call', () => {
    deepStrictEqual(shouldApplyDefaults(1, false), true);
  });

  for (const attempt of [2, 3]) {
    it(`F-2507.6.5: does not apply on reconnection attempt ${String(attempt)}`, () => {
      deepStrictEqual(shouldApplyDefaults(attempt, true), false);
    });
  }

  it('F-2507.BR-5: does not apply on the first attempt of a reconnection', () => {
    deepStrictEqual(shouldApplyDefaults(1, true), false);
  });

  for (const attempt of [2, 3]) {
    it(`F-2507.BR-5 (provisional): applies on retry ${String(attempt)} of a connection`, () => {
      deepStrictEqual(shouldApplyDefaults(attempt, false), true);
    });
  }

  for (const attempt of [1, 2, 3, 4, 5]) {
    it(`F-2507.AC-33: does not apply on reconnection attempt ${String(attempt)} of five`, () => {
      deepStrictEqual(shouldApplyDefaults(attempt, true), false);
    });
  }
});
