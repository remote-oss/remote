import {deepStrictEqual} from 'node:assert';
import type {StartOutcome, TransferPhase} from 'lib-server';
import {connect, type TransportEvent} from '../../src/pipeline/connect.ts';
import type {
  ConnectSteps,
  StepResult,
  TunnelOpening,
} from '../../src/pipeline/steps.ts';
import {
  CHANNEL_CLOSED,
  INPUT,
  leaseOf,
  type Recording,
  never,
  OPENED,
  REUSE,
  setup,
  STARTED,
  steps,
  TERMS,
  tunnelFails,
  tunnelOf,
} from './pipeline.fixture.ts';

describe('the connect pipeline, when it works', () => {
  it('runs the steps in the order of the contract, transferring a server that is not there', async () => {
    const {recording, options} = setup();
    await connect(INPUT, steps(recording), options);
    deepStrictEqual(recording.calls, [
      'validate',
      'preconnect',
      'locateClient',
      'decideTerms',
      'openConnection',
      'probe',
      'plan',
      'gate',
      'transfer',
      'start',
      'openTunnel',
      'rememberPlatform',
    ]);
  });

  it('skips the transfer when the plan reuses an installed server', async () => {
    const {recording, options} = setup();
    await connect(
      INPUT,
      steps(recording, {plan: () => ({plan: REUSE})}),
      options,
    );
    deepStrictEqual(recording.calls.includes('transfer'), false);
  });

  it('runs the pre-connection script on the first attempt only', async () => {
    const {recording, options} = setup();
    await connect(
      {...INPUT, attempt: 2, isReconnection: true},
      steps(recording),
      options,
    );
    deepStrictEqual(recording.calls.includes('preconnect'), false);
  });

  it('gives the window the tunnel address, the token and what the tunnel can do, and keeps the lease', async () => {
    const {recording, options} = setup();
    const result = await connect(INPUT, steps(recording), options);
    deepStrictEqual(
      ['kind' in result ? result.kind : result.connected, recording.releases],
      [
        {
          address: {host: '127.0.0.1', port: 50000},
          extensionHostEnv: {FLAG: 'yes'},
          environmentTunnels: [],
          tunnelFeatures: {elevation: false},
          connectionToken: 'secret-token',
          trusted: false,
        },
        0,
      ],
    );
  });

  it('gives the lease back when the window ends the connection', async () => {
    const {recording, options} = setup();
    const result = await connect(INPUT, steps(recording), options);
    if (!('kind' in result)) {
      result.release();
    }
    deepStrictEqual(recording.releases, 1);
  });

  it('starts the server with the licence flag the gate cleared', async () => {
    const {recording, options} = setup();
    const flags: boolean[] = [];
    await connect(
      INPUT,
      steps(recording, {
        start: (input, lease, host, licenceAccepted) => {
          flags.push(licenceAccepted);
          return Promise.resolve(STARTED);
        },
      }),
      options,
    );
    deepStrictEqual(flags, [true]);
  });

  it('tells the window the phases in order: initializing, the transfer stages, the tunnel', async () => {
    const {recording, options} = setup();
    const stages: TransferPhase[] = [
      {kind: 'downloading'},
      {kind: 'progress', step: 'download', percent: 40},
      {kind: 'progress', step: 'unpack', percent: 50},
      {kind: 'downloadingLocally'},
      {kind: 'copying'},
      {kind: 'installing'},
    ];
    await connect(
      INPUT,
      steps(recording, {
        transfer: (input, lease, host, planned, onPhase) => {
          stages.forEach(onPhase);
          return Promise.resolve({
            kind: 'transferred',
            installFolder: '/x',
          });
        },
      }),
      options,
    );
    deepStrictEqual(recording.phases, [
      {kind: 'initializing'},
      {kind: 'downloading'},
      {kind: 'serverDownloadPercent', percent: 40},
      {kind: 'downloadingLocally'},
      {kind: 'copyingWithScp'},
      {kind: 'installing'},
      {kind: 'settingUpTunnel'},
    ]);
  });

  it('tells the window when the port is slow to answer', async () => {
    const {recording, options} = setup();
    await connect(
      INPUT,
      steps(recording, {
        openTunnel: (input, lease, server, onWaiting) => {
          onWaiting();
          return Promise.resolve({
            kind: 'done',
            value: tunnelOf(recording, {...OPENED, extensionHostEnv: {}}),
          });
        },
      }),
      options,
    );
    deepStrictEqual(recording.phases.slice(-2), [
      {kind: 'settingUpTunnel'},
      {kind: 'waitingForForwarding'},
    ]);
  });
});

