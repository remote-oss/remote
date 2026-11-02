import {deepStrictEqual} from 'node:assert';
import type {ConnectInput, ConnectPhase} from 'lib-authority';
import type {TransferPhase} from 'lib-server';
import type {ConnectOptions, PhaseEvent} from '../../src/pipeline/connect.ts';
import {connectorOf, type SshConnector} from '../../src/pipeline/connector.ts';
import type {ConnectSteps} from '../../src/pipeline/steps.ts';
import {
  endTunnel,
  INPUT,
  LINKED,
  type Recording,
  setup,
  STARTED,
  steps,
  tunnelFails,
} from './pipeline.fixture.ts';

/** The host's input for the fixture's connect: the same target and attempt, as the resolver host passes it. */
const HOST_INPUT: ConnectInput = {...INPUT, target: INPUT.target};

/** The connector's options from a connect's: all but the cancellation and the phase listener, which each connect has. */
function connectorOptions(
  options: ConnectOptions,
): Omit<ConnectOptions, 'cancellation' | 'onPhase'> {
  return {
    maximumReconnectionAttempts: options.maximumReconnectionAttempts,
    preconnectMilliseconds: options.preconnectMilliseconds,
    logger: options.logger,
    serve: options.serve,
    useExecServer: options.useExecServer,
  };
}

/** A connector over the fixture's steps, with the recording, and a log the details reveal counts in. */
function connectorFor(
  changes: Partial<ConnectSteps> = {},
  terminalMode: () => boolean = () => false,
): {
  connector: SshConnector;
  recording: Recording;
  revealed: string[];
  environments: Array<Readonly<Record<string, string>>>;
} {
  const {recording, options} = setup();
  const revealed: string[] = [];
  const environments: Array<Readonly<Record<string, string>>> = [];
  return {
    connector: connectorOf({
      stepsFor: () => steps(recording, changes),
      terminalMode,
      options: connectorOptions(options),
      revealLog: () => {
        revealed.push('log');
      },
      applyTerminalEnvironment: variables => {
        environments.push(variables);
      },
    }),
    recording,
    revealed,
    environments,
  };
}

