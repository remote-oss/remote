import {deepStrictEqual} from 'node:assert';
import type {Failed} from 'lib-authority';
import type {CliServeParams, Plan, ServerLogLine} from 'lib-server';
import {
  fakeCli,
  type CliScript,
  type Request,
} from 'lib-server/testing/fake-cli';
import type {CliBridgeLoss} from '../../src/cli/cli-bridge.ts';
import {TOKEN_NOT_REQUIRED} from '../../src/cli/cli-connect.ts';
import {
  connect,
  type Connection,
  type TransportEvent,
} from '../../src/pipeline/connect.ts';
import type {ConnectSteps} from '../../src/pipeline/steps.ts';
import {
  BRIDGE_ADDRESS,
  CONTROL_TOKEN,
  leaseOf,
  LINKED,
  type Recording,
  requiringToken,
  setup,
  steps,
  tunnelOf,
} from './pipeline.fixture.ts';

/** A plan of the CLI path for the fixture's host. */
const CLI_PLAN = {
  kind: 'cli',
  download: true,
  cliDataFolder: '/home/dev/.server',
  commit: 'c1',
  notes: [],
} as unknown as Plan;

/** The direct install the fallback plans. */
const DIRECT_PLAN = {
  kind: 'download',
  where: 'host',
  clientFallback: true,
  address: 'https://example.invalid/server.tar.gz',
  installFolder: '/home/dev/.server/bin/abc',
  dataFolder: '/home/dev/.server',
  launcher: 'bin/launcher',
  lockPlace: 'folder',
  notes: [],
} as unknown as Plan;

/** A CLI that answers any token. */
function anyToken(request: Request): readonly unknown[] {
  return request.method === 'challenge_issue'
    ? [{id: request.id, result: {challenge: 'challenge-text'}}]
    : [{id: request.id, result: {}}];
}

/** A CLI that refuses every token, its own included. */
const NO_TOKEN = requiringToken('a token nobody has');

/** What the fixture's `openBridge` was given, and the events it can raise. */
interface Bridged {
  serveParams?: CliServeParams;
  onServeLog?: (line: ServerLogLine) => void;
  /** How often the end of the control connection reached the bridge. */
  controlEndings: number;
}

/** Steps that replace some of the fixture's, made over the connect's recording. */
type Changes = (recording: Recording) => Partial<ConnectSteps>;

/** The input of every connect here: window 1's first connect to `dev`. */
const CLI_INPUT = {
  target: {kind: 'plain' as const, text: 'dev'},
  rawHostString: 'dev',
  attempt: 1,
  isReconnection: false,
  windowId: 'window-1',
  windowWorkspace: undefined,
};

/** The steps of a connect that takes the CLI path, over a CLI answering `script`; `changes` replaces some steps. */
function cliSteps(
  recording: Recording,
  bridged: Bridged,
  script: CliScript = requiringToken(CONTROL_TOKEN),
  changes: Changes = () => ({}),
): ConnectSteps {
  const base = steps(recording);
  return steps(recording, {
    plan: (input, host, options) => {
      recording.calls.push(options?.direct === true ? 'plan direct' : 'plan');
      return {plan: options?.direct === true ? DIRECT_PLAN : CLI_PLAN};
    },
    connectControl: () => {
      const program = fakeCli(script);
      recording.program = program;
      recording.calls.push('connectControl');
      return Promise.resolve(program.stream);
    },
    openBridge: async (control, serveParams, events) => {
      bridged.serveParams = serveParams;
      bridged.onServeLog = line => {
        events.onServeLog(line);
      };
      events.onControlEnded(() => {
        bridged.controlEndings += 1;
      });
      return base.openBridge(control, serveParams, events);
    },
    ...changes(recording),
  });
}