describe('the connect pipeline, when a step fails', () => {
  it('a target that does not validate fails first, before anything is opened', async () => {
    const {recording, options} = setup();
    const result = await connect(
      INPUT,
      steps(recording, {
        validate: () => ({
          kind: 'failed',
          failure: {kind: 'invalidSetting', reason: {text: 'bad target'}},
        }),
      }),
      options,
    );
    deepStrictEqual(
      [result, recording.calls],
      [
        {
          kind: 'invalidSetting',
          reason: {text: 'bad target'},
          retryable: false,
          silent: false,
          userAlreadyNotified: false,
          hints: [],
          diagnostics: [],
        },
        [],
      ],
    );
  });

  it('a pre-connection script that failed tells the window the user was already told', async () => {
    const {recording, options} = setup();
    const result = await connect(
      INPUT,
      steps(recording, {
        preconnect: () =>
          Promise.resolve({
            kind: 'failed',
            failure: {kind: 'preconnectFailed', userAlreadyNotified: true},
          }),
      }),
      options,
    );
    deepStrictEqual(
      'kind' in result ? [result.kind, result.userAlreadyNotified] : result,
      ['preconnectFailed', true],
    );
  });

  it('a pre-connection script that never ends fails at its limit', async () => {
    const {recording, options} = setup();
    const result = await connect(
      INPUT,
      steps(recording, {preconnect: () => never()}),
      {...options, limits: {...options.limits, preconnectMilliseconds: 20}},
    );
    deepStrictEqual(
      'kind' in result ? result.kind : result,
      'preconnectFailed',
    );
  });

  it('a login that failed passes its kind, reason and hints to the window and opens no lease', async () => {
    const {recording, options} = setup();
    const result = await connect(
      INPUT,
      steps(recording, {
        openConnection: () =>
          Promise.resolve({
            kind: 'failed',
            failure: {
              kind: 'authentication',
              reason: {text: 'Permission denied (publickey).'},
              hints: [],
            },
          }),
      }),
      options,
    );
    deepStrictEqual(
      [
        'kind' in result ? [result.kind, result.reason] : result,
        recording.releases,
      ],
      [['authentication', {text: 'Permission denied (publickey).'}], 0],
    );
  });

  it('a probe that fails is read by the probe table, and the lease is given back', async () => {
    const {recording, options} = setup();
    const result = await connect(
      INPUT,
      steps(recording, {
        probe: () =>
          Promise.resolve({
            kind: 'failed',
            failure: {kind: 'unsupportedPlatform', reported: 'FreeBSD'},
          }),
      }),
      options,
    );
    deepStrictEqual(
      ['kind' in result ? result.kind : result, recording.releases],
      ['unsupportedPlatform', 1],
    );
  });

  it('a probe that never answers fails at its limit as a timeout', async () => {
    const {recording, options} = setup();
    const result = await connect(
      INPUT,
      steps(recording, {probe: () => never()}),
      {...options, limits: {...options.limits, probeMilliseconds: 20}},
    );
    deepStrictEqual('kind' in result ? result.kind : result, 'timeout');
  });

  it('a plan that has no source fails as no server source, before the licence is asked', async () => {
    const {recording, options} = setup();
    const result = await connect(
      INPUT,
      steps(recording, {plan: () => ({failure: {kind: 'noSource'}})}),
      options,
    );
    deepStrictEqual(
      [
        'kind' in result ? result.kind : result,
        recording.calls.includes('gate'),
      ],
      ['noServerSource', false],
    );
  });

  it('a declined licence fails as declined and nothing is transferred or started', async () => {
    const {recording, options} = setup();
    const result = await connect(
      INPUT,
      steps(recording, {
        gate: () => Promise.resolve({kind: 'licenceDeclined'}),
      }),
      options,
    );
    deepStrictEqual(
      [
        'kind' in result ? result.kind : result,
        'reason' in result ? result.reason : result,
        recording.calls.slice(-1),
        recording.releases,
      ],
      ['licenceDeclined', {id: 'S027'}, ['plan'], 1],
    );
  });

  it('a transfer that fails is read by the transfer table', async () => {
    const {recording, options} = setup();
    const result = await connect(
      INPUT,
      steps(recording, {
        transfer: () =>
          Promise.resolve({
            kind: 'failed',
            failure: {kind: 'serverDownload', cause: 'downloadFailed'},
          }),
      }),
      options,
    );
    deepStrictEqual('kind' in result ? result.kind : result, 'serverDownload');
  });

  it('a start that fails is read by the start table, and the tunnel is not opened', async () => {
    const {recording, options} = setup();
    const result = await connect(
      INPUT,
      steps(recording, {
        start: () =>
          Promise.resolve({kind: 'failed', failure: {kind: 'serverStart'}}),
      }),
      options,
    );
    deepStrictEqual(
      [
        'kind' in result ? result.kind : result,
        recording.calls.includes('openTunnel'),
      ],
      ['serverStart', false],
    );
  });

  it('a tunnel that does not open fails with the step failure and gives the lease back', async () => {
    const {recording, options} = setup();
    const result = await connect(
      INPUT,
      steps(recording, {
        openTunnel: tunnelFails,
      }),
      options,
    );
    deepStrictEqual(
      ['kind' in result ? result.kind : result, recording.releases],
      ['channelClosed', 1],
    );
  });

  it('a tunnel that never answers fails at its limit as a timeout', async () => {
    const {recording, options} = setup();
    const result = await connect(
      INPUT,
      steps(recording, {openTunnel: () => never()}),
      {...options, limits: {...options.limits, tunnelMilliseconds: 20}},
    );
    deepStrictEqual('kind' in result ? result.kind : result, 'timeout');
  });

  it('a failure on a reconnection that may recover is retryable, and not past the limit', async () => {
    const {recording, options} = setup();
    const failingSteps = steps(recording, {
      probe: () =>
        Promise.resolve({
          kind: 'failed',
          failure: {kind: 'channelFailed', failure: CHANNEL_CLOSED},
        }),
    });
    const input = {...INPUT, attempt: 3, isReconnection: true};
    const retried = await connect(input, failingSteps, options);
    const stopped = await connect(input, failingSteps, {
      ...options,
      maximumReconnectionAttempts: 2,
    });
    deepStrictEqual(
      [
        'kind' in retried ? retried.retryable : retried,
        'kind' in stopped ? stopped.retryable : stopped,
      ],
      [true, false],
    );
  });
});

