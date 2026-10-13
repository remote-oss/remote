import {deepStrictEqual} from 'node:assert';
import {
  type FailedKind,
  type FailureDetail,
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

const EXEC_SERVER = {useExecServer: true};

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

/** Every case of every mapper, to sweep for a reason that carries library text. */
const EVERY_CASE: ReadonlyArray<readonly [string, FailureDetail]> = [
  ['channel closed', ofChannel({kind: 'channelClosed', detail: 'gone'})],
  ['channel timeout', ofChannel({kind: 'timeout', detail: 'slow'})],
  ['channel cancelled', ofChannel({kind: 'cancelled', detail: 'stopped'})],
  ['copy tool missing', ofChannel({kind: 'copyToolMissing', detail: 'no scp'})],
  ['copy failed', ofChannel({kind: 'copyFailed', detail: 'denied'})],
  ['channel spawn failed', ofChannel({kind: 'spawnFailed', detail: 'EAGAIN'})],
  ['platform', ofProbe({kind: 'unsupportedPlatform', reported: 'FreeBSD'})],
  ['architecture', ofProbe({kind: 'unsupportedArch', reported: 'sparc'})],
  ['tools', ofProbe({kind: 'prerequisiteMissing', missing: ['tar', 'gzip']})],
  ['probe status', ofProbe({kind: 'probeFailed', status: 'NoBash'})],
  ['probe new status', ofProbe({kind: 'probeFailed', status: 'SomethingNew'})],
  ['unreadable facts', ofProbe({kind: 'unreadableFacts', field: 'os'})],
  ['probe no block', ofProbe({kind: 'noResultBlock'})],
  [
    'probe channel',
    ofProbe({kind: 'channelFailed', failure: {kind: 'timeout', detail: 'x'}}),
  ],
  ['no source', ofPlan({kind: 'noSource'})],
  [
    'placeholder',
    ofPlan({
      kind: 'invalidOverride',
      problem: {kind: 'unknownPlaceholder', name: 'foo'},
    }),
  ],
  [
    'not http',
    ofPlan({
      kind: 'invalidOverride',
      problem: {kind: 'notHttpUrl', value: 'ftp://h/x'},
    }),
  ],
  [
    'unsupported template',
    ofPlan({
      kind: 'invalidOverride',
      problem: {
        kind: 'unsupportedPlatform',
        operatingSystem: 'aix',
        architecture: 'ppc',
      },
    }),
  ],
  ['install path', ofPlan({kind: 'invalidInstallPath', reason: 'relative'})],
  ['download', ofTransfer({kind: 'serverDownload', cause: 'downloadFailed'})],
  ['local download', ofTransfer({kind: 'localDownload', detail: '404'})],
  [
    'download timeout',
    ofTransfer({kind: 'downloadTimeout', reason: 'stalled'}),
  ],
  ['verification', ofTransfer({kind: 'verification', mismatch: 'checksum'})],
  ['unpack', ofTransfer({kind: 'unpack'})],
  [
    'copy',
    ofTransfer({kind: 'copy', failure: {kind: 'copyFailed', detail: 'full'}}),
  ],
  [
    'transfer script',
    ofTransfer({kind: 'scriptFailed', status: 'UnpackFailed'}),
  ],
  [
    'spawn vanished',
    ofConnection({
      kind: 'spawnFailed',
      cause: 'clientVanished',
      detail: 'gone',
    }),
  ],
  [
    'spawn other',
    ofConnection({kind: 'spawnFailed', cause: 'spawnFailed', detail: 'EAGAIN'}),
  ],
  [
    'helper refused',
    ofConnection({kind: 'helperRefused', reason: 'unreadable reply'}),
  ],
  [
    'start script',
    ofStart(
      {kind: 'scriptFailed', status: 'ServerDownloadFailed'},
      EXEC_SERVER,
    ),
  ],
];

describe('the reading of each library failure (no library text is shown)', () => {
  it('contracts R1: a closed channel gives no reason and logs what the library said', () => {
    deepStrictEqual(
      ofChannel({kind: 'channelClosed', detail: 'the session ended'}),
      {
        kind: 'channelClosed',
        logDetail: 'the session ended',
      },
    );
  });

  it('contracts R1: a timed out channel gives no reason', () => {
    deepStrictEqual(ofChannel({kind: 'timeout', detail: 'no end in time'}), {
      kind: 'timeout',
      logDetail: 'no end in time',
    });
  });

  it('contracts R1: a cancelled channel gives neither reason nor log detail', () => {
    deepStrictEqual(ofChannel({kind: 'cancelled', detail: 'stopped'}), {
      kind: 'cancelled',
    });
  });

  it('contracts R1: a missing copy tool gives no reason and logs the detail', () => {
    deepStrictEqual(ofChannel({kind: 'copyToolMissing', detail: 'no scp'}), {
      kind: 'prerequisiteMissing',
      logDetail: 'no scp',
    });
  });

  it('F-2403 7.E2: a failed copy gives the install reason S075 and logs the detail', () => {
    deepStrictEqual(ofChannel({kind: 'copyFailed', detail: 'x'}), {
      kind: 'serverInstall',
      reason: {id: 'S075'},
      logDetail: 'x',
    });
  });

  it('contracts R1: any other channel failure is unknown, with the detail in the log', () => {
    deepStrictEqual(ofChannel({kind: 'spawnFailed', detail: 'EAGAIN'}), {
      kind: 'unknown',
      logDetail: 'EAGAIN',
    });
  });

  it('contracts R1: an empty detail leaves no log detail', () => {
    deepStrictEqual(ofChannel({kind: 'spawnFailed', detail: ''}), {
      kind: 'unknown',
    });
  });

  it('contracts R1: an unsupported platform gives no reason and logs what the host reported', () => {
    deepStrictEqual(ofProbe({kind: 'unsupportedPlatform', reported: 'aix'}), {
      kind: 'unsupportedPlatform',
      logDetail: 'reported: aix',
    });
  });

  it('contracts R1: an unsupported architecture logs what the host reported', () => {
    deepStrictEqual(ofProbe({kind: 'unsupportedArch', reported: 'sparc'}), {
      kind: 'unsupportedPlatform',
      logDetail: 'reported: sparc',
    });
  });

  it('contracts R1: missing tools give no reason and log the list', () => {
    deepStrictEqual(
      ofProbe({kind: 'prerequisiteMissing', missing: ['tar', 'gzip']}),
      {kind: 'prerequisiteMissing', logDetail: 'missing: tar, gzip'},
    );
  });

  it('F-2403 7.E1: a script status of ServerDownloadFailed gives the download reason S043', () => {
    deepStrictEqual(
      ofTransfer({kind: 'scriptFailed', status: 'ServerDownloadFailed'}),
      {
        kind: 'serverDownload',
        reason: {id: 'S043'},
      },
    );
  });

  it('F-2403 7.E1: a script status of NoDownloaderAvailable gives the download reason S043', () => {
    deepStrictEqual(
      ofProbe({kind: 'probeFailed', status: 'NoDownloaderAvailable'}),
      {
        kind: 'serverDownload',
        reason: {id: 'S043'},
      },
    );
  });

  it('F-2403 7.E3: a script status of UnpackFailed gives the install reason S075', () => {
    deepStrictEqual(
      ofTransfer({kind: 'scriptFailed', status: 'UnpackFailed'}),
      {
        kind: 'serverInstall',
        reason: {id: 'S075'},
      },
    );
  });

  it('F-2409 7.E2: a failed start with useExecServer off gives STR:S135', () => {
    deepStrictEqual(ofStart({kind: 'serverStart'}, {useExecServer: false}), {
      kind: 'serverStart',
      reason: {id: 'S135', values: []},
    });
  });

  it('F-2409 BR-9: a failed start with useExecServer on gives no reason', () => {
    deepStrictEqual(ofStart({kind: 'serverStart'}, EXEC_SERVER), {
      kind: 'serverStart',
    });
  });

  for (const useExecServer of [true, false]) {
    it(`F-2409 6.2: no free port in the range gives STR:S135 with useExecServer ${String(useExecServer)}`, () => {
      deepStrictEqual(
        ofStart({kind: 'serverStart', cause: 'noFreePort'}, {useExecServer}),
        {kind: 'serverStart', reason: {id: 'S135', values: []}},
      );
    });

    it(`F-2409 AC-30: a server that ended for CVE-2020-1416 gives STR:S136 with useExecServer ${String(useExecServer)}`, () => {
      deepStrictEqual(
        ofStart({kind: 'serverStart', cause: 'cveTerminated'}, {useExecServer}),
        {kind: 'serverStart', reason: {id: 'S136', values: []}},
      );
    });
  }

  it('F-2403 7.E3: a script status of CreateInstallDirFailed gives the install reason S075', () => {
    deepStrictEqual(
      ofStart(
        {kind: 'scriptFailed', status: 'CreateInstallDirFailed'},
        EXEC_SERVER,
      ),
      {
        kind: 'serverInstall',
        reason: {id: 'S075'},
      },
    );
  });

  it('contracts R1: a script status of NoBash stays a missing prerequisite with no reason', () => {
    deepStrictEqual(ofProbe({kind: 'probeFailed', status: 'NoBash'}), {
      kind: 'prerequisiteMissing',
    });
  });

  it('contracts R1: a status word outside the list is unknown', () => {
    deepStrictEqual(ofProbe({kind: 'probeFailed', status: 'SomethingNew'}), {
      kind: 'unknown',
    });
  });

  it('a probe with unreadable facts, no block or a channel failure maps unchanged', () => {
    deepStrictEqual(
      [
        ofProbe({kind: 'unreadableFacts', field: 'os'}),
        ofProbe({kind: 'noResultBlock'}),
        ofProbe({
          kind: 'channelFailed',
          failure: {kind: 'timeout', detail: ''},
        }),
      ],
      [{kind: 'unknown'}, {kind: 'channelClosed'}, {kind: 'timeout'}],
    );
  });

  it('a plan with no source maps to no server source', () => {
    deepStrictEqual(ofPlan({kind: 'noSource'}), {kind: 'noServerSource'});
  });

  it('#299 (athena): an unknown placeholder is named as the user wrote it, braces included', () => {
    deepStrictEqual(
      ofPlan({
        kind: 'invalidOverride',
        problem: {kind: 'unknownPlaceholder', name: 'foo'},
      }).reason,
      {id: 'templateUnknownPlaceholder', values: ['${foo}']},
    );
  });

  it('#299: a template that is not an http address gives its own reason and keeps the value out of it', () => {
    deepStrictEqual(
      ofPlan({
        kind: 'invalidOverride',
        problem: {kind: 'notHttpUrl', value: 'ftp://h/x'},
      }).reason,
      {id: 'templateNotHttp', values: []},
    );
  });

  it('#299: the value of a template that is not an http address reaches only the log', () => {
    deepStrictEqual(
      ofPlan({
        kind: 'invalidOverride',
        problem: {kind: 'notHttpUrl', value: 'ftp://h/x'},
      }).logDetail?.includes('ftp://h/x'),
      true,
    );
  });

  it('#299: a template problem of the base-URL form has no reason', () => {
    deepStrictEqual(
      ofPlan({
        kind: 'invalidOverride',
        problem: {
          kind: 'unsupportedPlatform',
          operatingSystem: 'aix',
          architecture: 'ppc',
        },
      }).reason,
      undefined,
    );
  });

  it('contracts R1: an install path that does not work gives no reason and logs why', () => {
    deepStrictEqual(ofPlan({kind: 'invalidInstallPath', reason: 'relative'}), {
      kind: 'invalidSetting',
      logDetail: 'relative',
    });
  });

  it('F-2403 7.E1: a server download that failed gives S043 and logs the cause', () => {
    deepStrictEqual(ofTransfer({kind: 'serverDownload', cause: 'tooLarge'}), {
      kind: 'serverDownload',
      reason: {id: 'S043'},
      logDetail: 'tooLarge',
    });
  });

  it('F-2403 7.E1: a local download that failed gives S043 and logs the detail', () => {
    deepStrictEqual(ofTransfer({kind: 'localDownload', detail: '404'}), {
      kind: 'serverDownload',
      reason: {id: 'S043'},
      logDetail: '404',
    });
  });

  it('F-2403 7.E1: a download that timed out gives S043 and logs the reason', () => {
    deepStrictEqual(ofTransfer({kind: 'downloadTimeout', reason: 'stalled'}), {
      kind: 'serverDownload',
      reason: {id: 'S043'},
      logDetail: 'stalled',
    });
  });

  it('F-2403 7.E1: a download that failed verification gives S043 and logs the mismatch', () => {
    deepStrictEqual(ofTransfer({kind: 'verification', mismatch: 'checksum'}), {
      kind: 'serverDownload',
      reason: {id: 'S043'},
      logDetail: 'checksum',
    });
  });

  it('F-2403 7.E2: an unpack that failed gives the install reason S075', () => {
    deepStrictEqual(ofTransfer({kind: 'unpack'}), {
      kind: 'serverInstall',
      reason: {id: 'S075'},
    });
  });

  it('F-2403 7.E2: a copy that failed during the transfer gives S075 and logs the detail', () => {
    deepStrictEqual(
      ofTransfer({kind: 'copy', failure: {kind: 'copyFailed', detail: 'full'}}),
      {kind: 'serverInstall', reason: {id: 'S075'}, logDetail: 'full'},
    );
  });

  it('a transfer that is cancelled, out of retries or without a result block maps unchanged', () => {
    deepStrictEqual(
      [
        ofTransfer({kind: 'cancelled'}),
        ofTransfer({kind: 'retriesExhausted'}),
        ofTransfer({kind: 'noResultBlock'}),
        ofTransfer({
          kind: 'channelFailed',
          failure: {kind: 'channelClosed', detail: ''},
        }),
      ],
      [
        {kind: 'cancelled'},
        {kind: 'retriesExhausted'},
        {kind: 'channelClosed'},
        {kind: 'channelClosed'},
      ],
    );
  });

  it('a start: port range, server, facts, prerequisites, retries, script status, no block, channel', () => {
    deepStrictEqual(
      [
        ofStart({kind: 'invalidPortRange'}, EXEC_SERVER),
        ofStart({kind: 'serverStart'}, EXEC_SERVER),
        ofStart({kind: 'unreadableServerFacts'}, EXEC_SERVER),
        ofStart({kind: 'prerequisitesMissing'}, EXEC_SERVER),
        ofStart({kind: 'retriesExhausted'}, EXEC_SERVER),
        ofStart({kind: 'scriptFailed', status: 'LockBusy'}, EXEC_SERVER),
        ofStart({kind: 'noResultBlock'}, EXEC_SERVER),
        ofStart(
          {
            kind: 'channelFailed',
            failure: {kind: 'cancelled', detail: ''},
          },
          EXEC_SERVER,
        ),
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

  it("contracts R1: a login failure keeps the reason ssh gave, which is ssh's own words", () => {
    deepStrictEqual(
      ofConnection({
        kind: 'loginFailed',
        failure: 'authentication',
        reason: {text: 'denied'},
        hints: [],
      }),
      {kind: 'authentication', reason: {text: 'denied'}, hints: []},
    );
  });

  it('a login failure with no reason has none', () => {
    deepStrictEqual(
      ofConnection({kind: 'loginFailed', failure: 'unreachable', hints: []}),
      {kind: 'unreachable', hints: []},
    );
  });

  it('contracts R1: an ssh that vanished is a missing prerequisite with the detail in the log only', () => {
    deepStrictEqual(
      ofConnection({
        kind: 'spawnFailed',
        cause: 'clientVanished',
        detail: 'ssh is gone',
      }),
      {kind: 'prerequisiteMissing', logDetail: 'ssh is gone'},
    );
  });

  it('contracts R1: an ssh that could not be started is unknown with the detail in the log only', () => {
    deepStrictEqual(
      ofConnection({
        kind: 'spawnFailed',
        cause: 'spawnFailed',
        detail: 'EAGAIN',
      }),
      {kind: 'unknown', logDetail: 'EAGAIN'},
    );
  });

  it('contracts R1: a refused helper is unknown with the reason in the log only', () => {
    deepStrictEqual(
      ofConnection({kind: 'helperRefused', reason: 'unreadable reply'}),
      {kind: 'unknown', logDetail: 'unreadable reply'},
    );
  });

  it('a lost transport, a gone helper, a timeout and a cancel map unchanged', () => {
    deepStrictEqual(
      [
        ofConnection({kind: 'transportLost'}),
        ofConnection({kind: 'helperGone'}),
        ofConnection({kind: 'timeout'}),
        ofConnection({kind: 'cancelled'}),
      ],
      [
        {kind: 'channelClosed'},
        {kind: 'channelClosed'},
        {kind: 'timeout'},
        {kind: 'cancelled'},
      ],
    );
  });

  for (const [name, detail] of EVERY_CASE) {
    it(`R-29: ${name} has no reason that carries text`, () => {
      deepStrictEqual(
        detail.reason !== undefined && 'text' in detail.reason,
        false,
      );
    });
  }
});
