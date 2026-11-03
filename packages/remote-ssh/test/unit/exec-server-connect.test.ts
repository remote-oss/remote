import {deepStrictEqual} from 'node:assert';
import type {Failed, FailureHint} from 'lib-authority';
import type {CliScript} from 'lib-server/testing/fake-cli';
import type {WatchedExecServer} from 'lib-server';
import {
  connect,
  connectControl,
  type ConnectOptions,
  type ControlConnection,
  type TransportEvent,
} from '../../src/pipeline/connect.ts';
import {connectorOf} from '../../src/pipeline/connector.ts';
import {
  EXEC_SERVER_LOST,
  EXEC_SERVER_NO_CLI,
  EXEC_SERVER_SETTING_OFF,
} from '../../src/pipeline/failure.ts';
import type {ConnectSteps} from '../../src/pipeline/steps.ts';
import {
  anyToken,
  type Bridged,
  type Changes,
  CLI_INPUT,
  cliSteps,
  DIRECT_PLAN,
  endTunnel,
  failing,
  INPUT,
  type Recording,
  requiringControlTokens,
  setup,
} from './pipeline.fixture.ts';

const DOWNLOAD_404 = {
  kind: 'failed',
  failure: {kind: 'serverDownload', cause: 'downloadFailed', status: 404},
} as unknown as Awaited<ReturnType<ConnectSteps['installCli']>>;

const NO_READY_LINE = {
  kind: 'failed',
  failure: {kind: 'serverStart', detail: 'no ready line'},
} as unknown as Awaited<ReturnType<ConnectSteps['startCli']>>;

const SETTING_OFF_TEXT =
  'The exec server is off: the setting remote.SSH.useExecServer is false.';

const NO_CLI_TEXT =
  'The exec server is not available for this host: there is no command-line program for its platform.';

const NOT_SET_UP =
  'The exec server could not be set up on the host: its command-line program did not start.';

/** Runs one connect for an exec server over the CLI path. */
async function controlled(
  changes: Changes = () => ({}),
  adjust: (options: ConnectOptions) => ConnectOptions = options => options,
  script?: CliScript,
) {
  const {recording, options, logSink} = setup();
  const bridged: Bridged = {controlEndings: 0};
  const result = await connectControl(
    CLI_INPUT,
    cliSteps(recording, bridged, script, changes),
    adjust(options),
  );
  return {
    result,
    recording,
    bridged,
    messages: () => logSink.lines.map(line => line.message),
  };
}

/** The connection of a connect that held its control connection; anything else fails the row. */
function heldOf(result: ControlConnection | Failed): ControlConnection {
  if (!('control' in result)) {
    throw new Error(`the connect failed: ${result.kind}`);
  }
  return result;
}

/** The text of a failure's reason, or its kind when it has none. */
function reasonOf(result: ControlConnection | Failed): string {
  if ('control' in result) {
    return 'held';
  }
  const {reason} = result;
  return reason !== undefined && 'text' in reason ? reason.text : result.kind;
}

/** Steps whose plan is a direct install of the server, as a host with no command-line program, or the setting off, plans. */
function directInstall(recording: Recording): Partial<ConnectSteps> {
  return {
    plan: () => {
      recording.calls.push('plan');
      return {plan: DIRECT_PLAN};
    },
  };
}