describe('the connect pipeline, when the window cancels', () => {
  it('a cancel before the connection opens stops there with no lease to give back', async () => {
    const {recording, options} = setup();
    const controller = new AbortController();
    controller.abort();
    const result = await connect(INPUT, steps(recording), {
      ...options,
      cancellation: controller.signal,
    });
    deepStrictEqual(
      ['kind' in result ? result.kind : result, recording.releases],
      ['cancelled', 0],
    );
  });

  it('a cancel while the probe waits fails as cancelled and gives the lease back', async () => {
    const {recording, options} = setup();
    const controller = new AbortController();
    const pending = connect(INPUT, steps(recording, {probe: () => never()}), {
      ...options,
      cancellation: controller.signal,
    });
    await new Promise(resolve => setTimeout(resolve, 20));
    controller.abort();
    const result = await pending;
    deepStrictEqual(
      ['kind' in result ? result.kind : result, recording.releases],
      ['cancelled', 1],
    );
  });

  it('a cancel during the transfer stops before the server is started', async () => {
    const {recording, options} = setup();
    const controller = new AbortController();
    const result = await connect(
      INPUT,
      steps(recording, {
        transfer: () => {
          controller.abort();
          return Promise.resolve({kind: 'transferred', installFolder: '/x'});
        },
      }),
      {...options, cancellation: controller.signal},
    );
    deepStrictEqual(
      [
        'kind' in result ? result.kind : result,
        recording.calls.includes('start'),
      ],
      ['cancelled', false],
    );
  });
});