/** Runs one connect over the CLI path, with what the fakes saw. */
async function connectOverCli(script?: CliScript, changes?: Changes) {
  const {recording, options, logSink} = setup();
  const bridged: Bridged = {controlEndings: 0};
  const result = await connect(
    CLI_INPUT,
    cliSteps(recording, bridged, script, changes),
    options,
  );
  return {
    result,
    recording,
    bridged,
    messages: () => logSink.lines.map(line => line.message),
  };
}

/** The connection of a connect that resolved; anything else fails the row. */
function connectedOf(result: Connection | Failed): Connection {
  if (!('onTransport' in result)) {
    throw new Error(`the connect failed: ${result.kind}`);
  }
  return result;
}

/** The kind of a connect's failure, or `connected`. */
function kindOf(result: Connection | Failed): string {
  return 'onTransport' in result ? 'connected' : result.kind;
}

/** A connect over the CLI path that resolved, with the transport events it heard after. */
async function resolved() {
  const overCli = await connectOverCli();
  const connection = connectedOf(overCli.result);
  const heard: TransportEvent[] = [];
  const stop = connection.onTransport(event => {
    heard.push(event);
  });
  return {
    ...overCli,
    connection,
    heard,
    stop,
    lose: (cause: CliBridgeLoss) => {
      overCli.recording.bridgeLost?.(cause);
    },
  };
}

/** A step that fails `name`'s way, recording that it ran. */
function failing<Name extends 'installCli' | 'startCli'>(
  name: Name,
  outcome: Awaited<ReturnType<ConnectSteps[Name]>>,
): Changes {
  return recording => ({
    [name]: () => {
      recording.calls.push(name);
      return Promise.resolve(outcome);
    },
  });
}

const DOWNLOAD_404 = {
  kind: 'failed' as const,
  failure: {
    kind: 'serverDownload' as const,
    cause: 'downloadFailed' as const,
    status: 404,
  },
};

const NO_READY_LINE = {
  kind: 'failed' as const,
  failure: {kind: 'serverStart' as const, detail: 'no ready line'},
} as unknown as Awaited<ReturnType<ConnectSteps['startCli']>>;

describe("the connect's CLI path: the token check", () => {
  it('themis on #430: a CLI that answers any token fails the connect as serverStart', async () => {
    const {result} = await connectOverCli(anyToken);
    deepStrictEqual(kindOf(result), 'serverStart');
  });

  it('themis on #430: the same failure names the token in its log detail', async () => {
    const {messages} = await connectOverCli(anyToken);
    deepStrictEqual(
      messages().some(message => message.includes(TOKEN_NOT_REQUIRED)),
      true,
    );
  });

  it('themis on #430: the same runs no fallback', async () => {
    const {recording} = await connectOverCli(anyToken);
    deepStrictEqual(
      recording.calls.filter(
        call =>
          call === 'plan direct' || call === 'transfer' || call === 'start',
      ),
      [],
    );
  });

  it('themis on #458: the same stops the CLI by its process id', async () => {
    const {recording} = await connectOverCli(anyToken);
    deepStrictEqual(recording.calls.includes('stopCli 88'), true);
  });

  it('themis on #458: the same closes the control connection and the tunnel', async () => {
    const {recording} = await connectOverCli(anyToken);
    deepStrictEqual(
      [recording.program?.closes(), recording.tunnelCloses],
      [1, 1],
    );
  });

  it('themis on #430: a CLI that refuses the wrong token with another error is not used either', async () => {
    const {result} = await connectOverCli(request =>
      request.method === 'challenge_issue'
        ? [{id: request.id, error: {code: -1, message: 'something else'}}]
        : [],
    );
    deepStrictEqual(kindOf(result), 'serverStart');
  });

  it("themis on #430: the first challenge carries a token that isn't the control token", async () => {
    const {recording} = await connectOverCli();
    const first = recording.program?.requests.find(
      request => request.method === 'challenge_issue',
    );
    deepStrictEqual(
      (first?.params as {token?: string} | undefined)?.token !== CONTROL_TOKEN,
      true,
    );
  });

  it('cli-04 §3 step 5: the second challenge carries the control token', async () => {
    const {recording} = await connectOverCli();
    const second = recording.program?.requests.filter(
      request => request.method === 'challenge_issue',
    )[1];
    deepStrictEqual(
      (second?.params as {token?: string} | undefined)?.token,
      CONTROL_TOKEN,
    );
  });
});