describe('the connect for an exec server', () => {
  it('brief-remote-ssh-engines §2: holds the authenticated control connection', async () => {
    const {result} = await controlled();
    deepStrictEqual(Object.keys(heldOf(result)).sort(), [
      'control',
      'onTransport',
      'release',
    ]);
  });

  it('brief-remote-ssh-engines §2: sends no serve, since no server on the host belongs to the window', async () => {
    const {recording} = await controlled();
    deepStrictEqual(
      recording.program?.requests.filter(request => request.method === 'serve'),
      [],
    );
  });

  it('brief-remote-ssh-engines §2: opens no bridge and no window tunnel for a server', async () => {
    const {bridged} = await controlled();
    deepStrictEqual(bridged.serveParams, undefined);
  });

  it('brief-remote-ssh-engines §2: authenticates with the control token', async () => {
    const {recording} = await controlled();
    deepStrictEqual(
      recording.program?.requests.some(
        request => request.method === 'challenge_verify',
      ),
      true,
    );
  });

  it('brief-remote-ssh-engines §2: the window’s own connect keeps its control connection for its exec server', async () => {
    const {recording, options} = setup();
    const result = await connect(
      CLI_INPUT,
      cliSteps(recording, {controlEndings: 0}),
      options,
    );
    deepStrictEqual('control' in result, true);
  });

  it('brief-remote-ssh-engines §2: with remote.SSH.useExecServer off, the plan is a direct install and the connect refuses with the setting', async () => {
    const {result} = await controlled(directInstall, options => ({
      ...options,
      useExecServer: false,
    }));
    deepStrictEqual(reasonOf(result), SETTING_OFF_TEXT);
  });

  it('brief-remote-ssh-engines §2: with the setting on and no command-line program for the host, the connect refuses with that reason', async () => {
    const {result} = await controlled(directInstall);
    deepStrictEqual(reasonOf(result), NO_CLI_TEXT);
  });

  it('brief-remote-ssh-engines §2: a refusal installs no server and gives the lease back', async () => {
    const {recording} = await controlled(directInstall, options => ({
      ...options,
      useExecServer: false,
    }));
    deepStrictEqual(
      [
        recording.calls.filter(call => call === 'transfer' || call === 'start'),
        recording.releases,
      ],
      [[], 1],
    );
  });

  it('brief-remote-ssh-engines §2: a refusal is a failure of the kind that does not recover by itself', async () => {
    const {result} = await controlled(directInstall, options => ({
      ...options,
      useExecServer: false,
    }));
    deepStrictEqual(
      'control' in result ? result : [result.kind, result.retryable],
      ['execServerUnavailable', false],
    );
  });

  it('brief-remote-ssh-engines §2: a command-line program that could not be installed is a failure with a reason, and no direct install follows', async () => {
    const {result, recording} = await controlled(
      failing('installCli', DOWNLOAD_404),
    );
    deepStrictEqual(
      [
        reasonOf(result),
        recording.calls.filter(
          call => call === 'plan direct' || call === 'transfer',
        ),
      ],
      [NOT_SET_UP, []],
    );
  });

  it('brief-remote-ssh-engines §2: the cause of a program that did not set up goes to the log', async () => {
    const {messages} = await controlled(failing('startCli', NO_READY_LINE));
    deepStrictEqual(
      messages().some(message =>
        message.startsWith('the execServerUnavailable failure: '),
      ),
      true,
    );
  });

  it('brief-remote-ssh-engines §2: a command-line program that did not require its token fails as serverStart', async () => {
    const {result} = await controlled(
      () => ({}),
      options => options,
      anyToken,
    );
    deepStrictEqual('control' in result ? result : result.kind, 'serverStart');
  });

  it('brief-remote-ssh-engines §2: a connect cancelled while the program is set up is the cancelled failure', async () => {
    const {recording, options} = setup();
    const controller = new AbortController();
    const result = await connectControl(
      CLI_INPUT,
      cliSteps(recording, {controlEndings: 0}, undefined, () => ({
        installCli: () => {
          controller.abort();
          return Promise.resolve(DOWNLOAD_404);
        },
      })),
      {...options, cancellation: controller.signal},
    );
    deepStrictEqual('control' in result ? result : result.kind, 'cancelled');
  });
});

/** A held control connection with the transport events it heard. */
async function holding() {
  const context = await controlled();
  const held = heldOf(context.result);
  const heard: TransportEvent[] = [];
  const stop = held.onTransport(event => {
    heard.push(event);
  });
  return {...context, held, heard, stop};
}

describe('the held control connection', () => {
  it('brief-remote-ssh-engines §2: the end of its tunnel is a lost transport', async () => {
    const {recording, heard} = await holding();
    endTunnel(recording, 'closed');
    deepStrictEqual(heard, ['lost']);
  });

  it('brief-remote-ssh-engines §2: the end of the control connection is a lost transport', async () => {
    const {recording, heard} = await holding();
    recording.program?.end();
    deepStrictEqual(heard, ['lost']);
  });

  it('brief-remote-ssh-engines §2: after the listener was stopped it hears nothing', async () => {
    const {recording, heard, stop} = await holding();
    stop();
    endTunnel(recording, 'closed');
    deepStrictEqual(heard, []);
  });

  it('brief-remote-ssh-engines §2: giving it back closes the control connection and the tunnel, and its own end is no loss', async () => {
    const {recording, held, heard} = await holding();
    held.release();
    held.release();
    deepStrictEqual(
      [recording.program?.closes(), recording.tunnelCloses, heard],
      [1, 1, []],
    );
  });

  it('brief-remote-ssh-engines §2: giving it back stops the program and gives the lease back once', async () => {
    const {recording, held} = await holding();
    held.release();
    await new Promise(resolve => {
      setImmediate(resolve);
    });
    deepStrictEqual(
      [
        recording.calls.filter(call => call.startsWith('stopCli')),
        recording.releases,
      ],
      [['stopCli 88'], 1],
    );
  });
});