describe('the connect pipeline, steps before the connection opens and the decisions between steps', () => {
  it('a client that cannot be found fails with the step failure before a connection is opened', async () => {
    const {recording, options} = setup();
    const result = await connect(
      INPUT,
      steps(recording, {
        locateClient: () =>
          Promise.resolve({
            kind: 'failed',
            failure: {kind: 'prerequisiteMissing', reason: {text: 'no ssh'}},
          }),
      }),
      options,
    );
    deepStrictEqual(
      [
        'kind' in result ? result.kind : result,
        recording.calls.includes('openConnection'),
      ],
      ['prerequisiteMissing', false],
    );
  });

  it('terms that cannot be decided fail with the step failure before a connection is opened', async () => {
    const {recording, options} = setup();
    const result = await connect(
      INPUT,
      steps(recording, {
        decideTerms: () =>
          Promise.resolve({kind: 'failed', failure: {kind: 'cancelled'}}),
      }),
      options,
    );
    deepStrictEqual(
      [
        'kind' in result ? result.kind : result,
        recording.calls.includes('openConnection'),
      ],
      ['cancelled', false],
    );
  });

  /** The kind of the failure, and whether `skipped` still ran, when a step cancels the connect as it ends. */
  async function cancelledBy(
    changes: (abort: () => void) => Partial<ConnectSteps>,
    skipped: string,
  ): Promise<[unknown, boolean]> {
    const {recording, options} = setup();
    const controller = new AbortController();
    const result = await connect(
      INPUT,
      steps(
        recording,
        changes(() => {
          controller.abort();
        }),
      ),
      {...options, cancellation: controller.signal},
    );
    return [
      'kind' in result ? result.kind : result,
      recording.calls.includes(skipped),
    ];
  }

  it('a cancel while the client is located stops before a connection is opened', async () => {
    deepStrictEqual(
      await cancelledBy(
        abort => ({
          locateClient: () => {
            abort();
            return Promise.resolve({kind: 'done', value: undefined});
          },
        }),
        'openConnection',
      ),
      ['cancelled', false],
    );
  });

  it('a cancel while the terms are decided stops before a connection is opened', async () => {
    deepStrictEqual(
      await cancelledBy(
        abort => ({
          decideTerms: () => {
            abort();
            return Promise.resolve({kind: 'done', value: TERMS});
          },
        }),
        'openConnection',
      ),
      ['cancelled', false],
    );
  });

  it('a cancel while the licence is asked stops before the transfer', async () => {
    deepStrictEqual(
      await cancelledBy(
        abort => ({
          gate: () => {
            abort();
            return Promise.resolve({
              kind: 'cleared',
              acceptanceFlag: true,
              remembered: true,
            });
          },
        }),
        'transfer',
      ),
      ['cancelled', false],
    );
  });

  it('a gate that ends as cancelled ends the connect as cancelled and gives the lease back', async () => {
    deepStrictEqual(
      await cancelledBy(
        () => ({
          gate: () => Promise.resolve({kind: 'cancelled'}),
        }),
        'transfer',
      ),
      ['cancelled', false],
    );
  });
});