describe("the connect's CLI path: the window resolves", () => {
  it("F-2311 5.0 step 5: the window gets its plans, and the link is started after the CLI's result", async () => {
    const {result, recording} = await connectOverCli(undefined, () => ({
      planForwarding: () => Promise.resolve(LINKED),
    }));
    deepStrictEqual(
      [connectedOf(result).forwarding, recording.links],
      [LINKED, [LINKED.agentLink]],
    );
  });

  it("§4a: the window's address is the bridge's", async () => {
    const {connection} = await resolved();
    deepStrictEqual(connection.connected.address, BRIDGE_ADDRESS);
  });

  it("F-2409 BR-11: serve's connection token is the host's, as the CLI's start reported it", async () => {
    const {bridged} = await resolved();
    deepStrictEqual(
      bridged.serveParams?.connectionToken,
      'host-connection-token',
    );
  });

  it("§4a: the window's token is serve's connection token, and not the control token", async () => {
    const {connection, bridged} = await resolved();
    deepStrictEqual(
      [
        connection.connected.connectionToken ===
          bridged.serveParams?.connectionToken,
        connection.connected.connectionToken !== CONTROL_TOKEN,
      ],
      [true, true],
    );
  });

  it('§4a: serve names the editor commit and quality and the host download', async () => {
    const {bridged} = await resolved();
    deepStrictEqual(
      [
        bridged.serveParams?.commit,
        bridged.serveParams?.quality,
        bridged.serveParams?.useLocalDownload,
      ],
      ['c1', 'insider', false],
    );
  });

  it('contracts S10: no log line holds either token', async () => {
    const {messages, bridged} = await resolved();
    const secrets = [CONTROL_TOKEN, bridged.serveParams?.connectionToken ?? ''];
    deepStrictEqual(
      messages().filter(message =>
        secrets.some(secret => message.includes(secret)),
      ),
      [],
    );
  });

  it('F-2103 5.0 step 5: the connect resolves before any serve', async () => {
    const {recording} = await resolved();
    deepStrictEqual(
      recording.program?.requests.some(request => request.method === 'serve'),
      false,
    );
  });

  it('F-2103 5.0 step 5: the window is not trusted by the CLI path', async () => {
    const {connection} = await resolved();
    deepStrictEqual(connection.connected.trusted, false);
  });

  it("connect-14: a connect over the CLI remembers the host's platform", async () => {
    const {recording} = await resolved();
    deepStrictEqual(recording.calls.includes('rememberPlatform'), true);
  });

  it('#664: a connect over the CLI resolves though the platform write never settles', async () => {
    const {result} = await connectOverCli(undefined, () => ({
      rememberPlatform: () => new Promise<void>(() => undefined),
    }));
    deepStrictEqual(kindOf(result), 'connected');
  });

  it('V7a: the lines the CLI logs go to the log at their level', async () => {
    const {bridged, messages} = await resolved();
    bridged.onServeLog?.({text: 'Server setup complete', level: 1});
    bridged.onServeLog?.({text: 'Server started', level: 2});
    bridged.onServeLog?.({text: 'Error installing server', level: 4});
    deepStrictEqual(
      messages().filter(
        message => message.startsWith('Server') || message.startsWith('Error'),
      ),
      ['Server started', 'Error installing server'],
    );
  });

  it('V7a: a line of a level the log has no name for is logged as information', async () => {
    const {bridged, messages} = await resolved();
    bridged.onServeLog?.({text: 'an odd line', level: 9});
    deepStrictEqual(messages().includes('an odd line'), true);
  });

  it('§4: the end of the control connection reaches the bridge', async () => {
    const {recording, bridged} = await resolved();
    recording.program?.end();
    deepStrictEqual(bridged.controlEndings, 1);
  });

  it('§4: the end reaches the bridge once', async () => {
    const {recording, bridged} = await resolved();
    recording.program?.end();
    recording.program?.end();
    deepStrictEqual(bridged.controlEndings, 1);
  });
});

