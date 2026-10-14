import {deepStrictEqual} from 'node:assert';
import type {MemorySink} from 'lib-log/testing/memory-sink';
import type {
  ProbedHost,
  StartOutcome,
  TransferOutcome,
  TransferPhase,
} from 'lib-server';
import {
  connect,
  portOf,
  type TransportEvent,
} from '../../src/pipeline/connect.ts';
import type {
  ConnectSteps,
  StepResult,
  TunnelOpening,
} from '../../src/pipeline/steps.ts';
import {
  CHANNEL_CLOSED,
  DOWNLOAD,
  endTunnel,
  HOST,
  INPUT,
  leaseOf,
  LINKED,
  NO_FORWARDING,
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
  WAITS,
  waitsOf,
} from './pipeline.fixture.ts';

describe('the connect pipeline, when it works', () => {
  it('runs the steps in the order of the contract, transferring a server that is not there', async () => {
    const {recording, options} = setup();
    await connect(INPUT, steps(recording), options);
    deepStrictEqual(recording.calls, [
      'validate',
      'preconnect',
      'decideTerms',
      'locateClient',
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

  it('F-2206 §9: the probed platform is logged after the probe', async () => {
    const {recording, options, logSink} = setup();
    await connect(INPUT, steps(recording), options);
    deepStrictEqual(
      logSink.lines
        .map(line => line.message)
        .filter(message => message.startsWith('Host platform:')),
      ['Host platform: linux x64'],
    );
  });

  it('F-2206 §9: no platform line is written when the connect ends before the probe', async () => {
    const {recording, options, logSink} = setup();
    await connect(
      INPUT,
      steps(recording, {
        decideTerms: () =>
          Promise.resolve({kind: 'failed', failure: {kind: 'cancelled'}}),
      }),
      options,
    );
    deepStrictEqual(
      logSink.lines.filter(line => line.message.startsWith('Host platform:')),
      [],
    );
  });

  it('F-2206 §9: no platform line is written when the probe fails', async () => {
    const {recording, options, logSink} = setup();
    await connect(
      INPUT,
      steps(recording, {
        probe: () =>
          Promise.resolve({
            kind: 'failed',
            failure: {kind: 'noResultBlock'},
          }),
      }),
      options,
    );
    deepStrictEqual(
      logSink.lines.filter(line => line.message.startsWith('Host platform:')),
      [],
    );
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
      {...options, preconnectMilliseconds: 20},
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
      steps(recording, {
        locateClient: waitsOf({...WAITS, probeMilliseconds: 20}),
        probe: () => never(),
      }),
      options,
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

  /** A connect whose transfer fails the way the library reports a download that did not work. */
  async function downloadFailed() {
    const {recording, options, logSink} = setup();
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
    return {result, logSink};
  }

  /** A connect to a host of `architecture` whose transfer answers `outcome` for the plan resolved at `step`. */
  async function connectOver(
    architecture: ProbedHost['architecture'],
    step: 'override' | 'productTemplate' | 'builtInTable',
    outcome: TransferOutcome,
  ) {
    const {recording, options, logSink} = setup();
    const result = await connect(
      INPUT,
      steps(recording, {
        probe: () =>
          Promise.resolve({
            kind: 'probed',
            host: {...HOST, architecture},
          }),
        plan: () => ({plan: DOWNLOAD, step}),
        transfer: () => Promise.resolve(outcome),
      }),
      options,
    );
    return {result, recording, logSink};
  }

  const DOWNLOADED: TransferOutcome = {
    kind: 'transferred',
    installFolder: '/home/dev/.server/bin/abc',
  };
  const NOT_FOUND: TransferOutcome = {
    kind: 'failed',
    failure: {kind: 'serverDownload', cause: 'downloadFailed', status: 404},
  };

  it('#670 F-2401 AC-21, F-2405 BR-2: a ppc64le host whose server download works, from the host or from the client, goes on to the start with no S146', async () => {
    const {result, recording} = await connectOver(
      'ppc64le',
      'builtInTable',
      DOWNLOADED,
    );
    deepStrictEqual(
      [
        'connected' in result,
        recording.calls.includes('start'),
        JSON.stringify(result).includes('S146'),
      ],
      [true, true, false],
    );
  });

  it('#670 F-2401 AC-20: a host-side 404 from a built-in source fails with S146, the start never runs, and the log names ppc64le', async () => {
    const {result, recording, logSink} = await connectOver(
      'ppc64le',
      'builtInTable',
      NOT_FOUND,
    );
    deepStrictEqual(
      [
        'reason' in result ? result.reason : result,
        recording.calls.includes('start'),
        logSink.lines.some(line => line.message.includes('ppc64le')),
      ],
      [{id: 'S146'}, false, true],
    );
  });

  it('F-2403 AC-10: the same 404 from the user template is the download failure S043', async () => {
    const {result} = await connectOver('ppc64le', 'override', NOT_FOUND);
    deepStrictEqual('reason' in result ? result.reason : result, {id: 'S043'});
  });

  it('a transfer that fails is read by the transfer table', async () => {
    const {result} = await downloadFailed();
    deepStrictEqual('kind' in result ? result.kind : result, 'serverDownload');
  });

  it('contracts R1: a failed transfer carries only the reason id', async () => {
    const {result} = await downloadFailed();
    deepStrictEqual('reason' in result ? result.reason : result, {id: 'S043'});
  });

  it('contracts R1: what the library said about a failed transfer is not in the failure', async () => {
    const {result} = await downloadFailed();
    deepStrictEqual(JSON.stringify(result).includes('downloadFailed'), false);
  });

  it('F-2003: what the library said about a failed transfer is in the log', async () => {
    const {logSink} = await downloadFailed();
    deepStrictEqual(
      logSink.lines.some(
        line => line.message === 'the serverDownload failure: downloadFailed',
      ),
      true,
    );
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

  /** A connect whose tunnel step settles `afterMilliseconds` after it starts, on the path named, with a bound of 20 ms. */
  async function connectWithSlowTunnel(
    path: 'socks' | 'secondSsh' | 'socket',
    afterMilliseconds: number,
  ) {
    const {recording, options} = setup();
    const result = await connect(
      INPUT,
      steps(recording, {
        locateClient: waitsOf({...WAITS, tunnelMilliseconds: 20}),
        tunnelPath: () => path,
        openTunnel: () =>
          new Promise(resolve => {
            setTimeout(() => {
              resolve({kind: 'done', value: tunnelOf(recording)});
            }, afterMilliseconds);
          }),
      }),
      options,
    );
    return 'kind' in result ? result.kind : 'connected';
  }

  it('R1: a tunnel on the SOCKS path that settles after the limit still times out', async () => {
    deepStrictEqual(await connectWithSlowTunnel('socks', 60), 'timeout');
  });

  it('R1 (athena on #393): a tunnel on the second-ssh path that settles after the limit still connects', async () => {
    deepStrictEqual(await connectWithSlowTunnel('secondSsh', 60), 'connected');
  });

  it('R1 (athena on #393): a tunnel on the socket path that settles after the limit still connects', async () => {
    deepStrictEqual(await connectWithSlowTunnel('socket', 60), 'connected');
  });

  it('R1: a cancel still ends a tunnel on the second-ssh path that never settles', async () => {
    const {recording, options} = setup();
    const controller = new AbortController();
    const pending = connect(
      INPUT,
      steps(recording, {
        tunnelPath: () => 'secondSsh',
        openTunnel: () => never(),
      }),
      {...options, cancellation: controller.signal},
    );
    await new Promise(resolve => setTimeout(resolve, 10));
    controller.abort();
    const result = await pending;
    deepStrictEqual('kind' in result ? result.kind : result, 'cancelled');
  });

  it('a tunnel that never answers fails at its limit as a timeout', async () => {
    const {recording, options} = setup();
    const result = await connect(
      INPUT,
      steps(recording, {
        locateClient: waitsOf({...WAITS, tunnelMilliseconds: 20}),
        openTunnel: () => never(),
      }),
      options,
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
            return Promise.resolve({kind: 'done', value: WAITS});
          },
        }),
        'openConnection',
      ),
      ['cancelled', false],
    );
  });

  it('F-2206 AC-2: a cancelled pick runs no program: the client is never located', async () => {
    const {recording, options} = setup();
    await connect(
      INPUT,
      steps(recording, {
        decideTerms: () =>
          Promise.resolve({kind: 'failed', failure: {kind: 'cancelled'}}),
      }),
      options,
    );
    deepStrictEqual(recording.calls.includes('locateClient'), false);
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

describe('the port of a started server', () => {
  it('#299: a server on a port gives the port', () => {
    deepStrictEqual(portOf(STARTED.server), 4321);
  });

  it('#299: a server on a socket reaching the port path throws', () => {
    let thrown: unknown;
    try {
      portOf({
        ...STARTED.server,
        endpoint: {kind: 'socket', path: '/tmp/code-ab'},
      });
    } catch (caught) {
      thrown = caught;
    }
    deepStrictEqual(
      thrown instanceof Error &&
        thrown.message.includes('socket-mode server reached the port path'),
      true,
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
        ...NO_FORWARDING,
      },
    ]);
  });

  it("F-2311 R2: the shared record keeps the window's plans for the connection's later windows", async () => {
    const {recording, options} = setup();
    await connect(
      INPUT,
      steps(recording, {planForwarding: () => Promise.resolve(LINKED)}),
      options,
    );
    deepStrictEqual(
      [recording.records[0]?.agentLink, recording.records[0]?.display],
      [LINKED.agentLink, LINKED.display],
    );
  });

  it('F-2311 R1: the plans are made with the lease and the host the probe found, before the install plan', async () => {
    const {recording, options} = setup();
    const given: unknown[] = [];
    await connect(
      INPUT,
      steps(recording, {
        planForwarding: (input, lease, host) => {
          given.push(lease.socksPort, host.operatingSystem);
          recording.calls.push('planForwarding');
          return Promise.resolve(NO_FORWARDING);
        },
      }),
      options,
    );
    deepStrictEqual(
      [
        given,
        recording.calls.slice(
          recording.calls.indexOf('probe'),
          3 + recording.calls.indexOf('probe'),
        ),
      ],
      [
        [1080, 'linux'],
        ['probe', 'planForwarding', 'plan'],
      ],
    );
  });

  it('F-2311 5.0 step 5: the window gets its plans, and the link is started once, after the tunnel', async () => {
    const {recording, options} = setup();
    const result = await connect(
      INPUT,
      steps(recording, {
        planForwarding: () => Promise.resolve(LINKED),
        linkAgent: plan => {
          recording.calls.push('linkAgent');
          recording.links.push(plan);
        },
      }),
      options,
    );
    deepStrictEqual(
      [
        'forwarding' in result ? result.forwarding : result,
        recording.links,
        recording.calls.indexOf('linkAgent') >
          recording.calls.indexOf('openTunnel'),
      ],
      [LINKED, [LINKED.agentLink], true],
    );
  });

  it('F-2311 5.0 step 5: a connect that fails starts no link', async () => {
    const {recording, options} = setup();
    await connect(
      INPUT,
      steps(recording, {
        planForwarding: () => Promise.resolve(LINKED),
        openTunnel: tunnelFails,
      }),
      options,
    );
    deepStrictEqual(recording.links, []);
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

  it('F-2410 AC-2: a server on a socket connects with port 0, stores no shared record and warns of nothing', async () => {
    const {recording, options, logSink} = setup();
    const result = await connect(
      INPUT,
      steps(recording, {
        start: () =>
          Promise.resolve({
            ...STARTED,
            server: {
              ...STARTED.server,
              endpoint: {kind: 'socket', path: '/tmp/code-x'},
            },
          }),
      }),
      options,
    );
    deepStrictEqual(
      [
        'connected' in result ? result.serverPort : result,
        recording.records,
        logSink.lines.filter(line => line.level === 'warn'),
      ],
      [0, [], []],
    );
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

  it('#664: the connect resolves though the platform write never settles, and asked for the host platform once', async () => {
    const {recording, options} = setup();
    const reported: string[] = [];
    const result = await connect(
      INPUT,
      steps(recording, {
        rememberPlatform: (input, platform) => {
          reported.push(platform);
          return new Promise<void>(() => undefined);
        },
      }),
      options,
    );
    deepStrictEqual(
      ['connected' in result ? 'connected' : 'failed', reported],
      ['connected', ['linux']],
    );
  });

  it('#664: a platform write that fails is logged at warn once it has settled, and the connect still resolves', async () => {
    const {recording, options, logSink} = setup();
    const result = await connect(
      INPUT,
      steps(recording, {
        rememberPlatform: () => Promise.reject(new Error('locked')),
      }),
      options,
    );
    await new Promise(resolve => setImmediate(resolve));
    deepStrictEqual(
      [
        'connected' in result ? 'connected' : 'failed',
        logSink.lines
          .filter(line => line.message.includes('the platform setting'))
          .map(line => [line.level, line.message]),
      ],
      [
        'connected',
        [['warn', 'the platform setting did not work: Error: locked']],
      ],
    );
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
      [['unknown', undefined], 1],
    );
  });

  it('contracts R1: a step that throws puts its message in the log and not in the failure', async () => {
    const {recording, options, logSink} = setup();
    const result = await connect(
      INPUT,
      steps(recording, {probe: () => Promise.reject(new Error('boom'))}),
      options,
    );
    deepStrictEqual(
      [
        JSON.stringify(result).includes('boom'),
        logSink.lines.some(
          line => line.message === 'the unknown failure: Error: boom',
        ),
      ],
      [false, true],
    );
  });

  it('a tunnel that opens after its limit is closed', async () => {
    const {recording, options} = setup();
    const waiting: Array<(value: StepResult<TunnelOpening>) => void> = [];
    const result = await connect(
      INPUT,
      steps(recording, {
        locateClient: waitsOf({...WAITS, tunnelMilliseconds: 10}),
        openTunnel: () =>
          new Promise(resolve => {
            waiting.push(resolve);
          }),
      }),
      options,
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
        locateClient: waitsOf({probeMilliseconds: 10, tunnelMilliseconds: 10}),
        openConnection: async () => {
          await new Promise(resolve => setTimeout(resolve, 60));
          return {kind: 'done', value: leaseOf(recording)};
        },
      }),
      {...options, preconnectMilliseconds: 10},
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
  /**
   * A connect that worked, with the recording whose lease takes the notices, the tunnel's end, and the events the
   * window heard.
   */
  async function connected(): Promise<{
    send: (notice: Parameters<NonNullable<Recording['notice']>>[0]) => void;
    endTunnel: (detail: string) => void;
    release: () => void;
    heard: TransportEvent[];
    stop: () => void;
    logSink: MemorySink;
  }> {
    const {recording, options, logSink} = setup();
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
      endTunnel: detail => {
        endTunnel(recording, detail);
      },
      release: () => {
        result.release();
      },
      heard,
      stop,
      logSink,
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

  it('#299: a tunnel that ends without being asked to is a lost transport', async () => {
    const {endTunnel, heard} = await connected();
    endTunnel('listener failed');
    deepStrictEqual(heard, ['lost']);
  });

  it('F-2003: the tunnel end is logged with the reason the tunnel gives', async () => {
    const {endTunnel, logSink} = await connected();
    endTunnel('listener failed');
    deepStrictEqual(
      logSink.lines
        .filter(line => line.level === 'warn')
        .map(line => line.message),
      ['the window tunnel ended: listener failed'],
    );
  });

  it('#299, safety: a release that closes the tunnel is not a lost transport', async () => {
    const {release, heard} = await connected();
    release();
    deepStrictEqual(heard, []);
  });

  it('#299: a tunnel end after the window stops following is not heard', async () => {
    const {endTunnel, heard, stop} = await connected();
    stop();
    endTunnel('listener failed');
    deepStrictEqual(heard, []);
  });
});
