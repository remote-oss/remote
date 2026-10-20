import {deepStrictEqual} from 'node:assert';
import {
  CONTAINERS_POLICY,
  SSH_POLICY,
  sshPolicyFor,
  wslPolicy,
} from '../../src/index.ts';

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

  it('transport contracts 5.0: the SSH and WSL policies take identifiers only, and the SSH policy of a mode too', () => {
    deepStrictEqual(
      [
        SSH_POLICY.extensionEntries,
        sshPolicyFor('off').extensionEntries,
        wslPolicy({scriptLessStartup: false, environmentSetupPath: undefined})
          .extensionEntries,
      ],
      ['identifiersOnly', 'identifiersOnly', 'identifiersOnly'],
    );
  });

  it('F-2401 (ruling-253-helper): the SSH policy checks the requirements with the bundled helper, a mode of it too, and the WSL policy adds the Alpine probe', () => {
    deepStrictEqual(
      [
        SSH_POLICY.requirementsCheck,
        sshPolicyFor('off').requirementsCheck,
        wslPolicy({scriptLessStartup: false, environmentSetupPath: undefined})
          .requirementsCheck,
      ],
      ['bundledHelper', 'bundledHelper', 'bundledHelperPlusAlpineProbe'],
    );
  });

  it('transport contracts 5.0: the SSH and WSL policies keep the umask they are given, and the SSH policy of a mode too', () => {
    deepStrictEqual(
      [
        SSH_POLICY.installUmask,
        sshPolicyFor('off').installUmask,
        wslPolicy({scriptLessStartup: false, environmentSetupPath: undefined})
          .installUmask,
      ],
      ['inherit', 'inherit', 'inherit'],
    );
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

describe('the SSH policy of a download mode (card connect-38)', () => {
  it('F-2405.AC-3: each mode gives hostFirst with that mode and the SSH policy otherwise', () => {
    deepStrictEqual(
      (['auto', 'always', 'off'] as const).map(mode => sshPolicyFor(mode)),
      (['auto', 'always', 'off'] as const).map(mode => ({
        ...SSH_POLICY,
        downloadPlacement: {kind: 'hostFirst', mode},
      })),
    );
  });

  it('F-2405 BR-1: the record of a mode is frozen like the shipped rows', () => {
    const record = sshPolicyFor('off');
    deepStrictEqual(
      [Object.isFrozen(record), Object.isFrozen(record.downloadPlacement)],
      [true, true],
    );
  });

  for (const [cell, expected] of [
    ['downloadPlacement', {kind: 'clientOnly'}],
    ['cache', 'kept'],
    ['verification', ['none']],
    ['environmentSetup', undefined],
    ['requirementsCheck', 'bundledHelper'],
    ['allowedExtraStartOptions', ['useHostProxy', 'forceDisableUserEnv']],
    ['extensionEntries', 'asWritten'],
    ['installUmask', '022'],
    ['cleanup', {kind: 'onlyCurrentKeepLeftovers'}],
    ['installMode', 'singleScript'],
    ['prefetch', {kind: 'none'}],
  ] as const) {
    it(`transport contracts 5.0: the containers policy cell ${cell} is ${JSON.stringify(expected)}`, () => {
      deepStrictEqual(CONTAINERS_POLICY[cell], expected);
    });
  }
});