describe("the connect's CLI path: the fallback before the window resolves", () => {
  /** A connect whose CLI download fails. */
  function installFails(): ReturnType<typeof connectOverCli> {
    return connectOverCli(undefined, failing('installCli', DOWNLOAD_404));
  }

  /** A connect whose CLI does not start. */
  function startFails(): ReturnType<typeof connectOverCli> {
    return connectOverCli(undefined, failing('startCli', NO_READY_LINE));
  }

  it('F-3902 rule 5: a 404 for the CLI archive is not an architecture failure, the connect installs the server directly', async () => {
    const {result, recording} = await installFails();
    deepStrictEqual(
      [kindOf(result), recording.calls.includes('plan direct')],
      ['connected', true],
    );
  });

  it('§6: a CLI download that fails runs the direct install once', async () => {
    const {recording} = await installFails();
    deepStrictEqual(
      recording.calls.filter(call => call === 'transfer' || call === 'start'),
      ['transfer', 'start'],
    );
  });

  it('§6: the fallback is logged with its cause', async () => {
    const {messages} = await installFails();
    deepStrictEqual(
      messages().filter(message => message.startsWith('the CLI path failed')),
      [
        'the CLI path failed (serverDownload: downloadFailed); installing the server directly',
      ],
    );
  });

  it('§6: a CLI download that fails starts no CLI and stops none', async () => {
    const {recording} = await installFails();
    deepStrictEqual(
      recording.calls.filter(call => call.startsWith('st') && call !== 'start'),
      [],
    );
  });

  it('§6: a CLI that does not start falls back to the direct install', async () => {
    const {recording} = await startFails();
    deepStrictEqual(recording.calls.includes('plan direct'), true);
  });

  it('§6: a CLI that refuses its own token is stopped before the fallback', async () => {
    const {recording} = await connectOverCli(NO_TOKEN);
    deepStrictEqual(
      recording.calls.filter(
        call => call === 'stopCli 88' || call === 'plan direct',
      ),
      ['stopCli 88', 'plan direct'],
    );
  });

  it('§6: a CLI that refuses its own token falls back, logged', async () => {
    const {messages} = await connectOverCli(NO_TOKEN);
    deepStrictEqual(
      messages().some(message =>
        message.startsWith(
          'the CLI path failed (the CLI refused its token: challengeRefused)',
        ),
      ),
      true,
    );
  });

  it('§6: no tunnel to the CLI stops it and falls back', async () => {
    const {recording} = await connectOverCli(undefined, () => ({
      openTunnel: () =>
        Promise.resolve({
          kind: 'failed',
          failure: {kind: 'channelClosed', reason: {text: 'gone'}},
        }),
    }));
    deepStrictEqual(
      [
        recording.calls.includes('stopCli 88'),
        recording.calls.includes('plan direct'),
      ],
      [true, true],
    );
  });

  it('§6: a control port that refuses stops the CLI and falls back', async () => {
    const {recording} = await connectOverCli(undefined, () => ({
      connectControl: () => Promise.resolve(undefined),
    }));
    deepStrictEqual(
      [
        recording.calls.includes('stopCli 88'),
        recording.tunnelCloses,
        recording.calls.includes('plan direct'),
      ],
      [true, 1, true],
    );
  });

  it('§6: a bridge with no port stops the CLI and falls back', async () => {
    const {recording} = await connectOverCli(undefined, () => ({
      openBridge: () => Promise.resolve(undefined),
    }));
    deepStrictEqual(
      [
        recording.calls.includes('stopCli 88'),
        recording.calls.includes('plan direct'),
      ],
      [true, true],
    );
  });

  it('F-2104.AC-14: a bridge whose preferred range was busy stops the CLI and fails with the reason, with no direct install', async () => {
    const {recording, result} = await connectOverCli(undefined, () => ({
      openBridge: () =>
        Promise.resolve({busyRange: {first: 41060, last: 41061}}),
    }));
    deepStrictEqual(
      [
        recording.calls.includes('stopCli 88'),
        recording.calls.some(call => call.startsWith('plan direct')),
        recording.calls.includes('transfer'),
        recording.calls.includes('start'),
        'onTransport' in result ? 'connected' : result,
      ],
      [
        true,
        false,
        false,
        false,
        {
          kind: 'unknown',
          reason: {
            id: 'S067',
            values: [
              {id: 'S073', values: [{id: 'S095', values: ['41060', '41061']}]},
            ],
          },
          retryable: false,
          silent: false,
          userAlreadyNotified: false,
          hints: [],
          diagnostics: [],
        },
      ],
    );
  });

  it("§6: when the direct install fails too, the connect's failure is the direct install's", async () => {
    const {result} = await connectOverCli(undefined, recording => ({
      ...failing('installCli', DOWNLOAD_404)(recording),
      transfer: () =>
        Promise.resolve({kind: 'failed', failure: {kind: 'unpack'}}),
    }));
    deepStrictEqual(kindOf(result), 'serverInstall');
  });

  it("§6: a direct plan that fails is the connect's failure", async () => {
    const {result} = await connectOverCli(undefined, recording => ({
      ...failing('installCli', DOWNLOAD_404)(recording),
      plan: (input, host, options) =>
        options?.direct === true
          ? {failure: {kind: 'noSource'}}
          : {plan: CLI_PLAN},
    }));
    deepStrictEqual(kindOf(result), 'noServerSource');
  });

  it('§6: the CLI path is tried once per connect', async () => {
    const {recording} = await installFails();
    deepStrictEqual(
      recording.calls.filter(call => call === 'installCli').length,
      1,
    );
  });

  it('§6: a cancel during the CLI path ends the connect without the fallback', async () => {
    const {recording, options} = setup();
    const controller = new AbortController();
    const result = await connect(
      CLI_INPUT,
      cliSteps(recording, {controlEndings: 0}, undefined, () => ({
        installCli: () => {
          controller.abort();
          return Promise.resolve({
            kind: 'failed',
            failure: {kind: 'cancelled'},
          });
        },
      })),
      {...options, cancellation: controller.signal},
    );
    deepStrictEqual(
      [kindOf(result), recording.calls.includes('plan direct')],
      ['cancelled', false],
    );
  });
});

