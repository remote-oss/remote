import {deepStrictEqual} from 'node:assert';
import type {Failed} from 'lib-authority';
import type {CliScript, Request} from 'lib-server/testing/fake-cli';
import type {CliBridgeLoss} from '../../src/cli/cli-bridge.ts';
import {TOKEN_NOT_REQUIRED} from '../../src/cli/cli-connect.ts';
import {
  connect,
  type Connection,
  type TransportEvent,
} from '../../src/pipeline/connect.ts';
import type {ConnectSteps} from '../../src/pipeline/steps.ts';
import {
  anyToken,
  type Bridged,
  BRIDGE_ADDRESS,
  CLI_INPUT,
  CLI_PLAN,
  type Changes,
  cliSteps,
  CONTROL_TOKEN,
  failing,
  leaseOf,
  LINKED,
  requiringToken,
  setup,
  tunnelOf,
} from './pipeline.fixture.ts';

/** A CLI that refuses every token, its own included. */
const NO_TOKEN = requiringToken('a token nobody has');

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

  it('F-2103 5.0 (ruling-3028-exec-download): a first resolve waits for the first serve, after the bridge opens', async () => {
    const {recording} = await resolved();
    deepStrictEqual(
      recording.calls.filter(call => /Bridge|firstServe/.test(call)),
      ['openBridge', 'firstServe'],
    );
  });

  it('F-2103 5.0 step 5: the window is not trusted by the CLI path', async () => {
    const {connection} = await resolved();
    deepStrictEqual(connection.connected.trusted, false);
  });

  it('F-2408 BR-6, BR-9 (card #2844): a connect over the CLI holds the client lock until its first serve has installed the server', async () => {
    const {recording} = await connectOverCli();
    deepStrictEqual(recording.clientLock, [
      'held after locateClient',
      'released after firstServe',
    ]);
  });

  it("connect-14: a connect over the CLI remembers the host's platform", async () => {
    const {recording} = await resolved();
    deepStrictEqual(recording.calls.includes('rememberPlatform'), true);
  });

  it('F-2507 BR-5: a connect over the CLI applies the default forwards once, and a reconnection over the CLI does not', async () => {
    const counts: number[] = [];
    for (const isReconnection of [false, true]) {
      let count = 0;
      const {recording, options} = setup();
      await connect(
        {...CLI_INPUT, isReconnection},
        cliSteps(recording, {controlEndings: 0}, undefined, () => ({
          applyDefaults: () => {
            count += 1;
            return Promise.resolve();
          },
        })),
        options,
      );
      counts.push(count);
    }
    deepStrictEqual(counts, [1, 0]);
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

describe("the connect's CLI path: what it leaves for later windows", () => {
  it("ruling-3028-shared-cli: a connect over the CLI stores only the record's cli part, with no data folder, so no direct take-up uses it", async () => {
    const {result, recording} = await connectOverCli();
    deepStrictEqual(
      [
        'connected' in result,
        recording.records.map(record => [
          record.dataFolder,
          record.remotePort,
          record.sharedCli?.port,
          record.sharedCli?.controlToken,
          record.sharedCli?.stopScript,
        ]),
      ],
      [true, [[undefined, 0, 5432, CONTROL_TOKEN, 'stop the CLI 88']]],
    );
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

  it('F-2413 6.5 step 3: a connect over the CLI never prunes the installs', async () => {
    const {recording} = await connectOverCli(undefined);
    deepStrictEqual(recording.calls.includes('cleanup'), false);
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

  /**
   * A resolved CLI connect whose release steps note their order; `stopCli` replaces the fixture's stop, and `shared` is
   * whether the connection took the CLI into its record.
   */
  async function releasable(stopCli?: ConnectSteps['stopCli'], shared = false) {
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
              storeSharedRecord: () => Promise.resolve(shared),
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
            firstServe: () => Promise.resolve({kind: 'serving'} as const),
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

  it("athena on #412: release closes the bridge and the tunnel, stops this connect's CLI when the connection didn't take it, then gives the lease back", async () => {
    const {connection, order} = await releasable();
    connection.release();
    await settled();
    deepStrictEqual(order, ['bridge', 'tunnel', 'stop 88', 'lease']);
  });

  it('ruling-3028-shared-cli: a release never stops a CLI the connection shares: the connection server does when it ends', async () => {
    const {connection, order} = await releasable(undefined, true);
    connection.release();
    await settled();
    deepStrictEqual(order, ['bridge', 'tunnel', 'lease']);
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

/** A CLI that answers `fs_stat` with `answer`, and every other request as the fixture's CLI does. */
function statting(answer: (request: Request) => unknown): CliScript {
  const base = requiringToken(CONTROL_TOKEN);
  return request =>
    request.method === 'fs_stat' ? [answer(request)] : base(request);
}

/** A missing server folder, as the CLI's `fs_stat` answers it. */
const MISSING = statting(request => ({
  id: request.id,
  result: {exists: false},
}));

/** A bridge whose first `serve` logs `lines`, then ends as `outcome`. */
function firstServing(
  lines: readonly string[],
  outcome: {kind: 'serving'} | CliBridgeLoss = {kind: 'serving'},
): Changes {
  return recording => ({
    openBridge: (control, serveParams, events) => {
      recording.calls.push('openBridge');
      return Promise.resolve({
        address: BRIDGE_ADDRESS,
        onLost: () => undefined,
        firstServe: () => {
          recording.calls.push('firstServe');
          for (const text of lines) {
            events.onServeLog({text, level: 2});
          }
          return Promise.resolve(outcome);
        },
        close: () => {
          recording.calls.push('closeBridge');
        },
      });
    },
  });
}

/** The stages of the server's setup the window saw, in order. */
function setupStages(phases: ReadonlyArray<{kind: string}>): string[] {
  return phases
    .map(phase => phase.kind)
    .filter(kind =>
      ['downloading', 'installing', 'settingUpTunnel'].includes(kind),
    );
}

describe("the connect's CLI path: a first resolve shows the server's setup while it lasts (ruling-3028-exec-download)", () => {
  it('F-2103 AC-22: a host with no server folder for the commit shows Downloading, then Installing at the first install line, then the tunnel once the first serve answered', async () => {
    const {recording} = await connectOverCli(
      MISSING,
      firstServing([
        'server download progress: 10/20 (50%)',
        'server inflate progress: 5/10 (50%)',
        'Starting server...',
      ]),
    );
    deepStrictEqual(setupStages(recording.phases), [
      'downloading',
      'installing',
      'settingUpTunnel',
    ]);
  });

  it("F-2103 AC-22: the folder checked is the CLI's own for the editor's quality and commit", async () => {
    const {recording} = await connectOverCli(MISSING);
    deepStrictEqual(
      recording.program?.requests
        .filter(request => request.method === 'fs_stat')
        .map(request => request.params),
      [{path: '/home/dev/.server/servers/Insiders-c1'}],
    );
  });

  it('a host whose server folder exists shows no Downloading, and still resolves after the first serve', async () => {
    const {recording, result} = await connectOverCli(
      statting(request => ({
        id: request.id,
        result: {exists: true, size: 0, type: 'dir'},
      })),
    );
    deepStrictEqual(
      [
        setupStages(recording.phases),
        recording.calls.includes('firstServe'),
        kindOf(result),
      ],
      [['settingUpTunnel'], true, 'connected'],
    );
  });

  it('an fs_stat the CLI refuses, or answers in a shape it has no stat for, shows no Downloading and logs the folder once', async () => {
    const seen: unknown[] = [];
    for (const answer of [
      (request: Request) => ({
        id: request.id,
        error: {code: -1, message: 'denied'},
      }),
      (request: Request) => ({id: request.id, result: {exists: 'yes'}}),
    ]) {
      const {recording, messages} = await connectOverCli(statting(answer));
      seen.push([
        setupStages(recording.phases),
        messages().filter(line => line.includes('could not be checked')),
      ]);
    }
    deepStrictEqual(seen, [
      [
        ['settingUpTunnel'],
        [
          "the CLI's server folder /home/dev/.server/servers/Insiders-c1 could not be checked (callFailed): no download stage",
        ],
      ],
      [
        ['settingUpTunnel'],
        [
          "the CLI's server folder /home/dev/.server/servers/Insiders-c1 could not be checked (malformedReply): no download stage",
        ],
      ],
    ]);
  });

  it('a first serve that fails fails the resolve as a late failure maps it, and gives the CLI back', async () => {
    const {result, recording} = await connectOverCli(
      MISSING,
      firstServing([], {
        kind: 'serveFailed',
        error: {
          kind: 'download',
          url: 'https://example.invalid/s',
          status: 404,
        },
        errorLine: 'error downloading server',
      }),
    );
    deepStrictEqual(
      [
        kindOf(result),
        recording.calls.includes('closeBridge'),
        recording.calls.some(call => call.startsWith('stopCli')),
      ],
      ['serverDownload', false, true],
    );
  });

  it('a first serve that outlasts its bound or loses the control fails the resolve as a server start', async () => {
    const {result} = await connectOverCli(
      MISSING,
      firstServing([], {kind: 'controlClosed'}),
    );
    deepStrictEqual(kindOf(result), 'serverStart');
  });

  it('F-2505: a reconnection takes no first serve and checks no folder', async () => {
    const {recording, options} = setup();
    await connect(
      {...CLI_INPUT, attempt: 2, isReconnection: true},
      cliSteps(recording, {controlEndings: 0}, MISSING, firstServing([])),
      options,
    );
    deepStrictEqual(
      [
        recording.calls.includes('firstServe'),
        recording.program?.requests.some(
          request => request.method === 'fs_stat',
        ),
        setupStages(recording.phases),
      ],
      [false, false, []],
    );
  });
});

/** A program the connection shares, as an earlier window stored it. */
const SHARED_CLI = {
  port: 6543,
  controlToken: CONTROL_TOKEN,
  connectionToken: 'shared-server-token',
  stopScript: 'stop the CLI 77',
};

/** A connect over the CLI path whose connection's record names `shared`, with `script` as every CLI's answers. */
async function joining(
  shared: typeof SHARED_CLI,
  script: CliScript = requiringToken(CONTROL_TOKEN),
  changes: Changes = () => ({}),
) {
  return connectOverCli(script, recording => ({
    openConnection: () =>
      Promise.resolve({
        kind: 'done',
        value: {
          ...leaseOf(recording),
          storedRecord: {
            remotePort: 0,
            operatingSystem: 'linux',
            architecture: 'x64',
            temporaryFolder: '/tmp',
            connectionToken: '',
            sharedCli: shared,
          },
        },
      }),
    ...changes(recording),
  }));
}

/** The steps of a connect that place and start a CLI of its own. */
function startedOwn(calls: readonly string[]): boolean {
  return calls.includes('installCli') && calls.includes('startCli');
}

describe("the connect's CLI path: a later window takes up the connection's program (ruling-3028-shared-cli)", () => {
  it('F-2103 AC-10: a window whose connection shares a program that takes its token places and starts none, stores nothing, and serves through it', async () => {
    const {result, recording, bridged} = await joining(SHARED_CLI);
    deepStrictEqual(
      [
        kindOf(result),
        startedOwn(recording.calls),
        recording.records,
        bridged.serveParams?.connectionToken,
      ],
      ['connected', false, [], 'shared-server-token'],
    );
  });

  it("a taken-up program whose first serve fails fails the resolve, and the window stops nothing of the connection's", async () => {
    const {result, recording} = await joining(
      SHARED_CLI,
      undefined,
      firstServing([], {kind: 'controlClosed'}),
    );
    deepStrictEqual(
      [
        kindOf(result),
        recording.calls.filter(call => call.startsWith('stopCli')),
      ],
      ['serverStart', []],
    );
  });

  it('a shared program that refuses its token is stale: a new one is started and stored in its place', async () => {
    const {result, recording, messages} = await joining({
      ...SHARED_CLI,
      controlToken: 'an old token',
    });
    deepStrictEqual(
      [
        kindOf(result),
        startedOwn(recording.calls),
        recording.records.map(record => record.sharedCli?.port),
        messages().some(line =>
          line.includes("the CLI the connection shares didn't take its token"),
        ),
      ],
      ['connected', true, [5432], true],
    );
  });

  it('a shared program that gives no answer within the take-up bound is stale too', async () => {
    /** A CLI that never answers the challenge of the silent token. */
    function silent(request: Request): readonly unknown[] {
      return request.method === 'challenge_issue' &&
        (request.params as {token: string}).token === 'a silent token'
        ? []
        : requiringToken(CONTROL_TOKEN)(request);
    }
    const {recording, messages} = await joining(
      {...SHARED_CLI, controlToken: 'a silent token'},
      silent,
    );
    deepStrictEqual(
      [
        startedOwn(recording.calls),
        messages().some(line => line.includes('(no answer): starting another')),
      ],
      [true, true],
    );
  });

  it("a shared program the window can't reach through a tunnel is stale too", async () => {
    let tunnels = 0;
    const {recording, messages} = await joining(
      SHARED_CLI,
      undefined,
      recording => ({
        openTunnel: () => {
          tunnels += 1;
          return Promise.resolve(
            tunnels === 1
              ? ({
                  kind: 'failed',
                  failure: {kind: 'channelClosed', reason: {text: 'gone'}},
                } as const)
              : ({kind: 'done', value: tunnelOf(recording)} as const),
          );
        },
      }),
    );
    deepStrictEqual(
      [
        startedOwn(recording.calls),
        messages().some(line =>
          line.includes("the CLI the connection shares can't be reached"),
        ),
      ],
      [true, true],
    );
  });

  it('a window whose connection refuses its record keeps its own program, says so, and stops it at its release', async () => {
    const refused = await connectOverCli(undefined, recording => ({
      openConnection: () =>
        Promise.resolve({
          kind: 'done',
          value: {
            ...leaseOf(recording),
            storeSharedRecord: () => Promise.reject(new Error('gone')),
          },
        }),
    }));
    connectedOf(refused.result).release();
    await new Promise(resolve => {
      setImmediate(resolve);
    });
    deepStrictEqual(
      [
        refused
          .messages()
          .includes("the connection didn't take the CLI: this window stops it"),
        refused.recording.calls.filter(call => call.startsWith('stopCli')),
      ],
      [true, ['stopCli 88']],
    );
  });

  it("#3333: a CLI that could only start inside the connection's session is logged once, with the reason", async () => {
    const {messages} = await connectOverCli(undefined, () => ({
      startCli: () =>
        Promise.resolve({
          kind: 'started',
          server: {
            endpoint: {kind: 'port', port: 4243},
            processId: 88,
            connectionToken: 'host-connection-token',
            reused: false,
          },
          notices: [
            {
              kind: 'startedInsideSession',
              program: 'CLI',
              reason: 'WMI unavailable',
            },
          ],
        }),
    }));
    deepStrictEqual(
      messages().filter(message => message.includes('started inside')),
      [
        "the CLI was started inside the connection's session (WMI unavailable): it ends with the connection",
      ],
    );
  });

  it('a program started on a socket is not shared: the record names programs by their port', async () => {
    const onSocket = await connectOverCli(undefined, () => ({
      startCli: () =>
        Promise.resolve({
          kind: 'started',
          server: {
            endpoint: {kind: 'socket', path: '/tmp/cli.sock'},
            processId: 88,
            connectionToken: 'host-connection-token',
            reused: false,
          },
          notices: [],
        }),
    }));
    deepStrictEqual(onSocket.recording.records, []);
  });

  it('contracts S10: no log line of a window that stores or takes up a program holds its tokens', async () => {
    const stored = await connectOverCli();
    const taken = await joining(SHARED_CLI);
    const lines = [...stored.messages(), ...taken.messages()];
    deepStrictEqual(
      lines.filter(
        line =>
          line.includes(CONTROL_TOKEN) ||
          line.includes('shared-server-token') ||
          line.includes('host-connection-token'),
      ),
      [],
    );
  });
});
