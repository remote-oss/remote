import {deepStrictEqual} from 'node:assert';
import {CONTAINERS_POLICY, SSH_POLICY, wslPolicy} from '../../src/index.ts';

describe('policy rows (card server-01 table)', () => {
  it('wslPolicy({scriptLessStartup: true}) -> installMode stepwise, cleanup {kind: onlyCurrentRemoveLeftovers}', () => {
    const record = wslPolicy({
      scriptLessStartup: true,
      environmentSetupPath: undefined,
    });
    deepStrictEqual(
      [record.installMode, record.cleanup],
      ['stepwise', {kind: 'onlyCurrentRemoveLeftovers'}],
    );
  });

  it('wslPolicy({scriptLessStartup: false}) -> installMode singleScript, cleanup {kind: onlyCurrentKeepLeftovers}', () => {
    const record = wslPolicy({
      scriptLessStartup: false,
      environmentSetupPath: undefined,
    });
    deepStrictEqual(
      [record.installMode, record.cleanup],
      ['singleScript', {kind: 'onlyCurrentKeepLeftovers'}],
    );
  });

  it('wslPolicy(...) prefetch -> onProductUpdate with the WSL background-download values', () => {
    const record = wslPolicy({
      scriptLessStartup: false,
      environmentSetupPath: undefined,
    });
    deepStrictEqual(record.prefetch, {
      kind: 'onProductUpdate',
      settingKey: 'remote.WSL.downloadInBackground',
      feedCheckIntervalMilliseconds: 3600000,
      platformWindowDays: 14,
      licence: 'skipUnaccepted',
    });
  });

  it('SSH_POLICY.cleanup -> {kind: keepNewest, count: 5}', () => {
    deepStrictEqual(SSH_POLICY.cleanup, {kind: 'keepNewest', count: 5});
  });

  it('Object.isFrozen(SSH_POLICY) and of its nested objects -> true', () => {
    deepStrictEqual(
      [
        Object.isFrozen(SSH_POLICY),
        Object.isFrozen(SSH_POLICY.downloadPlacement),
        Object.isFrozen(SSH_POLICY.verification),
        Object.isFrozen(SSH_POLICY.allowedExtraStartOptions),
        Object.isFrozen(SSH_POLICY.cleanup),
        Object.isFrozen(SSH_POLICY.prefetch),
        Object.isFrozen(CONTAINERS_POLICY),
        Object.isFrozen(CONTAINERS_POLICY.verification),
      ],
      [true, true, true, true, true, true, true, true],
    );
  });
});
