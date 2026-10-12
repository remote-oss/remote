import {deepStrictEqual} from 'node:assert';
import {
  type FailedKind,
  type FailureContext,
  failedWith,
  KIND_MAY_RECOVER,
  ofAcquire,
  ofChannel,
  ofConnection,
  ofPlan,
  ofProbe,
  ofStart,
  ofTransfer,
  reconnectionLimitReached,
} from '../../src/pipeline/failure.ts';

const RECONNECTION: FailureContext = {
  attempt: 3,
  isReconnection: true,
  maximumReconnectionAttempts: null,
  userAlreadyNotified: false,
  hints: [],
  diagnostics: [],
};

/** The kinds that may recover during a reconnection, and the ones that cannot, as the architect ruled. */
const RECOVER: ReadonlyArray<readonly [FailedKind, boolean]> = [
  ['unreachable', true],
  ['timeout', true],
  ['authentication', false],
  ['hostKeyChanged', false],
  ['hostKeyRejected', false],
  ['forwardingDisabled', true],
  ['channelClosed', true],
  ['brokenPipe', true],
  ['unknown', true],
  ['unsupportedPlatform', false],
  ['prerequisiteMissing', false],
  ['noServerSource', false],
  ['invalidServerTemplate', false],
  ['licenceDeclined', false],
  ['serverDownload', true],
  ['serverInstall', true],
  ['serverStart', true],
  ['invalidSetting', false],
  ['preconnectFailed', false],
  ['lockTimeout', false],
  ['retriesExhausted', false],
  ['cancelled', false],
];

describe('which kinds may recover during a reconnection', () => {
  for (const [kind, expected] of RECOVER) {
    it(`${kind} -> ${expected ? 'a reconnection is retryable' : 'a reconnection is not retryable'}`, () => {
      deepStrictEqual(failedWith({kind}, RECONNECTION).retryable, expected);
    });
  }

  it('the table has a row for every kind the tests list', () => {
    deepStrictEqual(
      Object.keys(KIND_MAY_RECOVER).sort(),
      RECOVER.map(([kind]) => kind).sort(),
    );
  });
});

describe('the failure the window gets', () => {
  it('an initial connect is never retryable, whatever the kind', () => {
    deepStrictEqual(
      failedWith(
        {kind: 'unreachable'},
        {...RECONNECTION, attempt: 1, isReconnection: false},
      ).retryable,
      false,
    );
  });

  it('carries the reason, the notice flag, the hints and the diagnostics it was given', () => {
    deepStrictEqual(
      failedWith(
        {kind: 'timeout', reason: {text: 'No route to host'}},
        {
          ...RECONNECTION,
          userAlreadyNotified: true,
          hints: [],
          diagnostics: ['a line'],
        },
      ),
      {
        kind: 'timeout',
        reason: {text: 'No route to host'},
        retryable: true,
        silent: false,
        userAlreadyNotified: true,
        hints: [],
        diagnostics: ['a line'],
      },
    );
  });

  it('has no reason key when the failure gives none', () => {
    deepStrictEqual(Object.keys(failedWith({kind: 'timeout'}, RECONNECTION)), [
      'kind',
      'retryable',
      'silent',
      'userAlreadyNotified',
      'hints',
      'diagnostics',
    ]);
  });
});

describe('the reconnection limit', () => {
  const ROWS: ReadonlyArray<readonly [number, unknown, boolean]> = [
    [1, 0, false],
    [2, 0, true],
    [2, 1, true],
    [3, 2, true],
    [3, 3, false],
    [9, 8, true],
    [8, 8, false],
    [5, null, false],
    [5, undefined, false],
    [5, 'abc', false],
    [2, -3, true],
    [5, 20, false],
  ];

  for (const [attempt, setting, expected] of ROWS) {
    it(`attempt ${String(attempt)} with a limit of ${String(setting)} -> ${expected ? 'stopped' : 'goes on'}`, () => {
      deepStrictEqual(reconnectionLimitReached(attempt, setting), expected);
    });
  }

  it('a failure at the limit is not retryable, however temporary its kind', () => {
    deepStrictEqual(
      failedWith(
        {kind: 'timeout'},
        {...RECONNECTION, attempt: 3, maximumReconnectionAttempts: 2},
      ).retryable,
      false,
    );
  });
});