describe('the connector over the connect pipeline', () => {
  it('contracts §3.2: a connect that works gives the connection the window gets', async () => {
    const {connector} = connectorFor();
    const result = await connector.connect(HOST_INPUT);
    deepStrictEqual('address' in result ? result.address.port : result, 50000);
  });

  it("F-2311.AC-6, F-2312.AC-5: a connect that works gives the window's terminals exactly its plans' variables", async () => {
    const {connector, environments} = connectorFor({
      planForwarding: () => Promise.resolve(LINKED),
    });
    await connector.connect(HOST_INPUT);
    deepStrictEqual(environments, [
      {
        SSH_AUTH_SOCK: '/tmp/vscode-ssh-auth-sock-42',
        DISPLAY: 'localhost:10.0',
      },
    ]);
  });

  it("F-2311.AC-6, F-2312.AC-5: a connect with none plans gives the window's terminals no variables", async () => {
    const {connector, environments} = connectorFor();
    await connector.connect(HOST_INPUT);
    deepStrictEqual(environments, [{}]);
  });

  it("F-2311 7.E6: a connect that fails leaves the window's terminal variables as they were", async () => {
    const {connector, environments} = connectorFor({openTunnel: tunnelFails});
    await connector.connect(HOST_INPUT);
    deepStrictEqual(environments, []);
  });

  it('contracts §3.2: a connect that fails gives the failure', async () => {
    const {connector} = connectorFor({openTunnel: tunnelFails});
    const result = await connector.connect(HOST_INPUT);
    deepStrictEqual('kind' in result ? result.kind : result, 'channelClosed');
  });

  it('contracts §3.2: a target that is not an ssh one fails with no reason, before any step', async () => {
    const {connector, recording} = connectorFor();
    const result = await connector.connect({
      ...HOST_INPUT,
      target: {distro: 'Ubuntu'},
    });
    deepStrictEqual(
      [
        'kind' in result ? [result.kind, result.reason] : result,
        recording.calls,
      ],
      [['unknown', undefined], []],
    );
  });

  /** What the phase listeners hear for a connect whose transfer reports `phase`. */
  async function phasesHeard(phase: TransferPhase): Promise<ConnectPhase[]> {
    const {connector} = connectorFor({
      transfer: (...given) => {
        const onPhase = given[4];
        onPhase(phase);
        return Promise.resolve({
          kind: 'transferred',
          installFolder: '/home/dev/.server/bin/abc',
        });
      },
    });
    const heard: ConnectPhase[] = [];
    connector.onPhase(given => {
      heard.push(given);
    });
    await connector.connect(HOST_INPUT);
    return heard;
  }

  it('F-2304: the stages of the connect reach the phase listeners', async () => {
    deepStrictEqual((await phasesHeard({kind: 'downloading'})).slice(0, 3), [
      {name: 'initializing', details: true, quiet: true},
      {name: 'startingServer'},
      {name: 'downloading'},
    ]);
  });

  /** The phases heard for a connect to the tunnel, in the mode `terminalMode` says. */
  async function tunnelPhasesHeard(
    terminalMode: () => boolean,
  ): Promise<ConnectPhase[]> {
    const {connector} = connectorFor({}, terminalMode);
    const heard: ConnectPhase[] = [];
    connector.onPhase(given => {
      heard.push(given);
    });
    await connector.connect(HOST_INPUT);
    return heard;
  }

  it('F-2304 3.4: in shared mode the tunnel stage carries no details link', async () => {
    deepStrictEqual(
      (await tunnelPhasesHeard(() => false)).find(
        given => given.name === 'settingUpTunnel',
      ),
      {name: 'settingUpTunnel', quiet: true},
    );
  });

  it('F-2308 6.1 step 4: in terminal mode the tunnel stage carries the details link', async () => {
    deepStrictEqual(
      (await tunnelPhasesHeard(() => true)).find(
        given => given.name === 'settingUpTunnel',
      ),
      {name: 'settingUpTunnel', details: true, quiet: true},
    );
  });

  it('contracts §3.2: the mode is read once for a connect, at its start', async () => {
    let calls = 0;
    const heard = await tunnelPhasesHeard(() => {
      calls += 1;
      return calls === 1;
    });
    deepStrictEqual(
      [calls, heard.find(given => given.name === 'settingUpTunnel')],
      [1, {name: 'settingUpTunnel', details: true, quiet: true}],
    );
  });

  it('contracts §3.2: no stage but initializing and the terminal tunnel stage carries the link', async () => {
    deepStrictEqual(
      (await tunnelPhasesHeard(() => true))
        .filter(given => given.details === true)
        .map(given => given.name),
      ['initializing', 'settingUpTunnel'],
    );
  });

  it('F-2304: a percentage stage keeps its share', async () => {
    const heard = await phasesHeard({
      kind: 'progress',
      step: 'download',
      percent: 40,
    });
    deepStrictEqual(
      heard.find(given => given.name === 'serverDownloadPercent'),
      {name: 'serverDownloadPercent', percent: 40},
    );
  });

  it('contracts §3.2: a removed phase listener hears nothing more', async () => {
    const {connector} = connectorFor();
    const heard: ConnectPhase[] = [];
    const remove = connector.onPhase(phase => {
      heard.push(phase);
    });
    remove();
    await connector.connect(HOST_INPUT);
    deepStrictEqual(heard, []);
  });

  it('contracts §3.2: a phase listener that throws keeps neither the others nor the connect from going on', async () => {
    const {connector} = connectorFor();
    connector.onPhase(() => {
      throw new Error('a listener fault');
    });
    const heard: ConnectPhase[] = [];
    connector.onPhase(phase => {
      heard.push(phase);
    });
    const result = await connector.connect(HOST_INPUT);
    deepStrictEqual(['address' in result, heard.length > 0], [true, true]);
  });

  it('contracts §3.2: a cancel during the connect aborts it', async () => {
    let signal: AbortSignal | undefined;
    const {connector} = connectorFor({
      decideTerms: (...given) => {
        signal = given[1];
        connector.cancel();
        return Promise.resolve({
          kind: 'failed',
          failure: {kind: 'cancelled'},
        });
      },
    });
    await connector.connect(HOST_INPUT);
    deepStrictEqual(signal?.aborted, true);
  });

  it('contracts §3.2: a cancel after a connect releases the connection once', async () => {
    const {connector, recording} = connectorFor();
    await connector.connect(HOST_INPUT);
    connector.cancel();
    connector.cancel();
    deepStrictEqual(recording.releases, 1);
  });

  it('contracts §3.2: a connection that completes after a cancel is given back, not held', async () => {
    const window: {connector?: SshConnector} = {};
    const {connector, recording} = connectorFor({
      rememberPlatform: () => {
        // The window is torn down after the tunnel opened, before the connect returns.
        window.connector?.cancel();
        return Promise.resolve();
      },
    });
    window.connector = connector;
    const result = await connector.connect(HOST_INPUT);
    connector.cancel();
    deepStrictEqual(
      ['kind' in result ? result.kind : result, recording.releases],
      ['cancelled', 1],
    );
  });

  it('F-2505: a connect after one that worked releases the first', async () => {
    const {connector, recording} = connectorFor();
    await connector.connect(HOST_INPUT);
    await connector.connect({...HOST_INPUT, attempt: 2, isReconnection: true});
    deepStrictEqual(recording.releases, 1);
  });

  /** Which transport listeners hear `notice` sent through the lease of a connection that worked. */
  async function transportHeard(
    notice: Parameters<NonNullable<Recording['notice']>>[0],
  ): Promise<string[]> {
    const {connector, recording} = connectorFor();
    const heard: string[] = [];
    connector.onTransportLost(() => {
      heard.push('lost');
    });
    connector.onTransportClosed(() => {
      heard.push('closed');
    });
    await connector.connect(HOST_INPUT);
    recording.notice?.(notice);
    return heard;
  }

  it('contracts §3.2: a lost transport reaches the lost listeners only', async () => {
    deepStrictEqual(await transportHeard({type: 'transportLost'}), ['lost']);
  });

  it('contracts §3.2: the end of the connection server reaches the closed listeners', async () => {
    deepStrictEqual(await transportHeard({type: 'helperGone'}), ['closed']);
  });

  it('contracts §3.2: a connection given back by a cancel is not heard any more', async () => {
    const {connector, recording} = connectorFor();
    const heard: string[] = [];
    connector.onTransportLost(() => {
      heard.push('lost');
    });
    await connector.connect(HOST_INPUT);
    const send = recording.notice;
    connector.cancel();
    send?.({type: 'transportLost'});
    deepStrictEqual([heard, recording.notice], [[], undefined]);
  });

  /** A connector holding a connection that worked, with what its lost listeners hear. */
  async function heldConnector() {
    const {connector, recording} = connectorFor();
    const heard: string[] = [];
    connector.onTransportLost(() => {
      heard.push('lost');
    });
    await connector.connect(HOST_INPUT);
    return {connector, recording, heard};
  }

  it('F-2505 BR-1: a held connection whose tunnel ends reaches the lost listeners', async () => {
    const {recording, heard} = await heldConnector();
    endTunnel(recording, 'listener failed');
    deepStrictEqual(heard, ['lost']);
  });

  it('contracts §3.2: a tunnel end after a cancel is not heard any more', async () => {
    const {connector, recording, heard} = await heldConnector();
    connector.cancel();
    endTunnel(recording, 'listener failed');
    deepStrictEqual(heard, []);
  });

  /**
   * A connector whose connection step reports `events`, with the sink its log writes to; the phases it tells and the
   * lines it logs are what the rows below read.
   */
  function connectorReporting(...events: PhaseEvent[]): {
    connector: SshConnector;
    logSink: ReturnType<typeof setup>['logSink'];
  } {
    const {recording, options, logSink} = setup();
    const connector = connectorOf({
      stepsFor: onPhase =>
        steps(recording, {
          openConnection: (...given) => {
            events.forEach(onPhase);
            return steps(recording).openConnection(...given);
          },
        }),
      terminalMode: () => false,
      options: connectorOptions(options),
      revealLog: () => undefined,
      applyTerminalEnvironment: () => undefined,
    });
    return {connector, logSink};
  }

  /** The phases heard for a connect whose connection step reports `events`. */
  async function phasesHeardAfter(
    ...events: PhaseEvent[]
  ): Promise<ConnectPhase[]> {
    const {connector} = connectorReporting(...events);
    const heard: ConnectPhase[] = [];
    connector.onPhase(given => {
      heard.push(given);
    });
    await connector.connect(HOST_INPUT);
    return heard;
  }

  /** The progress lines a connect whose connection step reports `events` writes to the log. */
  async function progressLogged(...events: PhaseEvent[]): Promise<string[]> {
    const {connector, logSink} = connectorReporting(...events);
    await connector.connect(HOST_INPUT);
    return logSink.lines
      .map(line => line.message)
      .filter(
        message =>
          message.startsWith('Progress:') ||
          message.startsWith('Downloading VS Code Server:'),
      );
  }

  it('F-2003 BR-6 item 8: the steps and percents the notification shows are logged', async () => {
    deepStrictEqual(
      await progressLogged(
        {kind: 'installing'},
        {kind: 'serverDownloadPercent', percent: 0},
        {kind: 'serverDownloadPercent', percent: 50},
        {kind: 'serverDownloadPercent', percent: 100},
      ),
      [
        'Progress: installing',
        'Downloading VS Code Server: 0%',
        'Downloading VS Code Server: 50%',
        'Downloading VS Code Server: 100%',
        'Progress: startingServer',
        'Progress: settingUpTunnel',
      ],
    );
  });

  it('F-2003 BR-6 item 8: a quiet step and a shown prompt, which change no step of the notification, log no progress', async () => {
    deepStrictEqual(
      await progressLogged(
        {kind: 'initializing', quiet: true},
        {kind: 'promptShown'},
        {kind: 'initializing'},
      ),
      [
        'Progress: initializing',
        'Progress: startingServer',
        'Progress: settingUpTunnel',
      ],
    );
  });

  it('contracts: a stage a step reports through the listener it was given reaches the phase listeners', async () => {
    deepStrictEqual(
      (await phasesHeardAfter({kind: 'waitingForOtherWindow'})).some(
        phase => phase.name === 'waitingForOtherWindow',
      ),
      true,
    );
  });

  it('F-2102 5.2 step 3: the waiting stage carries no details link', async () => {
    deepStrictEqual(
      (await phasesHeardAfter({kind: 'waitingForOtherWindow'})).find(
        phase => phase.name === 'waitingForOtherWindow',
      ),
      {name: 'waitingForOtherWindow'},
    );
  });

  it('F-2108 AC-3: the running script stage opens the progress, with no details link and not quiet', async () => {
    deepStrictEqual(
      (await phasesHeardAfter({kind: 'runningPreconnectScript'})).filter(
        phase => phase.name === 'runningPreconnectScript',
      ),
      [{name: 'runningPreconnectScript'}],
    );
  });

  it("F-2304 6.1: the pipeline's first initializing and the tunnel stage are quiet", async () => {
    deepStrictEqual(
      (await tunnelPhasesHeard(() => false)).filter(
        given => given.quiet === true,
      ),
      [
        {name: 'initializing', details: true, quiet: true},
        {name: 'settingUpTunnel', quiet: true},
      ],
    );
  });

  it("F-2304 BR-11: an initializing stage that is not quiet, as the login's, is told not quiet", async () => {
    deepStrictEqual(
      (await phasesHeardAfter({kind: 'initializing'})).filter(
        phase => phase.name === 'initializing',
      ),
      [
        {name: 'initializing', details: true, quiet: true},
        {name: 'initializing', details: true},
      ],
    );
  });

  it('contracts §3.2: a prompt re-tells the last stage, not quiet', async () => {
    const heard = await phasesHeardAfter(
      {kind: 'downloading'},
      {kind: 'settingUpTunnel'},
      {kind: 'promptShown'},
    );
    deepStrictEqual(heard.slice(1, 4), [
      {name: 'downloading'},
      {name: 'settingUpTunnel', quiet: true},
      {name: 'settingUpTunnel'},
    ]);
  });

  it('connect-14: each connect makes its own steps', async () => {
    const {recording, options} = setup();
    let made = 0;
    const connector = connectorOf({
      stepsFor: () => {
        made += 1;
        return steps(recording);
      },
      terminalMode: () => false,
      options: connectorOptions(options),
      revealLog: () => undefined,
      applyTerminalEnvironment: () => undefined,
    });
    await connector.connect(HOST_INPUT);
    await connector.connect({...HOST_INPUT, attempt: 2, isReconnection: true});
    deepStrictEqual(made, 2);
  });

  it('F-2509 BR-5: the held connection gives its server port', async () => {
    const {connector} = connectorFor();
    await connector.connect(HOST_INPUT);
    deepStrictEqual(connector.serverPort(), 4321);
  });

  it('F-2509 AC-19: a server that listens on a socket has no port to give', async () => {
    const {connector} = connectorFor({
      start: () =>
        Promise.resolve({
          ...STARTED,
          server: {
            ...STARTED.server,
            endpoint: {kind: 'socket', path: '/tmp/server.sock'},
          },
        }),
    });
    await connector.connect(HOST_INPUT);
    deepStrictEqual(connector.serverPort(), 'none');
  });

  it('F-2509 AC-13: before any connect there is no server port, and no throw', () => {
    const {connector} = connectorFor();
    deepStrictEqual(connector.serverPort(), 'none');
  });

  it('F-2509 AC-13: a connect that failed leaves no server port', async () => {
    const {connector} = connectorFor({openTunnel: tunnelFails});
    await connector.connect(HOST_INPUT);
    deepStrictEqual(connector.serverPort(), 'none');
  });

  it('F-2509 AC-13: once the transport is lost there is no server port until a connect works again', async () => {
    const {connector, recording} = connectorFor();
    await connector.connect(HOST_INPUT);
    recording.notice?.({type: 'transportLost'});
    deepStrictEqual(connector.serverPort(), 'none');
  });

  it('F-2509 AC-20: a connect after a lost transport gives the new server port', async () => {
    const {connector, recording} = connectorFor();
    await connector.connect(HOST_INPUT);
    recording.notice?.({type: 'transportLost'});
    await connector.connect({...HOST_INPUT, attempt: 2, isReconnection: true});
    deepStrictEqual(connector.serverPort(), 4321);
  });

  it('F-2509 AC-13: after a cancel there is no server port', async () => {
    const {connector} = connectorFor();
    await connector.connect(HOST_INPUT);
    connector.cancel();
    deepStrictEqual(connector.serverPort(), 'none');
  });

  it('F-2509: the end of the connection server keeps the port until the window connects again', async () => {
    const {connector, recording} = connectorFor();
    await connector.connect(HOST_INPUT);
    recording.notice?.({type: 'helperGone'});
    deepStrictEqual(connector.serverPort(), 4321);
  });

  it('F-2411 R1: the held connection gives its host and that it was made in default mode', async () => {
    const {connector} = connectorFor();
    await connector.connect(HOST_INPUT);
    deepStrictEqual(connector.heldHost(), {
      target: {host: 'dev'},
      terminalMode: false,
    });
  });

  it('F-2411 R1: a connection made in terminal mode says so', async () => {
    const {connector} = connectorFor({}, () => true);
    await connector.connect(HOST_INPUT);
    deepStrictEqual(connector.heldHost()?.terminalMode, true);
  });

  it('F-2411 R1: once the transport is lost, after a cancel, after a failed connect and before any connect there is no held host', async () => {
    const lostOne = connectorFor();
    await lostOne.connector.connect(HOST_INPUT);
    lostOne.recording.notice?.({type: 'transportLost'});
    const cancelled = connectorFor();
    await cancelled.connector.connect(HOST_INPUT);
    cancelled.connector.cancel();
    const failed = connectorFor({openTunnel: tunnelFails});
    await failed.connector.connect(HOST_INPUT);
    deepStrictEqual(
      [
        lostOne.connector.heldHost(),
        cancelled.connector.heldHost(),
        failed.connector.heldHost(),
        connectorFor().connector.heldHost(),
      ],
      [undefined, undefined, undefined, undefined],
    );
  });

  it('F-2304 BR-12: the details reveal the log', () => {
    const {connector, revealed} = connectorFor();
    connector.revealDetails();
    deepStrictEqual(revealed, ['log']);
  });
});
