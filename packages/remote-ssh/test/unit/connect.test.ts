import {deepStrictEqual} from 'node:assert';
import type {MemorySink} from 'lib-log/testing/memory-sink';
import type {SessionCheck} from 'lib-ssh';
import type {
  ProbedHost,
  StartOutcome,
  TransferOutcome,
  TransferPhase,
} from 'lib-server';
import {
  connect,
  portOf,
  type PhaseEvent,
  type TransportEvent,
} from '../../src/pipeline/connect.ts';
import type {
  ConnectionLease,
  ConnectionTerms,
  ConnectSteps,
  StepFailure,
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
import {LOCAL_LOCK_TIMEOUT} from '../../src/pipeline/failure.ts';

describe('the connect pipeline, when it works', () => {
  it('runs the steps in the order of the contract, transferring a server that is not there', async () => {
    const {recording, options} = setup();
    await connect(INPUT, steps(recording), options);
    deepStrictEqual(recording.calls, [
      'checkConfigFile',
      'checkStartSettings',
      'validate',
      'checkInstallFolder',
      'preconnect',
      'decideTerms',
      'checkProxy',
      'locateClient',
      'openConnection',
      'probe',
      'plan',
      'gate',
      'transfer',
      'start',
      'cleanup',
      'openTunnel',
      'rememberPlatform',
      'applyDefaults',
    ]);
  });

  it('F-2502 5.0 step 3: the host is reported once, when the connection step opens and before the probe', async () => {
    const {recording, options} = setup();
    await connect(INPUT, steps(recording), {
      ...options,
      onHostReported: () => {
        recording.calls.push('hostReported');
      },
    });
    deepStrictEqual(
      recording.calls.filter(call =>
        ['openConnection', 'hostReported', 'probe'].includes(call),
      ),
      ['openConnection', 'hostReported', 'probe'],
    );
  });

  it('F-2502 7.E1: a connection step that fails reports no host', async () => {
    const {recording, options} = setup();
    await connect(
      INPUT,
      steps(recording, {
        openConnection: () =>
          Promise.resolve({kind: 'failed', failure: {kind: 'cancelled'}}),
      }),
      {
        ...options,
        onHostReported: () => {
          recording.calls.push('hostReported');
        },
      },
    );
    deepStrictEqual(recording.calls.includes('hostReported'), false);
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

  /** The `Platform:` lines of a connect whose terms name `platform` and whose probe reports `operatingSystem`. */
  async function platformLines(
    platform: ConnectionTerms['platform'],
    operatingSystem: 'linux' | 'darwin' | 'win32',
  ): Promise<string[]> {
    const {recording, options, logSink} = setup();
    await connect(
      INPUT,
      steps(recording, {
        decideTerms: () =>
          Promise.resolve({kind: 'done', value: {...TERMS, platform}}),
        probe: () =>
          Promise.resolve({
            kind: 'probed',
            host: {...HOST, operatingSystem},
          }),
      }),
      options,
    );
    return logSink.lines
      .map(line => line.message)
      .filter(message => message.startsWith('Platform: '));
  }

  it('F-2206 5.1 step 2 (#1835): with the platform unknown the log names the probed platform in words, once', async () => {
    deepStrictEqual(
      [
        await platformLines('unknown', 'linux'),
        await platformLines('unknown', 'darwin'),
        await platformLines('unknown', 'win32'),
      ],
      [['Platform: linux'], ['Platform: macOS'], ['Platform: windows']],
    );
  });

  it('#1835: with the platform known from the settings there is no Platform line', async () => {
    deepStrictEqual(await platformLines('linux', 'linux'), []);
  });

  /** The login shell lines a connect writes, with the probe's host given by `loginShell` or the fixture's. */
  async function shellLines(loginShell?: string): Promise<string[]> {
    const {recording, options, logSink} = setup();
    await connect(
      INPUT,
      steps(
        recording,
        loginShell === undefined
          ? {}
          : {
              probe: () =>
                Promise.resolve({
                  kind: 'probed',
                  host: {...HOST, loginShell},
                }),
            },
      ),
      options,
    );
    return logSink.lines
      .map(line => line.message)
      .filter(message => message.startsWith("the host's login shell"));
  }

  it('F-2704 BR-2: the probed login shell is logged once, after the platform', async () => {
    deepStrictEqual(await shellLines(), [
      "the host's login shell is /bin/sh (sh)",
    ]);
  });

  it('F-2704 BR-2: a host that reports no login shell gets no shell line', async () => {
    deepStrictEqual(await shellLines(''), []);
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

  it('F-3902 AC-10, AC-11: a plan that reuses an installed server asks the gate before the start, and transfers nothing', async () => {
    const {recording, options} = setup();
    await connect(
      INPUT,
      steps(recording, {plan: () => ({plan: REUSE})}),
      options,
    );
    deepStrictEqual(
      recording.calls.filter(call =>
        ['gate', 'transfer', 'start'].includes(call),
      ),
      ['gate', 'start'],
    );
  });

  it('F-2003 BR-6 item 2: the settings listing follows the resolver line at every resolve, a reconnection included', async () => {
    const first = setup();
    first.options.settingLines = [
      'remote.SSH.lockfilesInTmp = false',
      'remote.SSH.useFlock = true',
    ];
    await connect(INPUT, steps(first.recording), first.options);
    const again = setup();
    again.options.settingLines = ['remote.SSH.useFlock = true'];
    await connect(
      {...INPUT, attempt: 2, isReconnection: true},
      steps(again.recording),
      again.options,
    );
    function lines(sink: typeof first.logSink): string[] {
      return sink.lines.map(line => line.message).slice(0, 3);
    }
    deepStrictEqual(
      [lines(first.logSink), lines(again.logSink)],
      [
        [
          'Resolving ssh-remote+dev, attempt 1',
          'remote.SSH.lockfilesInTmp = false',
          'remote.SSH.useFlock = true',
        ],
        [
          'Resolving ssh-remote+dev, attempt 2, reconnection',
          'remote.SSH.useFlock = true',
          'Host platform: linux x64',
        ],
      ],
    );
  });

  it('F-2003 BR-5: the window start follows the settings listing at the resolve', async () => {
    const {recording, options, logSink} = setup();
    options.settingLines = ['remote.SSH.useFlock = true'];
    options.writeWindowStart = () => {
      options.logger.info('window start');
    };
    await connect(INPUT, steps(recording), options);
    deepStrictEqual(logSink.lines.map(line => line.message).slice(1, 3), [
      'remote.SSH.useFlock = true',
      'window start',
    ]);
  });

  it('F-2506 BR-10: moves the legacy settings first at every resolve of a window, a reconnection included', async () => {
    const {recording, options} = setup();
    const moves: string[] = [];
    await connect(
      INPUT,
      steps(recording, {
        migrateLegacySettings: () => {
          moves.push(`after ${recording.calls.join(',') || 'nothing'}`);
          return Promise.resolve();
        },
      }),
      options,
    );
    await connect(
      {...INPUT, attempt: 2, isReconnection: true},
      steps(recording, {
        migrateLegacySettings: () => {
          moves.push('again');
          return Promise.resolve();
        },
      }),
      options,
    );
    deepStrictEqual(moves, ['after nothing', 'again']);
  });

  it('F-2506 BR-10: does not wait for the legacy settings move, and logs one that fails', async () => {
    const {recording, options, logSink} = setup();
    const result = await connect(
      INPUT,
      steps(recording, {
        migrateLegacySettings: () => never(),
      }),
      options,
    );
    const failing = setup();
    await connect(
      INPUT,
      steps(failing.recording, {
        migrateLegacySettings: () => Promise.reject(new Error('no settings')),
      }),
      failing.options,
    );
    deepStrictEqual(
      [
        'connected' in result,
        logSink.lines.some(line => line.message.includes('did not work')),
        failing.logSink.lines
          .map(line => line.message)
          .filter(message => message.includes('legacy settings move')),
      ],
      [
        true,
        false,
        ['the legacy settings move did not work: Error: no settings'],
      ],
    );
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
      {kind: 'initializing', quiet: true},
      {kind: 'opened'},
      {kind: 'downloading'},
      {kind: 'serverDownloadPercent', percent: 40},
      {kind: 'downloadingLocally'},
      {kind: 'copyingWithScp'},
      {kind: 'installing'},
      {kind: 'settingUpTunnel'},
    ]);
  });

  /** The record a stored, live connection leaves for the next window. */
  const STORED_RECORD = {
    remotePort: 4321,
    operatingSystem: 'linux',
    architecture: 'x64',
    temporaryFolder: '/tmp',
    connectionToken: 'token',
  };

  /** The phases a connect reports when the connection's lease holds `storedRecord`, on the attempt `attempt`. */
  async function phasesWithRecord(
    storedRecord: ConnectionLease['storedRecord'],
    attempt: number,
  ): Promise<PhaseEvent[]> {
    const {recording, options} = setup();
    await connect(
      {...INPUT, attempt},
      steps(recording, {
        openConnection: () =>
          Promise.resolve({
            kind: 'done',
            value: {...leaseOf(recording), storedRecord},
          }),
      }),
      options,
    );
    return recording.phases;
  }

  it('connect-107: a connect that reuses a stored, live connection stays quiet: no stage that opens the progress before its work', async () => {
    deepStrictEqual(
      (await phasesWithRecord(STORED_RECORD, 1)).some(
        phase => phase.kind === 'opened',
      ),
      false,
    );
  });

  it('connect-107: a connect with no stored connection reports the stage with no text, which opens the progress with the title alone', async () => {
    deepStrictEqual((await phasesWithRecord(undefined, 1)).slice(0, 2), [
      {kind: 'initializing', quiet: true},
      {kind: 'opened'},
    ]);
  });

  it('connect-107: a retry after a failure, which has no stored connection either, reports it too', async () => {
    deepStrictEqual(
      (await phasesWithRecord(undefined, 2)).some(
        phase => phase.kind === 'opened',
      ),
      true,
    );
  });

  it('tells the window when the port is slow to answer', async () => {
    const {recording, options} = setup();
    await connect(
      INPUT,
      steps(recording, {
        openTunnel: (input, lease, server, onWaiting, signal, onSettingUp) => {
          onSettingUp?.();
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

describe('the connect pipeline, on a connection server another window started (card #2995, ruling-2995-shared-reuse, F-2407 6.4, F-2102 5.1)', () => {
  /** A record an earlier connection server wrote, without the held server's data folder. */
  const HELD_EARLIER = {
    remotePort: 4321,
    operatingSystem: 'linux',
    architecture: 'x64',
    temporaryFolder: '/tmp',
    connectionToken: 'held-token',
  };
  const HELD = {...HELD_EARLIER, dataFolder: '/srv/held/.server'};
  const SETUP_STEPS = ['checkInstallFolder', 'plan', 'transfer', 'start'];

  /**
   * A connect in shared mode over a lease with `lease`'s fields, with the steps' changes `changesOf` makes, in exec
   * mode unless `legacy`.
   */
  async function sharedConnect(
    lease: Partial<ConnectionLease>,
    changesOf: (recording: Recording) => Partial<ConnectSteps> = () => ({}),
    legacy = false,
  ) {
    const {recording, options: defaults} = setup();
    const options = legacy ? {...defaults, useExecServer: false} : defaults;
    const result = await connect(
      INPUT,
      steps(recording, {
        lookupBeforeConnection: () => false,
        openConnection: () =>
          Promise.resolve({
            kind: 'done',
            value: {...leaseOf(recording), waits: WAITS, ...lease},
          }),
        ...changesOf(recording),
      }),
      options,
    );
    return {result, recording};
  }

  /** The setup steps among the calls `recording` holds, in order. */
  function setupStepsOf(recording: {calls: readonly string[]}): string[] {
    return recording.calls.filter(call => SETUP_STEPS.includes(call));
  }

  it('F-2407 AC-15, 6.4 step 2: a held server that answers with its token is used as it is: no folder check, plan, install or start, and the window gets its token', async () => {
    const {result, recording} = await sharedConnect({
      startedHelper: false,
      storedRecord: HELD,
    });
    deepStrictEqual(
      {
        token:
          'connected' in result ? result.connected.connectionToken : undefined,
        port: 'serverPort' in result ? result.serverPort : undefined,
        setup: setupStepsOf(recording),
        asked: recording.calls.includes('serverAnswers'),
      },
      {token: 'held-token', port: 4321, setup: [], asked: true},
    );
  });

  it('F-2407 6.4 step 3: a held server that does not answer with its token is dropped: its tunnel closes, and the folder check, the plan, the install and the start run at the current settings', async () => {
    const {result, recording} = await sharedConnect(
      {startedHelper: false, storedRecord: HELD},
      () => ({serverAnswers: () => Promise.resolve(false)}),
    );
    deepStrictEqual(
      {
        connected: 'connected' in result,
        setup: setupStepsOf(recording),
        closes: recording.tunnelCloses,
      },
      {connected: true, setup: SETUP_STEPS, closes: 1},
    );
  });

  it('F-2407 6.4 step 3: a held server whose tunnel does not open is dropped the same way', async () => {
    let tries = 0;
    const {result, recording} = await sharedConnect(
      {startedHelper: false, storedRecord: HELD},
      seen => ({
        openTunnel: (input, lease, server, onWaiting, signal, onSettingUp) => {
          tries += 1;
          onSettingUp?.();
          return tries === 1
            ? tunnelFails()
            : Promise.resolve({kind: 'done', value: tunnelOf(seen)});
        },
      }),
    );
    deepStrictEqual(
      {connected: 'connected' in result, setup: setupStepsOf(recording)},
      {connected: true, setup: SETUP_STEPS},
    );
  });

  it('F-2407 6.4 step 3: a held server whose tunnel opens only after its bound is dropped, and the late tunnel is closed', async () => {
    let tries = 0;
    const {result, recording} = await sharedConnect(
      {
        startedHelper: false,
        storedRecord: HELD,
        waits: {probeMilliseconds: 1000, tunnelMilliseconds: 20},
      },
      seen => ({
        openTunnel: (input, lease, server, onWaiting, signal, onSettingUp) => {
          tries += 1;
          onSettingUp?.();
          const opened = {kind: 'done' as const, value: tunnelOf(seen)};
          return tries === 1
            ? new Promise(resolve => {
                setTimeout(() => {
                  resolve(opened);
                }, 60);
              })
            : Promise.resolve(opened);
        },
      }),
    );
    await new Promise(resolve => setTimeout(resolve, 80));
    deepStrictEqual(
      {
        connected: 'connected' in result,
        setup: setupStepsOf(recording),
        closes: recording.tunnelCloses,
      },
      {connected: true, setup: SETUP_STEPS, closes: 1},
    );
  });

  it('F-2413 6.4 step 1, AC-17: a take-up in legacy mode prunes the old installs in the held server’s data folder, whatever the setting now says, before the window gets its connection', async () => {
    const pruned: Array<string | undefined> = [];
    const {result, recording} = await sharedConnect(
      {startedHelper: false, storedRecord: HELD},
      seen => ({
        maintain: (input, lease, action, cancellation, host, dataFolder) => {
          seen.calls.push(action);
          pruned.push(dataFolder);
          return Promise.resolve({kind: 'done'});
        },
      }),
      true,
    );
    deepStrictEqual(
      {
        connected: 'connected' in result,
        pruned,
        order: recording.calls.filter(call =>
          ['heldServer', 'serverAnswers', 'cleanup'].includes(call),
        ),
        setup: setupStepsOf(recording),
      },
      {
        connected: true,
        pruned: ['/srv/held/.server'],
        order: ['heldServer', 'serverAnswers', 'cleanup'],
        setup: [],
      },
    );
  });

  it('ruling-2995-takeup-cleanup (corrected): with the setting on, as an editor that names no CLI source runs its direct install, the take-up prunes too, since only a direct install stores the record', async () => {
    const {recording} = await sharedConnect({
      startedHelper: false,
      storedRecord: HELD,
    });
    deepStrictEqual(
      {
        taken: recording.calls.includes('serverAnswers'),
        pruned: recording.calls.includes('cleanup'),
      },
      {taken: true, pruned: true},
    );
  });

  it('F-2506 6.1 step 2, AC-6 (ruling-2995-takeup-cleanup): a take-up prunes and then installs the default extensions in the record’s data folder, whatever the setting now says, before the window gets its connection', async () => {
    const done: Array<[string, string | undefined]> = [];
    const {result} = await sharedConnect(
      {startedHelper: false, storedRecord: HELD},
      () => ({
        maintain: (input, lease, action, cancellation, host, dataFolder) => {
          done.push([action, dataFolder]);
          return Promise.resolve({kind: 'done'});
        },
        installExtensions: (input, lease, cancellation, dataFolder) => {
          done.push(['installExtensions', dataFolder]);
          return Promise.resolve();
        },
      }),
    );
    deepStrictEqual(
      {connected: 'connected' in result, done},
      {
        connected: true,
        done: [
          ['cleanup', '/srv/held/.server'],
          ['installExtensions', '/srv/held/.server'],
        ],
      },
    );
  });

  it('ruling-2995-takeup-cleanup: a record without a data folder, from an earlier connection server, is stale: no host check, no tunnel, and the full setup', async () => {
    const {result, recording} = await sharedConnect({
      startedHelper: false,
      storedRecord: HELD_EARLIER,
    });
    deepStrictEqual(
      {
        connected: 'connected' in result,
        checked: recording.calls.includes('heldServer'),
        asked: recording.calls.includes('serverAnswers'),
        setup: setupStepsOf(recording),
      },
      {connected: true, checked: false, asked: false, setup: SETUP_STEPS},
    );
  });

  it('ruling-2995-held-server: a held server the host says is gone, or that runs on another port, is dropped before any tunnel opens to it', async () => {
    const outcomes = [
      {
        kind: 'notAlive' as const,
        reason: 'no server of this commit runs there',
      },
      {kind: 'alive' as const, port: 5555},
    ];
    const seen = [];
    for (const outcome of outcomes) {
      const {result, recording} = await sharedConnect(
        {startedHelper: false, storedRecord: HELD},
        () => ({heldServer: () => Promise.resolve(outcome)}),
      );
      seen.push({
        connected: 'connected' in result,
        tunnelsBeforeStart: recording.calls
          .slice(0, recording.calls.indexOf('start'))
          .filter(call => call === 'openTunnel').length,
        asked: recording.calls.includes('serverAnswers'),
        setup: setupStepsOf(recording),
      });
    }
    deepStrictEqual(
      seen,
      Array(2).fill({
        connected: true,
        tunnelsBeforeStart: 0,
        asked: false,
        setup: SETUP_STEPS,
      }),
    );
  });

  it('F-2407 AC-7: a joined connection server with no record checks the folder after the join, and its refusal ends the connect there, before the plan', async () => {
    const refusal = {
      kind: 'invalidSetting' as const,
      reason: {id: 'installPathProvided', values: ['relative/inst']},
    };
    const {result, recording} = await sharedConnect(
      {startedHelper: false, storedRecord: undefined},
      () => ({checkInstallFolder: () => ({kind: 'failed', failure: refusal})}),
    );
    deepStrictEqual(
      {
        connected: 'connected' in result,
        probed: recording.calls.includes('probe'),
        planned: recording.calls.includes('plan'),
      },
      {connected: false, probed: true, planned: false},
    );
  });

  it('F-2407 AC-7: a connection server this window started had the folder checked by its start, so the connect checks it no second time', async () => {
    const {recording} = await sharedConnect({
      startedHelper: true,
      storedRecord: undefined,
    });
    deepStrictEqual(recording.calls.includes('checkInstallFolder'), false);
  });

  it('F-2407 AC-7: in terminal mode the folder is checked before the connection, as before', async () => {
    const {recording, options} = setup();
    await connect(INPUT, steps(recording), options);
    deepStrictEqual(
      recording.calls.indexOf('checkInstallFolder') <
        recording.calls.indexOf('openConnection'),
      true,
    );
  });
});

describe('the connect pipeline, with the client install lock (card #2844, F-2408 BR-6, 7.E2)', () => {
  it('BR-6: the lock is held from after the lookup, before the connection opens, until the server started', async () => {
    const {recording, options} = setup();
    await connect(INPUT, steps(recording), options);
    deepStrictEqual(recording.clientLock, [
      'held after locateClient',
      'released after start',
    ]);
  });

  it('6.1 step 2: a wait for the lock shows "Waiting for other windows to connect" before the connection opens', async () => {
    const {recording, options} = setup();
    await connect(
      INPUT,
      steps(recording, {
        holdClientLock: (input, onWaiting) => {
          onWaiting();
          return Promise.resolve({
            kind: 'done',
            value: {release: () => undefined},
          });
        },
      }),
      options,
    );
    deepStrictEqual(recording.phases.slice(0, 3), [
      {kind: 'initializing', quiet: true},
      {kind: 'waitingForOtherWindow'},
      {kind: 'opened'},
    ]);
  });

  it("7.E2: a lock wait that runs out is the connect's failure, with the local startup lock's reason, and no connection opens", async () => {
    const {recording, options} = setup();
    const result = await connect(
      INPUT,
      steps(recording, {
        holdClientLock: () =>
          Promise.resolve({kind: 'failed', failure: LOCAL_LOCK_TIMEOUT}),
      }),
      options,
    );
    deepStrictEqual(
      {
        kind: 'kind' in result ? result.kind : 'connected',
        reason: 'reason' in result ? result.reason : undefined,
        opened: recording.calls.includes('openConnection'),
      },
      {kind: 'lockTimeout', reason: {id: 'localLockTimeout'}, opened: false},
    );
  });

  it('BR-6: a connect that fails after it took the lock gives it back', async () => {
    const {recording, options} = setup();
    await connect(
      INPUT,
      steps(recording, {
        openConnection: () => {
          recording.calls.push('openConnection');
          return Promise.resolve({
            kind: 'failed',
            failure: {kind: 'channelClosed'},
          });
        },
      }),
      options,
    );
    deepStrictEqual(recording.clientLock, [
      'held after locateClient',
      'released after openConnection',
    ]);
  });
});

describe('the warning of the download mode (F-2406 BR-3, ruling-2878-manual-bootstrap)', () => {
  it('BR-3: a window asks for the warning once at the start of every attempt', async () => {
    const {recording, options} = setup();
    let warnings = 0;
    const counted = steps(recording, {
      warnOfDownloadMode: () => {
        warnings += 1;
      },
    });
    await connect(INPUT, counted, options);
    await connect(
      {...INPUT, attempt: 2, isReconnection: true},
      counted,
      options,
    );
    deepStrictEqual(warnings, 2);
  });
});

describe('the connect pipeline, what the log says of a resolve (card connect-65)', () => {
  /** The messages of a connect's log that belong to the resolve's own lines. */
  function resolveLines(logSink: MemorySink): string[] {
    return logSink.lines
      .map(line => line.message)
      .filter(
        message =>
          message.startsWith('Resolving ') ||
          message.startsWith('Remote server listening') ||
          message.startsWith('Resolved '),
      );
  }

  it('F-2003 BR-6: items 1, 9 and 10 in order on a successful resolve', async () => {
    const {recording, options, logSink} = setup();
    await connect(INPUT, steps(recording), options);
    deepStrictEqual(resolveLines(logSink), [
      'Resolving ssh-remote+dev, attempt 1',
      'Remote server listening on port 4321',
      'Resolved ssh-remote+dev to local port 50000',
    ]);
  });

  it('F-2003 BR-6 item 1: a reconnection is marked', async () => {
    const {recording, options, logSink} = setup();
    await connect(
      {...INPUT, attempt: 3, isReconnection: true},
      steps(recording),
      options,
    );
    deepStrictEqual(
      resolveLines(logSink)[0],
      'Resolving ssh-remote+dev, attempt 3, reconnection',
    );
  });

  it('F-2003 BR-6 item 1: the resolver line comes before the first phase', async () => {
    const {recording, options, logSink} = setup();
    const seen: string[] = [];
    await connect(INPUT, steps(recording), {
      ...options,
      onPhase: event => {
        if (seen.length === 0) {
          seen.push(
            `${event.kind} after ${String(resolveLines(logSink).length)} resolve lines`,
          );
        }
      },
    });
    deepStrictEqual(seen, ['initializing after 1 resolve lines']);
  });

  it('F-2003 BR-7: a failed resolve writes no listening or resolved line', async () => {
    const {recording, options, logSink} = setup();
    await connect(
      INPUT,
      steps(recording, {
        locateClient: () =>
          Promise.resolve({kind: 'failed', failure: {kind: 'unknown'}}),
      }),
      options,
    );
    deepStrictEqual(resolveLines(logSink), [
      'Resolving ssh-remote+dev, attempt 1',
    ]);
  });

  it('F-2201 AC-27: the failure of the lookup in terminal mode is the one the step holds it to, and no connection is opened', async () => {
    const {recording, options} = setup();
    const result = await connect(
      INPUT,
      steps(recording, {
        locateClient: () =>
          Promise.resolve({kind: 'failed', failure: {kind: 'unknown'}}),
        holdLookupFailure: () => Promise.resolve({kind: 'cancelled'}),
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

  it('F-2003 BR-6 item 9: a server on a socket has no listening line', async () => {
    const {recording, options, logSink} = setup();
    await connect(
      INPUT,
      steps(recording, {
        start: () =>
          Promise.resolve({
            ...STARTED,
            server: {
              ...STARTED.server,
              endpoint: {kind: 'socket', path: '/tmp/server.sock'},
            },
          }),
      }),
      options,
    );
    deepStrictEqual(
      resolveLines(logSink).filter(line => line.startsWith('Remote server')),
      [],
    );
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
        ['checkConfigFile', 'checkStartSettings'],
      ],
    );
  });

  it("F-2409 BR-2: start settings that fail are the connect's failure, and validate was not called", async () => {
    const {recording, options} = setup();
    const result = await connect(
      INPUT,
      steps(recording, {
        checkStartSettings: () => ({
          kind: 'failed',
          failure: {
            kind: 'invalidSetting',
            reason: {id: 'reversedPortRange', values: []},
          },
        }),
      }),
      options,
    );
    deepStrictEqual(
      [result, recording.calls],
      [
        {
          kind: 'invalidSetting',
          reason: {id: 'reversedPortRange', values: []},
          retryable: false,
          silent: false,
          userAlreadyNotified: false,
          hints: [],
          diagnostics: [],
        },
        ['checkConfigFile'],
      ],
    );
  });

  it("F-2407: an install folder that fails is the connect's failure, after the start settings and the target were checked", async () => {
    const {recording, options} = setup();
    await connect(
      INPUT,
      steps(recording, {
        checkInstallFolder: () => ({
          kind: 'failed',
          failure: {kind: 'invalidSetting'},
        }),
      }),
      options,
    );
    deepStrictEqual(recording.calls, [
      'checkConfigFile',
      'checkStartSettings',
      'validate',
    ]);
  });

  it('F-2201 AC-22: an unparsable file in effect fails the connect before the client check, naming the problem', async () => {
    const {recording, options} = setup();
    const result = await connect(
      INPUT,
      steps(recording, {
        checkConfigFile: () => ({
          kind: 'failed',
          failure: {
            kind: 'configFileUnparsable',
            reason: {text: '/h/.ssh/config: unterminated quote after Host'},
          },
        }),
      }),
      options,
    );
    deepStrictEqual(
      [result, recording.calls],
      [
        {
          kind: 'configFileUnparsable',
          reason: {text: '/h/.ssh/config: unterminated quote after Host'},
          retryable: false,
          silent: true,
          userAlreadyNotified: false,
          hints: [],
          diagnostics: [],
        },
        [],
      ],
    );
  });

  it('F-2201 BR-8: the configuration check runs first', async () => {
    const {recording, options} = setup();
    function failedCheck(): StepResult<undefined> {
      return {kind: 'failed', failure: {kind: 'invalidSetting'}};
    }
    const result = await connect(
      INPUT,
      steps(recording, {
        checkConfigFile: () => ({
          kind: 'failed',
          failure: {
            kind: 'invalidSetting',
            reason: {text: 'the file: its problem'},
          },
        }),
        checkStartSettings: failedCheck,
        validate: failedCheck,
        checkInstallFolder: failedCheck,
      }),
      options,
    );
    deepStrictEqual(
      [result, recording.calls],
      [
        {
          kind: 'invalidSetting',
          reason: {text: 'the file: its problem'},
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

  it('F-2704 AC-11: a probe that never answers fails at its limit as a timeout, with the reason the dialog shows', async () => {
    const {recording, options} = setup();
    const result = await connect(
      INPUT,
      steps(recording, {
        locateClient: waitsOf({...WAITS, probeMilliseconds: 20}),
        probe: () => never(),
      }),
      options,
    );
    deepStrictEqual(
      [
        'kind' in result ? result.kind : result,
        'reason' in result ? result.reason : result,
      ],
      ['timeout', {id: 'sshTimedOut'}],
    );
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

  /** The log lines of a connect whose connection step fails with `failure`, at warn and above, as `level: message`. */
  async function loggedWhenConnectionFails(
    failure: StepFailure,
  ): Promise<string[]> {
    const {recording, options, logSink} = setup();
    await connect(
      INPUT,
      steps(recording, {
        openConnection: () => Promise.resolve({kind: 'failed', failure}),
      }),
      options,
    );
    return logSink.lines
      .filter(line => line.level === 'warn')
      .map(line => `${line.level}: ${line.message}`);
  }

  it("connect-64: a failed connect logs ssh's exit status before the failure line, and no line of ssh's", async () => {
    deepStrictEqual(
      await loggedWhenConnectionFails({kind: 'unknown', sshExitStatus: 255}),
      ['warn: ssh exited with status 255', 'warn: connect failed: unknown'],
    );
  });

  it('connect-64: an ssh that ended on a signal', async () => {
    deepStrictEqual(
      await loggedWhenConnectionFails({kind: 'unknown', sshExitStatus: null}),
      ['warn: ssh ended on a signal', 'warn: connect failed: unknown'],
    );
  });

  it('connect-64: a failure without an exit status logs as today', async () => {
    deepStrictEqual(
      await loggedWhenConnectionFails({kind: 'unknown', logDetail: 'x'}),
      ['warn: connect failed: unknown', 'warn: the unknown failure: x'],
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

  it('F-2701 AC-24: a start that ends without a result block fails the connect as a closed channel, which F-2601 shows as its error dialog, and the tunnel is not opened', async () => {
    const {recording, options} = setup();
    const result = await connect(
      INPUT,
      steps(recording, {
        start: () =>
          Promise.resolve({kind: 'failed', failure: {kind: 'noResultBlock'}}),
      }),
      options,
    );
    deepStrictEqual(
      [
        'kind' in result ? result.kind : result,
        recording.calls.includes('openTunnel'),
      ],
      ['channelClosed', false],
    );
  });

  /** A step set whose first connection runs fail with `failures` in turn and then work, and which records its questions. */
  function brokenPipeSteps(
    recording: Parameters<typeof steps>[0],
    failures: Array<{kind: 'brokenPipe' | 'authentication'}>,
    answer: 'linux' | 'windows' | undefined,
  ): {steps: ReturnType<typeof steps>; platforms: string[]; asked: number[]} {
    const platforms: string[] = [];
    const asked: number[] = [];
    const base = steps(recording, {
      pickAfterBrokenPipe: () => {
        asked.push(platforms.length);
        return Promise.resolve(answer);
      },
    });
    return {
      platforms,
      asked,
      steps: {
        ...base,
        openConnection: async (input, terms, cancellation) => {
          platforms.push(terms.platform);
          const failure = failures[platforms.length - 1];
          return failure === undefined
            ? base.openConnection(input, terms, cancellation)
            : {kind: 'failed', failure};
        },
      },
    };
  }

  it('F-2603 AC-19 (a): a broken pipe from the connection asks the platform before any failure, tries it at once, and a second broken pipe is returned with no second question', async () => {
    const {recording, options} = setup();
    const outcome = brokenPipeSteps(
      recording,
      [{kind: 'brokenPipe'}, {kind: 'brokenPipe'}],
      'linux',
    );
    const result = await connect(INPUT, outcome.steps, options);
    deepStrictEqual(
      [
        'kind' in result ? result.kind : result,
        outcome.platforms,
        outcome.asked,
      ],
      ['brokenPipe', ['unknown', 'linux'], [1]],
    );
  });

  it('F-2603 AC-19 (c): no choice returns the first broken pipe and runs no ssh again', async () => {
    const {recording, options} = setup();
    const outcome = brokenPipeSteps(
      recording,
      [{kind: 'brokenPipe'}],
      undefined,
    );
    const result = await connect(INPUT, outcome.steps, options);
    deepStrictEqual(
      [
        'kind' in result ? result.kind : result,
        outcome.platforms,
        outcome.asked,
      ],
      ['brokenPipe', ['unknown'], [1]],
    );
  });

  it('F-2603 AC-19 (d): a choice and then a working outcome connects with the chosen platform', async () => {
    const {recording, options} = setup();
    const outcome = brokenPipeSteps(
      recording,
      [{kind: 'brokenPipe'}],
      'windows',
    );
    const result = await connect(INPUT, outcome.steps, options);
    deepStrictEqual(
      ['connected' in result, outcome.platforms, outcome.asked],
      [true, ['unknown', 'windows'], [1]],
    );
  });

  it('F-2603 AC-19 (f): a cancel while the platform is being asked, which leaves the pick unanswered, ends the connect as cancelled and not as the broken pipe, with no second try', async () => {
    const {recording, options} = setup();
    const controller = new AbortController();
    const outcome = brokenPipeSteps(recording, [{kind: 'brokenPipe'}], 'linux');
    const result = await connect(
      INPUT,
      {
        ...outcome.steps,
        pickAfterBrokenPipe: () => {
          controller.abort();
          return Promise.resolve(undefined);
        },
      },
      {...options, cancellation: controller.signal},
    );
    deepStrictEqual(
      ['kind' in result ? result.kind : result, outcome.platforms],
      ['cancelled', ['unknown']],
    );
  });

  it('F-2603 AC-19 (e): a failure of another kind asks nothing', async () => {
    const {recording, options} = setup();
    const outcome = brokenPipeSteps(
      recording,
      [{kind: 'authentication'}],
      'linux',
    );
    const result = await connect(INPUT, outcome.steps, options);
    deepStrictEqual(
      [
        'kind' in result ? result.kind : result,
        outcome.platforms,
        outcome.asked,
      ],
      ['authentication', ['unknown'], []],
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

  it('F-2410 AC-14: a tunnel that does not open leaves the platform unwritten, so a retry asks again', async () => {
    const {recording, options} = setup();
    await connect(
      INPUT,
      steps(recording, {
        openTunnel: tunnelFails,
      }),
      options,
    );
    deepStrictEqual(recording.calls.includes('rememberPlatform'), false);
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

  /** The recording of a connect whose start found the server already running. */
  async function connectReusing(): Promise<
    ReturnType<typeof setup>['recording']
  > {
    const {recording, options} = setup();
    await connect(
      INPUT,
      steps(recording, {start: () => Promise.resolve(REUSED)}),
      options,
    );
    return recording;
  }

  it('ruling-2995-takeup-cleanup (2): on a server that was already running, the full flow prunes and then installs the default extensions, both in the folder its plan names', async () => {
    const {recording, options} = setup();
    const folders: Array<[string, string | undefined]> = [];
    await connect(
      INPUT,
      steps(recording, {
        start: () => Promise.resolve(REUSED),
        maintain: (input, lease, action, cancellation, host, dataFolder) => {
          folders.push([action, dataFolder]);
          return Promise.resolve({kind: 'done'});
        },
        installExtensions: (input, lease, cancellation, dataFolder) => {
          folders.push(['installExtensions', dataFolder]);
          return Promise.resolve();
        },
      }),
      options,
    );
    deepStrictEqual(folders, [
      ['cleanup', '/home/dev/.server'],
      ['installExtensions', '/home/dev/.server'],
    ]);
  });

  it('F-2413 6.4 step 1: a fresh direct install, a server this connect started, prunes the old installs and installs no default extensions', async () => {
    const {recording, options} = setup();
    await connect(INPUT, steps(recording), options);
    deepStrictEqual(
      recording.calls.filter(call =>
        ['start', 'cleanup', 'installExtensions'].includes(call),
      ),
      ['start', 'cleanup'],
    );
  });

  it('installs the default extensions on a server that was already running', async () => {
    deepStrictEqual(
      (await connectReusing()).calls.includes('installExtensions'),
      true,
    );
  });

  it('F-2413 6.4 step 1: the connect prunes the older installs once the server runs, before the tunnel opens', async () => {
    const {recording, options} = setup();
    await connect(INPUT, steps(recording), options);
    deepStrictEqual(
      recording.calls.filter(call =>
        ['start', 'cleanup', 'openTunnel'].includes(call),
      ),
      ['start', 'cleanup', 'openTunnel'],
    );
  });

  it('F-2413.BR-9: the clean-up gets the probed host, so it takes the locks as the install did', async () => {
    const {recording, options} = setup();
    const hosts: Array<string | undefined> = [];
    await connect(
      INPUT,
      steps(recording, {
        maintain: (input, lease, action, cancellation, host) => {
          hosts.push(host?.operatingSystem);
          return Promise.resolve({kind: 'done'});
        },
      }),
      options,
    );
    deepStrictEqual(hosts, ['linux']);
  });

  it('F-2413 6.4 step 5: a connect that reuses the running server prunes too', async () => {
    deepStrictEqual((await connectReusing()).calls.includes('cleanup'), true);
  });

  it('F-2413 6.4 step 8: a clean-up that cannot run is logged and the connect goes on', async () => {
    const {recording, options, logSink} = setup();
    const result = await connect(
      INPUT,
      steps(recording, {
        maintain: () => Promise.reject(new Error('the channel broke')),
      }),
      options,
    );
    deepStrictEqual(
      [
        'connected' in result,
        logSink.lines
          .map(line => line.message)
          .filter(message => message.includes('clean-up')),
      ],
      [
        true,
        ['the clean-up of old installs did not work: Error: the channel broke'],
      ],
    );
  });

  it('F-2413 6.4: a clean-up that ends in another status than done is logged and the connect goes on', async () => {
    const {recording, options, logSink} = setup();
    const result = await connect(
      INPUT,
      steps(recording, {
        maintain: () => Promise.resolve({kind: 'noResultBlock'}),
      }),
      options,
    );
    deepStrictEqual(
      [
        'connected' in result,
        logSink.lines
          .map(line => line.message)
          .filter(message => message.includes('clean-up')),
      ],
      [true, ['the clean-up of old installs ended with noResultBlock']],
    );
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
        dataFolder: '/home/dev/.server',
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
        linkAgent: (lease, plan) => {
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

  it('F-2401 (ruling-253-helper): a start that found no requirements helper warns once, and the connect goes on', async () => {
    const {recording, options, logSink} = setup();
    const result = await connect(
      INPUT,
      steps(recording, {
        start: () =>
          Promise.resolve({
            ...STARTED,
            notices: [{kind: 'requirementsHelperMissing'}],
          }),
      }),
      options,
    );
    deepStrictEqual(
      [
        'connected' in result,
        logSink.lines
          .filter(line => line.level === 'warn')
          .map(line => line.message),
      ],
      [
        true,
        [
          "the server has no requirements helper; the host's requirements weren't checked",
        ],
      ],
    );
  });

  it('#2566: the log says whether the shared record was stored, declined by the connection, or not stored for a socket endpoint', async () => {
    const lines: string[][] = [];
    for (const behaviour of ['stored', 'declined', 'socket'] as const) {
      const {recording, options, logSink} = setup();
      await connect(
        INPUT,
        steps(recording, {
          ...(behaviour === 'socket'
            ? {
                start: () =>
                  Promise.resolve({
                    ...STARTED,
                    server: {
                      ...STARTED.server,
                      endpoint: {kind: 'socket', path: '/tmp/code-x'},
                    },
                  }),
              }
            : {}),
          ...(behaviour === 'declined'
            ? {
                openConnection: () =>
                  Promise.resolve({
                    kind: 'done',
                    value: {
                      ...leaseOf(recording),
                      storeSharedRecord: () => Promise.resolve(false),
                    },
                  }),
              }
            : {}),
        }),
        options,
      );
      lines.push(
        logSink.lines
          .map(line => line.message)
          .filter(message => message.includes('shared record')),
      );
    }
    deepStrictEqual(lines, [
      ['the shared record was stored'],
      ['the shared record was declined by the connection'],
      ["no shared record is stored: the server's endpoint is a socket"],
    ]);
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
    checkSession: () => Promise<SessionCheck>;
    recording: Recording;
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
      checkSession: () => result.checkSession(),
      recording,
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

  it('F-2505 AC-25: the connection asks its lease whether the session answers, and gives the answer', async () => {
    const {checkSession, recording} = await connected();
    recording.sessionCheck = 'ended';
    deepStrictEqual(
      [await checkSession(), recording.releasesAtCheck],
      ['ended', [0]],
    );
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

describe('the default forwarded ports of a connect (card connect-40)', () => {
  const FRESH = {...INPUT, isReconnection: false};
  const RECONNECTION = {...INPUT, attempt: 2, isReconnection: true};

  /** How often `applyDefaults` ran in a connect of `input`, with `changes` to the steps. */
  async function applied(
    input: typeof INPUT,
    changes: Partial<ConnectSteps> = {},
  ) {
    const {recording, options, logSink} = setup();
    let count = 0;
    const result = await connect(
      input,
      steps(recording, {
        applyDefaults: () => {
          count += 1;
          return Promise.resolve();
        },
        ...changes,
      }),
      options,
    );
    return {count, result, logSink};
  }

  it('F-2507 BR-5: a connect that works and is not a reconnection applies the defaults once', async () => {
    deepStrictEqual((await applied(FRESH)).count, 1);
  });

  it('F-2507 BR-5: a reconnection does not apply them', async () => {
    deepStrictEqual((await applied(RECONNECTION)).count, 0);
  });

  it('F-2507 BR-5: a first resolve that fails applies nothing, and its Retry, still not a reconnection, applies them once', async () => {
    const {recording, options} = setup();
    let count = 0;
    const counting = {
      applyDefaults: () => {
        count += 1;
        return Promise.resolve();
      },
    };
    await connect(
      FRESH,
      steps(recording, {...counting, openTunnel: tunnelFails}),
      options,
    );
    const failedCount = count;
    await connect(FRESH, steps(recording, counting), options);
    deepStrictEqual([failedCount, count], [0, 1]);
  });

  it('F-2507 W4: the connect still resolves when the defaults never settle', async () => {
    const {result} = await applied(FRESH, {
      applyDefaults: () => new Promise<void>(() => undefined),
    });
    deepStrictEqual('connected' in result, true);
  });

  it('F-2507 W4: a rejection of the defaults is logged at warn and does not fail the connect', async () => {
    const {result, logSink} = await applied(FRESH, {
      applyDefaults: () => Promise.reject(new Error('no tunnel service')),
    });
    await new Promise(resolve => setImmediate(resolve));
    deepStrictEqual(
      [
        'connected' in result,
        logSink.lines
          .filter(line => line.message.includes('the default forwards'))
          .map(line => [line.level, line.message]),
      ],
      [
        true,
        [
          [
            'warn',
            'the default forwards did not work: Error: no tunnel service',
          ],
        ],
      ],
    );
  });
});

describe('the client lookup of a connect (card connect-57)', () => {
  it('F-2101 AC-14: in shared mode the pipeline runs no lookup, and the probe is bound by the waits the connection brings', async () => {
    const {recording, options} = setup();
    const started = Date.now();
    const result = await connect(
      INPUT,
      steps(recording, {
        lookupBeforeConnection: () => false,
        openConnection: () =>
          Promise.resolve({
            kind: 'done',
            value: {
              ...leaseOf(recording),
              waits: {probeMilliseconds: 20, tunnelMilliseconds: 20},
            },
          }),
        probe: () => never(),
      }),
      options,
    );
    deepStrictEqual(
      [
        'kind' in result ? result.kind : result,
        recording.calls.includes('locateClient'),
        Date.now() - started < 500,
      ],
      ['timeout', false, true],
    );
  });

  it('F-2101 6.5 step 3: in terminal mode the lookup comes first and its waits bind the probe', async () => {
    const {recording, options} = setup();
    await connect(
      INPUT,
      steps(recording, {
        lookupBeforeConnection: () => true,
        locateClient: waitsOf({...WAITS, probeMilliseconds: 20}),
        probe: () => never(),
      }),
      options,
    );
    deepStrictEqual(
      recording.calls.slice(
        recording.calls.indexOf('decideTerms'),
        recording.calls.indexOf('openConnection') + 1,
      ),
      ['decideTerms', 'checkProxy', 'openConnection'],
    );
  });

  it('F-2404 7.E1: in terminal mode a rejected proxy value fails the connect before the lookup', async () => {
    const {recording, options} = setup();
    const result = await connect(
      INPUT,
      steps(recording, {
        lookupBeforeConnection: () => true,
        checkProxy: () => ({
          kind: 'failed',
          failure: {kind: 'invalidSetting', reason: {text: 'rejected'}},
        }),
      }),
      options,
    );
    deepStrictEqual(
      [
        'kind' in result ? result.kind : result,
        recording.calls.includes('locateClient'),
        recording.calls.includes('openConnection'),
      ],
      ['invalidSetting', false, false],
    );
  });

  it('F-2404 BR-3: in shared mode the connect leaves the proxy check to the start of a helper', async () => {
    const {recording, options} = setup();
    await connect(
      INPUT,
      steps(recording, {lookupBeforeConnection: () => false}),
      options,
    );
    deepStrictEqual(recording.calls.includes('checkProxy'), false);
  });

  it('contracts: a connection opened with no waits and no lookup is a defect, and the connect fails as unknown', async () => {
    const {recording, options} = setup();
    const result = await connect(
      INPUT,
      steps(recording, {lookupBeforeConnection: () => false}),
      options,
    );
    deepStrictEqual(
      ['kind' in result ? result.kind : result, recording.releases],
      ['unknown', 1],
    );
  });
});