describe('the reading of each library failure', () => {
  it('a host channel: closed, timeout, cancel, copy tool missing, copy failed, spawn failed', () => {
    deepStrictEqual(
      [
        ofChannel({kind: 'channelClosed', detail: 'gone'}),
        ofChannel({kind: 'timeout', detail: 'slow'}),
        ofChannel({kind: 'cancelled', detail: 'stopped'}),
        ofChannel({kind: 'copyToolMissing', detail: 'no scp'}),
        ofChannel({kind: 'copyFailed', detail: 'denied'}),
        ofChannel({kind: 'spawnFailed', detail: ''}),
      ],
      [
        {kind: 'channelClosed', reason: {text: 'gone'}},
        {kind: 'timeout', reason: {text: 'slow'}},
        {kind: 'cancelled'},
        {kind: 'prerequisiteMissing', reason: {text: 'no scp'}},
        {kind: 'serverInstall', reason: {text: 'denied'}},
        {kind: 'unknown'},
      ],
    );
  });

  it('a probe: platform, architecture, missing tools, script status, unreadable facts, no block, channel', () => {
    deepStrictEqual(
      [
        ofProbe({kind: 'unsupportedPlatform', reported: 'FreeBSD'}),
        ofProbe({kind: 'unsupportedArch', reported: 'sparc'}),
        ofProbe({kind: 'prerequisiteMissing', missing: ['tar', 'gzip']}),
        ofProbe({kind: 'probeFailed', status: 'NoBash'}),
        ofProbe({kind: 'probeFailed', status: 'SomethingNew'}),
        ofProbe({kind: 'unreadableFacts', field: 'os'}),
        ofProbe({kind: 'noResultBlock'}),
        ofProbe({
          kind: 'channelFailed',
          failure: {kind: 'timeout', detail: ''},
        }),
      ],
      [
        {kind: 'unsupportedPlatform', reason: {text: 'FreeBSD'}},
        {kind: 'unsupportedPlatform', reason: {text: 'sparc'}},
        {kind: 'prerequisiteMissing', reason: {text: 'tar, gzip'}},
        {kind: 'prerequisiteMissing'},
        {kind: 'unknown'},
        {kind: 'unknown'},
        {kind: 'channelClosed'},
        {kind: 'timeout'},
      ],
    );
  });

  it('a plan: no source, a template that does not work, an install path that does not work', () => {
    deepStrictEqual(
      [
        ofPlan({kind: 'noSource'}),
        ofPlan({kind: 'invalidOverride', problem: 'no ${commit}'}),
        ofPlan({kind: 'invalidInstallPath', reason: 'relative'}),
      ],
      [
        {kind: 'noServerSource'},
        {kind: 'invalidServerTemplate', reason: {text: 'no ${commit}'}},
        {kind: 'invalidSetting', reason: {text: 'relative'}},
      ],
    );
  });

  it('a transfer: download, local download, unpack, copy, cancel, retries, script status, no block, channel', () => {
    deepStrictEqual(
      [
        ofTransfer({kind: 'serverDownload', cause: 'downloadFailed'}),
        ofTransfer({kind: 'localDownload', detail: '404'}),
        ofTransfer({kind: 'downloadTimeout', reason: 'stalled'}),
        ofTransfer({kind: 'verification', mismatch: 'checksum'}),
        ofTransfer({kind: 'unpack'}),
        ofTransfer({
          kind: 'copy',
          failure: {kind: 'copyFailed', detail: 'full'},
        }),
        ofTransfer({kind: 'cancelled'}),
        ofTransfer({kind: 'retriesExhausted'}),
        ofTransfer({kind: 'scriptFailed', status: 'UnpackFailed'}),
        ofTransfer({kind: 'noResultBlock'}),
        ofTransfer({
          kind: 'channelFailed',
          failure: {kind: 'channelClosed', detail: ''},
        }),
      ],
      [
        {kind: 'serverDownload', reason: {text: 'downloadFailed'}},
        {kind: 'serverDownload', reason: {text: '404'}},
        {kind: 'serverDownload', reason: {text: 'stalled'}},
        {kind: 'serverDownload', reason: {text: 'checksum'}},
        {kind: 'serverInstall'},
        {kind: 'serverInstall', reason: {text: 'full'}},
        {kind: 'cancelled'},
        {kind: 'retriesExhausted'},
        {kind: 'serverInstall'},
        {kind: 'channelClosed'},
        {kind: 'channelClosed'},
      ],
    );
  });

  it('a start: port range, server, facts, prerequisites, retries, script status, no block, channel', () => {
    deepStrictEqual(
      [
        ofStart({kind: 'invalidPortRange'}),
        ofStart({kind: 'serverStart'}),
        ofStart({kind: 'unreadableServerFacts'}),
        ofStart({kind: 'prerequisitesMissing'}),
        ofStart({kind: 'retriesExhausted'}),
        ofStart({kind: 'scriptFailed', status: 'LockBusy'}),
        ofStart({kind: 'noResultBlock'}),
        ofStart({
          kind: 'channelFailed',
          failure: {kind: 'cancelled', detail: ''},
        }),
      ],
      [
        {kind: 'invalidSetting'},
        {kind: 'serverStart'},
        {kind: 'serverStart'},
        {kind: 'prerequisiteMissing'},
        {kind: 'retriesExhausted'},
        {kind: 'retriesExhausted'},
        {kind: 'channelClosed'},
        {kind: 'cancelled'},
      ],
    );
  });

  it('#253 Q10: a lease on the helper: cancelled, unreachable endpoint, helper that did not start', () => {
    deepStrictEqual(
      [
        ofAcquire('cancelled'),
        ofAcquire('endpointUnreachable'),
        ofAcquire('spawnFailed'),
      ],
      [{kind: 'cancelled'}, {kind: 'unknown'}, {kind: 'unknown'}],
    );
  });

  it('a shared connection: login failure with hints, ssh missing, ssh not started, helper trouble, timeout, cancel', () => {
    deepStrictEqual(
      [
        ofConnection({
          kind: 'loginFailed',
          failure: 'authentication',
          reason: {text: 'denied'},
          hints: [],
        }),
        ofConnection({
          kind: 'loginFailed',
          failure: 'unreachable',
          hints: [],
        }),
        ofConnection({
          kind: 'spawnFailed',
          cause: 'clientVanished',
          detail: 'ssh is gone',
        }),
        ofConnection({
          kind: 'spawnFailed',
          cause: 'spawnFailed',
          detail: 'EAGAIN',
        }),
        ofConnection({kind: 'helperRefused', reason: 'unreadable reply'}),
        ofConnection({kind: 'transportLost'}),
        ofConnection({kind: 'helperGone'}),
        ofConnection({kind: 'timeout'}),
        ofConnection({kind: 'cancelled'}),
      ],
      [
        {kind: 'authentication', reason: {text: 'denied'}, hints: []},
        {kind: 'unreachable', hints: []},
        {kind: 'prerequisiteMissing', reason: {text: 'ssh is gone'}},
        {kind: 'unknown', reason: {text: 'EAGAIN'}},
        {kind: 'unknown', reason: {text: 'unreadable reply'}},
        {kind: 'channelClosed'},
        {kind: 'channelClosed'},
        {kind: 'timeout'},
        {kind: 'cancelled'},
      ],
    );
  });
});