describe("the connect's CLI path: after the window resolved", () => {
  const TEMPLATE_ERROR = {kind: 'template' as const, message: 'cannot expand'};

  it('athena on #458, F-2103 7.E2: a failed serve closes the transport, never loses it', async () => {
    const {heard, lose} = await resolved();
    lose({
      kind: 'serveFailed',
      error: {kind: 'other', message: 'libstdc++ missing'},
      errorLine: undefined,
    });
    deepStrictEqual(heard, ['closed']);
  });

  it('athena on #458: a failed download is shown with the S043 reason', async () => {
    const {recording, lose} = await resolved();
    lose({
      kind: 'serveFailed',
      error: {kind: 'download', url: 'https://example.invalid/s', status: 404},
      errorLine: undefined,
    });
    deepStrictEqual(recording.presented[0]?.reason, {id: 'S043'});
  });

  it('athena on #458: another failure is shown with the S075 reason', async () => {
    const {recording, lose} = await resolved();
    lose({
      kind: 'serveFailed',
      error: {kind: 'other', message: 'libstdc++ missing'},
      errorLine: undefined,
    });
    deepStrictEqual(recording.presented[0]?.reason, {id: 'S075'});
  });

  it('§6: a bad template is logged with its kind and the error line', async () => {
    const {messages, lose} = await resolved();
    lose({
      kind: 'serveFailed',
      error: TEMPLATE_ERROR,
      errorLine: 'Error installing server: cannot expand',
    });
    deepStrictEqual(
      messages().filter(message =>
        message.startsWith('the CLI could not serve'),
      ),
      [
        'the CLI could not serve: template: Error installing server: cannot expand',
      ],
    );
  });

  it('§6: a failed serve without an error line is logged with its error', async () => {
    const {messages, lose} = await resolved();
    lose({kind: 'serveFailed', error: TEMPLATE_ERROR, errorLine: undefined});
    deepStrictEqual(
      messages().filter(message =>
        message.startsWith('the CLI could not serve'),
      ),
      [`the CLI could not serve: template: ${JSON.stringify(TEMPLATE_ERROR)}`],
    );
  });

  it('contracts §W2: the end of the control connection loses the transport', async () => {
    const {heard, lose} = await resolved();
    lose({kind: 'controlClosed'});
    deepStrictEqual(heard, ['lost']);
  });

  it('contracts §W2: the end of the tunnel to the CLI loses the transport', async () => {
    const {heard, recording} = await resolved();
    recording.tunnelClosed?.('the relay ended');
    deepStrictEqual(heard, ['lost']);
  });

  it("contracts §W2: the tunnel's end is logged", async () => {
    const {messages, recording} = await resolved();
    recording.tunnelClosed?.('the relay ended');
    deepStrictEqual(
      messages().filter(message => message.startsWith('the tunnel to the CLI')),
      ['the tunnel to the CLI ended: the relay ended'],
    );
  });

  it('R1: after the listener stops, neither loss is heard', async () => {
    const {heard, stop, lose, recording} = await resolved();
    stop();
    lose({kind: 'controlClosed'});
    recording.tunnelClosed?.('the relay ended');
    deepStrictEqual(heard, []);
  });

  /** A resolved CLI connect whose release steps note their order; `stopCli` replaces the fixture's stop. */
  async function releasable(stopCli?: ConnectSteps['stopCli']) {
    const order: string[] = [];
    const {recording, options} = setup();
    const lease = leaseOf(recording);
    const result = await connect(
      CLI_INPUT,
      cliSteps(recording, {controlEndings: 0}, undefined, () => ({
        openConnection: () =>
          Promise.resolve({
            kind: 'done',
            value: {
              ...lease,
              release: () => {
                order.push('lease');
              },
            },
          }),
        openTunnel: () =>
          Promise.resolve({
            kind: 'done',
            value: {
              ...tunnelOf(recording),
              close: () => {
                order.push('tunnel');
              },
            },
          }),
        openBridge: () =>
          Promise.resolve({
            address: BRIDGE_ADDRESS,
            onLost: () => undefined,
            close: () => {
              order.push('bridge');
            },
          }),
        stopCli:
          stopCli ??
          ((...given) => {
            order.push(`stop ${String(given[4])}`);
            return Promise.resolve();
          }),
      })),
      options,
    );
    return {connection: connectedOf(result), order};
  }

  /** Lets the release's stop settle. */
  async function settled(): Promise<void> {
    await new Promise(resolve => {
      setImmediate(resolve);
    });
  }

  it("athena on #412: release closes the bridge and the tunnel, stops this connect's CLI, then gives the lease back", async () => {
    const {connection, order} = await releasable();
    connection.release();
    await settled();
    deepStrictEqual(order, ['bridge', 'tunnel', 'stop 88', 'lease']);
  });

  it('athena on #412: a stop that rejects still gives the lease back', async () => {
    const {connection, order} = await releasable(() =>
      Promise.reject(new Error('the channel is gone')),
    );
    connection.release();
    await settled();
    deepStrictEqual(order, ['bridge', 'tunnel', 'lease']);
  });

  it('athena on #412: a second release stops nothing more', async () => {
    let stops = 0;
    const {connection} = await releasable(() => {
      stops += 1;
      return Promise.resolve();
    });
    connection.release();
    connection.release();
    await settled();
    deepStrictEqual(stops, 1);
  });
});