describe('the connect pipeline, what it keeps and gives back', () => {
  const REUSED: StartOutcome = {
    ...STARTED,
    server: {...STARTED.server, reused: true},
  };

  it('installs the default extensions on a server that was already running', async () => {
    const {recording, options} = setup();
    await connect(
      INPUT,
      steps(recording, {start: () => Promise.resolve(REUSED)}),
      options,
    );
    deepStrictEqual(recording.calls.includes('installExtensions'), true);
  });

  it('leaves the default extensions alone on a server it started', async () => {
    const {recording, options} = setup();
    await connect(INPUT, steps(recording), options);
    deepStrictEqual(recording.calls.includes('installExtensions'), false);
  });

  it('goes on when the default extensions cannot be installed', async () => {
    const {recording, options} = setup();
    const result = await connect(
      INPUT,
      steps(recording, {
        start: () => Promise.resolve(REUSED),
        installExtensions: () => Promise.reject(new Error('no answer')),
      }),
      options,
    );
    deepStrictEqual('connected' in result, true);
  });

  it('stores the shared record once the tunnel is open', async () => {
    const {recording, options} = setup();
    await connect(INPUT, steps(recording), options);
    deepStrictEqual(recording.records, [
      {
        remotePort: 4321,
        operatingSystem: 'linux',
        architecture: 'x64',
        temporaryFolder: '/tmp',
        connectionToken: 'secret-token',
      },
    ]);
  });

  it('stores no shared record when the tunnel does not open', async () => {
    const {recording, options} = setup();
    await connect(
      INPUT,
      steps(recording, {
        openTunnel: tunnelFails,
      }),
      options,
    );
    deepStrictEqual(recording.records, []);
  });

  it('goes on when the shared record cannot be stored', async () => {
    const {recording, options} = setup();
    const result = await connect(
      INPUT,
      steps(recording, {
        openConnection: () =>
          Promise.resolve({
            kind: 'done',
            value: {
              ...leaseOf(recording),
              storeSharedRecord: () => Promise.reject(new Error('full')),
            },
          }),
      }),
      options,
    );
    deepStrictEqual('connected' in result, true);
  });

  it('remembers the platform the host reported after the connect worked', async () => {
    const {recording, options} = setup();
    const reported: string[] = [];
    await connect(
      INPUT,
      steps(recording, {
        rememberPlatform: (input, platform) => {
          reported.push(platform);
          return Promise.resolve();
        },
      }),
      options,
    );
    deepStrictEqual(reported, ['linux']);
  });

  it('closes the tunnel and gives the lease back when the window ends', async () => {
    const {recording, options} = setup();
    const result = await connect(INPUT, steps(recording), options);
    if ('connected' in result) {
      result.release();
    }
    deepStrictEqual([recording.tunnelCloses, recording.releases], [1, 1]);
  });

  it('a step that throws ends in a failure and gives the lease back', async () => {
    const {recording, options} = setup();
    const result = await connect(
      INPUT,
      steps(recording, {
        probe: () => Promise.reject(new Error('exploded')),
      }),
      options,
    );
    deepStrictEqual(
      [
        'kind' in result ? [result.kind, result.reason] : result,
        recording.releases,
      ],
      [['unknown', {text: 'Error: exploded'}], 1],
    );
  });

  it('a tunnel that opens after its limit is closed', async () => {
    const {recording, options} = setup();
    const waiting: Array<(value: StepResult<TunnelOpening>) => void> = [];
    const result = await connect(
      INPUT,
      steps(recording, {
        openTunnel: () =>
          new Promise(resolve => {
            waiting.push(resolve);
          }),
      }),
      {...options, limits: {...options.limits, tunnelMilliseconds: 10}},
    );
    waiting[0]?.({kind: 'done', value: tunnelOf(recording)});
    await new Promise(resolve => setTimeout(resolve, 10));
    deepStrictEqual(
      ['kind' in result ? result.kind : result, recording.tunnelCloses],
      ['timeout', 1],
    );
  });

  it('a question that stays open longer than every limit does not end the connect', async () => {
    const {recording, options} = setup();
    const result = await connect(
      INPUT,
      steps(recording, {
        openConnection: async () => {
          await new Promise(resolve => setTimeout(resolve, 60));
          return {kind: 'done', value: leaseOf(recording)};
        },
      }),
      {
        ...options,
        limits: {
          preconnectMilliseconds: 10,
          probeMilliseconds: 10,
          tunnelMilliseconds: 10,
        },
      },
    );
    deepStrictEqual('connected' in result, true);
  });

  it('a cancel that arrives with the lease gives the lease back', async () => {
    const {recording, options} = setup();
    const controller = new AbortController();
    const result = await connect(
      INPUT,
      steps(recording, {
        openConnection: () => {
          controller.abort();
          return Promise.resolve({kind: 'done', value: leaseOf(recording)});
        },
      }),
      {...options, cancellation: controller.signal},
    );
    deepStrictEqual(
      ['kind' in result ? result.kind : result, recording.releases],
      ['cancelled', 1],
    );
  });
});

describe('the connect pipeline, the transport of a connection that worked', () => {
  /** A connect that worked, with the recording whose lease takes the notices, and the events the window heard. */
  async function connected(): Promise<{
    send: (notice: Parameters<NonNullable<Recording['notice']>>[0]) => void;
    heard: TransportEvent[];
    stop: () => void;
  }> {
    const {recording, options} = setup();
    const result = await connect(INPUT, steps(recording), options);
    if (!('onTransport' in result)) {
      throw new Error('the connect did not work');
    }
    const heard: TransportEvent[] = [];
    const stop = result.onTransport(event => {
      heard.push(event);
    });
    return {
      send: notice => {
        recording.notice?.(notice);
      },
      heard,
      stop,
    };
  }

  it('R1: a lost transport is lost, and the end of the connection server is closed', async () => {
    const {send, heard} = await connected();
    send({type: 'transportLost'});
    send({type: 'helperGone'});
    deepStrictEqual(heard, ['lost', 'closed']);
  });

  it('R1: the other notices of the lease are not transport events', async () => {
    const {send, heard} = await connected();
    send({type: 'waitingForOtherWindow'});
    deepStrictEqual(heard, []);
  });

  it('R1: nothing is heard once the window stops following', async () => {
    const {send, heard, stop} = await connected();
    stop();
    send({type: 'transportLost'});
    deepStrictEqual(heard, []);
  });
});