/** A connector over the CLI path's steps, with the recording and the hints its resolves ended with. */
function connectorOverCli(
  changes: Changes = () => ({}),
  adjust = (options: ConnectOptions) => options,
) {
  const {recording, options} = setup();
  const bridged: Bridged = {controlEndings: 0};
  const ended: Array<readonly FailureHint[]> = [];
  const phases: string[] = [];
  function stepsFor(): ConnectSteps {
    return cliSteps(recording, bridged, requiringControlTokens(), changes);
  }
  const settings = adjust(options);
  const connector = connectorOf({
    stepsFor,
    terminalMode: () => false,
    options: {
      maximumReconnectionAttempts: settings.maximumReconnectionAttempts,
      preconnectMilliseconds: settings.preconnectMilliseconds,
      logger: settings.logger,
      serve: settings.serve,
      useExecServer: settings.useExecServer,
    },
    revealLog: () => undefined,
    applyTerminalEnvironment: () => undefined,
    resolveEnded: hints => {
      ended.push(hints);
    },
  });
  connector.onPhase(phase => {
    phases.push(phase.name);
  });
  return {connector, recording, ended, phases};
}

/** The exec server of a result, or undefined for a failure. */
function serverOf(
  result: {execServer: object} | Failed,
): WatchedExecServer | undefined {
  return 'execServer' in result
    ? (result.execServer as WatchedExecServer)
    : undefined;
}

/** How many control connections the connects made. */
function connectsOf(recording: Recording): number {
  return recording.calls.filter(call => call === 'connectControl').length;
}

describe('the connector’s exec server in the SSH window', () => {
  it('brief-remote-ssh-engines §2: is the window’s own control connection’s, made once for the window', async () => {
    const {connector} = connectorOverCli();
    await connector.connect(INPUT);
    const first = serverOf(await connector.execServer(INPUT));
    const second = serverOf(await connector.execServer(INPUT));
    deepStrictEqual([first !== undefined, first === second], [true, true]);
  });

  it('brief-remote-ssh-engines §2: makes no connect of its own', async () => {
    const {connector, recording} = connectorOverCli();
    await connector.connect(INPUT);
    await connector.execServer(INPUT);
    deepStrictEqual(connectsOf(recording), 1);
  });

  it('brief-remote-ssh-engines §2: a window that installed its server directly refuses with the reason', async () => {
    const {connector} = connectorOverCli(directInstall);
    await connector.connect(INPUT);
    const result = await connector.execServer(INPUT);
    deepStrictEqual(
      'kind' in result ? result.reason : result,
      EXEC_SERVER_NO_CLI.reason,
    );
  });

  it('brief-remote-ssh-engines §2: with the setting off the refusal names the setting', async () => {
    const {connector} = connectorOverCli(directInstall, options => ({
      ...options,
      useExecServer: false,
    }));
    await connector.connect(INPUT);
    const result = await connector.execServer(INPUT);
    deepStrictEqual(
      'kind' in result ? result.reason : result,
      EXEC_SERVER_SETTING_OFF.reason,
    );
  });

  it('brief-remote-ssh-engines §2: after the window’s transport was lost it refuses with the loss', async () => {
    const {connector, recording} = connectorOverCli();
    await connector.connect(INPUT);
    recording.bridgeLost?.({kind: 'controlClosed'});
    const result = await connector.execServer(INPUT);
    deepStrictEqual(
      'kind' in result ? result.reason : result,
      EXEC_SERVER_LOST.reason,
    );
  });

  it('brief-remote-ssh-engines §2: the owner tells the loss of the window’s transport', async () => {
    const {connector, recording} = connectorOverCli();
    await connector.connect(INPUT);
    const server = serverOf(await connector.execServer(INPUT));
    const heard: string[] = [];
    const stop = server?.onTransportLost(() => heard.push('lost'));
    recording.bridgeLost?.({kind: 'controlClosed'});
    stop?.();
    recording.bridgeLost?.({kind: 'controlClosed'});
    deepStrictEqual(heard, ['lost']);
  });

  it('brief-remote-ssh-engines §2: a new connect of the window makes a new exec server', async () => {
    const {connector} = connectorOverCli();
    await connector.connect(INPUT);
    const first = serverOf(await connector.execServer(INPUT));
    await connector.connect(INPUT);
    const second = serverOf(await connector.execServer(INPUT));
    deepStrictEqual(first === second, false);
  });

  it('brief-remote-ssh-engines §2: a target that is not an ssh one fails with no reason, before any step', async () => {
    const {connector, recording} = connectorOverCli();
    const result = await connector.execServer({
      ...INPUT,
      target: {distro: 'Ubuntu'},
    });
    deepStrictEqual(
      ['kind' in result ? result.kind : result, recording.calls],
      ['unknown', []],
    );
  });
});

