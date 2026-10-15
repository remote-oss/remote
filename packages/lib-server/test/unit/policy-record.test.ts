import {deepStrictEqual} from 'node:assert';
import {
  CONTAINERS_POLICY,
  SSH_POLICY,
  validatePolicyRecord,
  wslPolicy,
} from '../../src/index.ts';

// The complete SSH record with the given fields replaced.
function recordWith(mutations: Record<string, unknown>): unknown {
  return {...SSH_POLICY, ...mutations};
}

// The complete SSH record as a plain object without the named field.
function recordWithout(field: string): unknown {
  const copy = JSON.parse(JSON.stringify(SSH_POLICY)) as Record<
    string,
    unknown
  >;
  if (field === 'cache') {
    delete copy.cache;
  }
  return copy;
}

describe('policy record (card server-01 table)', () => {
  it('validatePolicyRecord(SSH_POLICY) -> {record} deep-equal to the input', () => {
    deepStrictEqual(validatePolicyRecord(SSH_POLICY), {record: SSH_POLICY});
  });

  it('validatePolicyRecord(CONTAINERS_POLICY) -> {record} deep-equal to the input', () => {
    deepStrictEqual(validatePolicyRecord(CONTAINERS_POLICY), {
      record: CONTAINERS_POLICY,
    });
  });

  it('validatePolicyRecord(wslPolicy({scriptLessStartup: false, environmentSetupPath: undefined})) -> {record}', () => {
    const record = wslPolicy({
      scriptLessStartup: false,
      environmentSetupPath: undefined,
    });
    deepStrictEqual(validatePolicyRecord(record), {record});
  });

  it('validatePolicyRecord(wslPolicy({scriptLessStartup: true, environmentSetupPath: path})) -> {record}', () => {
    const record = wslPolicy({
      scriptLessStartup: true,
      environmentSetupPath: '/home/u/.vscode-server/server-env-setup',
    });
    deepStrictEqual(validatePolicyRecord(record), {record});
  });

  it('validatePolicyRecord(null) -> one problem at path "" problem "not an object"', () => {
    deepStrictEqual(validatePolicyRecord(null), {
      problems: [{path: '', problem: 'not an object'}],
    });
  });

  it('validatePolicyRecord(42) -> one problem at path "" problem "not an object"', () => {
    deepStrictEqual(validatePolicyRecord(42), {
      problems: [{path: '', problem: 'not an object'}],
    });
  });

  it('validatePolicyRecord("x") -> one problem at path "" problem "not an object"', () => {
    deepStrictEqual(validatePolicyRecord('x'), {
      problems: [{path: '', problem: 'not an object'}],
    });
  });

  it('record with extra: 1 -> problem path extra, "unknown field"', () => {
    deepStrictEqual(validatePolicyRecord(recordWith({extra: 1})), {
      problems: [{path: 'extra', problem: 'unknown field'}],
    });
  });

  it('record missing cache -> problem path cache, "missing"', () => {
    deepStrictEqual(validatePolicyRecord(recordWithout('cache')), {
      problems: [{path: 'cache', problem: 'missing'}],
    });
  });

  it('downloadPlacement {kind: hostFirst} (no mode) -> problem path downloadPlacement.mode', () => {
    deepStrictEqual(
      validatePolicyRecord(
        recordWith({downloadPlacement: {kind: 'hostFirst'}}),
      ),
      {problems: [{path: 'downloadPlacement.mode', problem: 'invalid value'}]},
    );
  });

  it('downloadPlacement {kind: elsewhere} -> problem path downloadPlacement.kind', () => {
    deepStrictEqual(
      validatePolicyRecord(
        recordWith({downloadPlacement: {kind: 'elsewhere'}}),
      ),
      {problems: [{path: 'downloadPlacement.kind', problem: 'invalid value'}]},
    );
  });

  it('verification: [] -> problem path verification, "empty"', () => {
    deepStrictEqual(validatePolicyRecord(recordWith({verification: []})), {
      problems: [{path: 'verification', problem: 'empty'}],
    });
  });

  it('verification: ["none", "none"] -> problem path verification[1], "duplicate"', () => {
    deepStrictEqual(
      validatePolicyRecord(recordWith({verification: ['none', 'none']})),
      {
        problems: [{path: 'verification[1]', problem: 'duplicate'}],
      },
    );
  });

  it('verification: ["sha1"] -> problem path verification[0]', () => {
    deepStrictEqual(
      validatePolicyRecord(recordWith({verification: ['sha1']})),
      {
        problems: [{path: 'verification[0]', problem: 'invalid value'}],
      },
    );
  });

  it('cleanup {kind: keepNewest, count: 0} -> problem path cleanup.count', () => {
    deepStrictEqual(
      validatePolicyRecord(
        recordWith({cleanup: {kind: 'keepNewest', count: 0}}),
      ),
      {
        problems: [
          {path: 'cleanup.count', problem: 'must be a positive integer'},
        ],
      },
    );
  });

  it('cleanup {kind: keepNewest, count: 1.5} -> problem path cleanup.count', () => {
    deepStrictEqual(
      validatePolicyRecord(
        recordWith({cleanup: {kind: 'keepNewest', count: 1.5}}),
      ),
      {
        problems: [
          {path: 'cleanup.count', problem: 'must be a positive integer'},
        ],
      },
    );
  });

  it('environmentSetup: "" -> problem path environmentSetup', () => {
    deepStrictEqual(validatePolicyRecord(recordWith({environmentSetup: ''})), {
      problems: [{path: 'environmentSetup', problem: 'empty'}],
    });
  });

  it('allowedExtraStartOptions: ["other"] -> problem path allowedExtraStartOptions[0]', () => {
    deepStrictEqual(
      validatePolicyRecord(recordWith({allowedExtraStartOptions: ['other']})),
      {
        problems: [
          {path: 'allowedExtraStartOptions[0]', problem: 'invalid value'},
        ],
      },
    );
  });

  it('extensionEntries: "other" -> problem path extensionEntries', () => {
    deepStrictEqual(
      validatePolicyRecord(recordWith({extensionEntries: 'other'})),
      {
        problems: [{path: 'extensionEntries', problem: 'invalid value'}],
      },
    );
  });

  it('extensionEntries: asWritten -> {record}', () => {
    const candidate = recordWith({extensionEntries: 'asWritten'});
    deepStrictEqual(validatePolicyRecord(candidate), {record: candidate});
  });

  it('installUmask: "077" -> problem path installUmask', () => {
    deepStrictEqual(validatePolicyRecord(recordWith({installUmask: '077'})), {
      problems: [{path: 'installUmask', problem: 'invalid value'}],
    });
  });

  it('installUmask: 022 -> {record}', () => {
    const candidate = recordWith({installUmask: '022'});
    deepStrictEqual(validatePolicyRecord(candidate), {record: candidate});
  });

  it('prefetch onProductUpdate feedCheckIntervalMilliseconds 0 -> problem path prefetch.feedCheckIntervalMilliseconds', () => {
    deepStrictEqual(
      validatePolicyRecord(
        recordWith({
          prefetch: {
            kind: 'onProductUpdate',
            settingKey: 'k',
            feedCheckIntervalMilliseconds: 0,
            platformWindowDays: 14,
            licence: 'skipUnaccepted',
          },
        }),
      ),
      {
        problems: [
          {
            path: 'prefetch.feedCheckIntervalMilliseconds',
            problem: 'must be a positive integer',
          },
        ],
      },
    );
  });

  it('F-6301 BR-13: prefetch onProductUpdate platformWindowDays 0 -> problem path prefetch.platformWindowDays (rule, no table row)', () => {
    deepStrictEqual(
      validatePolicyRecord(
        recordWith({
          prefetch: {
            kind: 'onProductUpdate',
            settingKey: 'k',
            feedCheckIntervalMilliseconds: 3600000,
            platformWindowDays: 0,
            licence: 'skipUnaccepted',
          },
        }),
      ),
      {
        problems: [
          {
            path: 'prefetch.platformWindowDays',
            problem: 'must be a positive integer',
          },
        ],
      },
    );
  });

  it('prefetch onProductUpdate licence "ask" -> problem path prefetch.licence', () => {
    deepStrictEqual(
      validatePolicyRecord(
        recordWith({
          prefetch: {
            kind: 'onProductUpdate',
            settingKey: 'k',
            feedCheckIntervalMilliseconds: 3600000,
            platformWindowDays: 14,
            licence: 'ask',
          },
        }),
      ),
      {problems: [{path: 'prefetch.licence', problem: 'invalid value'}]},
    );
  });

  it('a record with three problems at once (unknown field, empty verification, count 0) -> exactly three problems, in field order', () => {
    deepStrictEqual(
      validatePolicyRecord(
        recordWith({
          extra: 1,
          verification: [],
          cleanup: {kind: 'keepNewest', count: 0},
        }),
      ),
      {
        problems: [
          {path: 'extra', problem: 'unknown field'},
          {path: 'verification', problem: 'empty'},
          {path: 'cleanup.count', problem: 'must be a positive integer'},
        ],
      },
    );
  });

  for (const [options, problems] of [
    [['useHostProxy'], []],
    [['fileWatcherPolling', 'useHostProxy'], []],
    [
      ['other'],
      [{path: 'allowedExtraStartOptions[0]', problem: 'invalid value'}],
    ],
  ] as const) {
    it(`F-0503 BR-18: allowedExtraStartOptions ${JSON.stringify(options)} is judged by the allow-list`, () => {
      const result = validatePolicyRecord(
        recordWith({allowedExtraStartOptions: options}),
      );
      deepStrictEqual('problems' in result ? result.problems : [], problems);
    });
  }
});