describe('the connector’s exec server in a nested window', () => {
  it('brief-remote-ssh-engines §2: makes its own connect and serves its control connection', async () => {
    const {connector, recording} = connectorOverCli();
    const result = await connector.execServer(INPUT);
    deepStrictEqual(['execServer' in result, connectsOf(recording)], [true, 1]);
  });

  it('brief-remote-ssh-engines §2: holds the connection, so the next request is served by the same one', async () => {
    const {connector, recording} = connectorOverCli();
    const first = serverOf(await connector.execServer(INPUT));
    const second = serverOf(await connector.execServer(INPUT));
    deepStrictEqual([first === second, connectsOf(recording)], [true, 1]);
  });

  it('projects on #2067: when the held connection has ended, the next request makes a new connect', async () => {
    const {connector, recording} = connectorOverCli();
    const first = serverOf(await connector.execServer(INPUT));
    endTunnel(recording, 'closed');
    const again = await connector.execServer(INPUT);
    const second = serverOf(again);
    deepStrictEqual(
      [first === second, second !== undefined, connectsOf(recording)],
      [false, true, 2],
    );
  });

  it('projects on #2067: the ended connection is given back when the new connect starts', async () => {
    const {connector, recording} = connectorOverCli();
    await connector.execServer(INPUT);
    endTunnel(recording, 'closed');
    await connector.execServer(INPUT);
    deepStrictEqual(
      recording.program?.closes() !== undefined && recording.tunnelCloses >= 1,
      true,
    );
  });

  it('brief-remote-ssh-engines §2: the owner tells the loss of the connection', async () => {
    const {connector, recording} = connectorOverCli();
    const server = serverOf(await connector.execServer(INPUT));
    const heard: string[] = [];
    server?.onTransportLost(() => heard.push('lost'));
    endTunnel(recording, 'closed');
    deepStrictEqual(heard, ['lost']);
  });

  it('brief-remote-ssh-engines §2: the window’s own loss events are not told for the nested connection', async () => {
    const {connector, recording} = connectorOverCli();
    const heard: string[] = [];
    connector.onTransportLost(() => heard.push('lost'));
    await connector.execServer(INPUT);
    endTunnel(recording, 'closed');
    deepStrictEqual(heard, []);
  });

  it('brief-remote-ssh-engines §2: a refusal is the failure, and the resolve ended with no hints', async () => {
    const {connector, ended} = connectorOverCli(directInstall, options => ({
      ...options,
      useExecServer: false,
    }));
    const result = await connector.execServer(INPUT);
    deepStrictEqual(
      ['kind' in result ? result.reason : result, ended],
      [EXEC_SERVER_SETTING_OFF.reason, [[]]],
    );
  });

  it('F-2605: a connect of the nested window ends the resolve with the hints it recognised', async () => {
    const hinted = {
      kind: 'failed',
      failure: {
        kind: 'unreachable',
        hints: [{status: 'AllowTcpForwardingDisabled', message: 'm'}],
      },
    } as unknown as Awaited<ReturnType<ConnectSteps['openConnection']>>;
    const {connector, ended} = connectorOverCli(() => ({
      openConnection: () => Promise.resolve(hinted),
    }));
    await connector.execServer(INPUT);
    deepStrictEqual(ended.flat().length, 1);
  });

  it('brief-remote-ssh-engines §2: the stages of the nested connect reach the phase listeners', async () => {
    const {connector, phases} = connectorOverCli();
    await connector.execServer(INPUT);
    deepStrictEqual(phases.slice(0, 2), ['initializing', 'opened']);
  });

  it('brief-remote-ssh-engines §2: a step that throws ends the resolve and the error goes on', async () => {
    const {connector, ended} = connectorOverCli(() => ({
      checkConfigFile: () => {
        throw new Error('a step broke');
      },
    }));
    const result = await connector.execServer(INPUT);
    deepStrictEqual(
      ['kind' in result ? result.kind : result, ended.length],
      ['unknown', 1],
    );
  });

  it('brief-remote-ssh-engines §2: cancelling gives the held connection back', async () => {
    const {connector, recording} = connectorOverCli();
    await connector.execServer(INPUT);
    connector.cancel('dispose');
    deepStrictEqual(
      [recording.tunnelCloses, recording.program?.closes()],
      [1, 1],
    );
  });

  it('brief-remote-ssh-engines §2: cancelling without a held connection gives nothing back', () => {
    const {connector, recording} = connectorOverCli();
    connector.cancel('dispose');
    deepStrictEqual(recording.tunnelCloses, 0);
  });

  it('brief-remote-ssh-engines §2: a connect torn down while the program was set up is given back and fails as cancelled', async () => {
    const {connector} = connectorOverCli();
    const pending = connector.execServer(INPUT);
    connector.cancel('dispose');
    const result = await pending;
    deepStrictEqual('kind' in result ? result.kind : result, 'cancelled');
  });
});
