import {deepStrictEqual, rejects, throws} from 'node:assert';
import {FakeClock} from 'lib-helper/testing/fake-clock';
import {FakeDialer, FakeLocalPort} from 'lib-forwarding/testing/fake-network';
import type {HostChannel} from 'lib-host';
import {RecordingChannel} from 'lib-host/testing/recording-channel';
import {type LocalDownloadMode, openCliControl} from 'lib-server';
import {
  fakeCli,
  type CliScript,
  type Request,
} from 'lib-server/testing/fake-cli';
import type {Failed} from 'lib-authority';
import {TUNNEL_SUCCESS_LINE} from 'lib-ssh';
import {RecordingTerminals} from 'lib-ssh/testing/recording-terminal';
import {createLogger, type Level} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import type {
  AcquireConnectionOutcome,
  ConnectionAcquireRequest,
  ConnectionLimits,
  ConnectionMode,
  SharedConnection,
} from 'lib-ssh';
import {serverDownloadProgress} from '../../src/cli/server-download-progress.ts';
import type {LoginLease} from '../../src/pipeline/connection-step.ts';
import type {RawServerSettings} from '../../src/pipeline/host-settings.ts';
import type {ConnectInput} from '../../src/pipeline/steps.ts';
import {
  type ChannelRun,
  stepsOf as stepsWith,
  terminalWaitOf,
  type WiringPorts,
} from '../../src/pipeline/wiring.ts';
import {
  type Answer,
  OPENSSH,
  OPTIONS_TEXT,
  type Seen,
  SSH_PROGRAM,
  spawnerOf,
} from './locate.fixture.ts';
import {
  emptyRecording,
  INPUT,
  leaseOf,
  STARTED,
  TERMS,
} from './pipeline.fixture.ts';
import {
  channelAnswering,
  dependencies,
  HOST,
  PROFILE,
  leaseOn,
  lines,
} from './server-steps.fixture.ts';

/** The server settings with nothing set, and `changes` applied. */
function serverSettings(
  changes: Partial<RawServerSettings> = {},
): RawServerSettings {
  return {
    serverInstallPath: undefined,
    bindHost: undefined,
    serverPickPortsFromRange: undefined,
    httpProxy: '',
    httpsProxy: '',
    reconnectionGraceTime: null,
    defaultExtensions: undefined,
    useFlock: true,
    lockfilesInTmp: false,
    useCurlAndWgetConfigurationFiles: false,
    ...changes,
  };
}

/** What the fakes saw across the connects of one set of ports. */
interface WiringSeen {
  spawned: Seen;
  acquires: Array<{
    request: ConnectionAcquireRequest;
    limits: ConnectionLimits;
  }>;
  logins: string[];
  channels: ChannelRun[];
  sink: MemorySink;
  terminals: RecordingTerminals;
  /** The clock the terminal step's waits run on. */
  clock: FakeClock;
  /** The loopback the CLI path connects and listens on. */
  cliLocal: FakeLocalPort;
  /** The kinds of the failures shown after the window resolved. */
  presented: string[];
  /** What the S045 notifications did, in order. */
  progress: string[];
}

/** Ports over fakes: a client that passes `-V` and looks the host up with `lookup`, and an acquire that fails. */
function portsOf(
  changes: {
    lookup?: Answer;
    server?: Partial<RawServerSettings>;
    preconnect?: unknown;
    connectTimeout?: unknown;
    connection?: SharedConnection;
    mode?: ConnectionMode;
    cliLocal?: FakeLocalPort;
    bridgePort?: number | 'none';
    cliTemplate?: string;
    useExecServer?: boolean;
    localDownloadMode?: LocalDownloadMode;
  } = {},
): {ports: WiringPorts; seen: WiringSeen} {
  const seen: WiringSeen = {
    spawned: {started: [], killed: []},
    acquires: [],
    logins: [],
    channels: [],
    sink: new MemorySink(),
    terminals: new RecordingTerminals(),
    clock: new FakeClock(),
    cliLocal: changes.cliLocal ?? new FakeLocalPort(),
    presented: [],
    progress: [],
  };
  const logger = createLogger(seen.sink, {
    minimumLevel: (): Level => 'info',
  });
  const ports: WiringPorts = {
    settings: {
      preconnect: () => changes.preconnect,
      server: () => serverSettings(changes.server),
      connection: () => ({
        configFile: '',
        connectTimeout: changes.connectTimeout,
        permitPtyAllocation: false,
        externalAskpass: false,
      }),
      override: () => ({
        value: 'https://example.invalid/server-${os}-${arch}-${commit}.tar.gz',
        layer: 'defaultProfileUser',
      }),
      useExecServer: () => changes.useExecServer ?? false,
      localDownloadMode: () => changes.localDownloadMode ?? 'auto',
    },
    terms: {
      settings: () => ({
        remotePlatform: {},
        windowsRemotes: [],
        useLocalServer: true,
        enableRemoteCommand: false,
      }),
      pickPlatform: () => Promise.resolve(undefined),
      writePlatform: () => Promise.resolve(),
      announcePlatform: () => undefined,
    },
    locate: {
      settingValue: () => '',
      mode: () => changes.mode ?? 'shared',
      environment: {searchPath: '/usr/bin', programFilesFolder: ''},
      platform: 'linux',
      homeFolder: '/home/a',
      spawner: spawnerOf(
        {[SSH_PROGRAM]: OPENSSH},
        changes.lookup ?? {kind: 'exit', output: OPTIONS_TEXT, status: 0},
        seen.spawned,
      ),
      processEnvironment: {},
      checkMilliseconds: 50,
      logger,
    },
    acquire: (request, limits) => {
      seen.acquires.push({request, limits});
      return Promise.resolve<AcquireConnectionOutcome>(
        changes.connection === undefined
          ? {kind: 'failed', failure: 'spawnFailed'}
          : {kind: 'acquired', connection: changes.connection},
      );
    },
    requestEnvironment: {
      registryFolder: '/storage/registry',
      helperScript: '/ext/helper.js',
      askpassProgram: '/ext/askpass.js',
      runtime: '/editor',
      runtimeFolder: '/run',
      homeFolder: '/home/a',
      platform: 'linux',
      processEnvironment: {},
    },
    channelFor: (connection, channelRun) => {
      seen.channels.push(channelRun);
      return {} as unknown as HostChannel;
    },
    attachLogin: (login: LoginLease, alias: string) => {
      seen.logins.push(alias);
      return {dispose: () => undefined};
    },
    terminal: {
      terminals: seen.terminals,
      scheduler: seen.clock.scheduler(),
      dynamicForwarding: () => false,
      freePort: () => Promise.resolve(41000),
      newMarker: () => 'marker',
      attachQuestions: () => ({
        onQuestion: () => undefined,
        dispose: () => undefined,
      }),
      revealLoginTerminals: () => false,
    },
    server: dependencies(
      changes.cliTemplate === undefined
        ? {}
        : {profile: {...PROFILE, cliDownloadUrlTemplate: changes.cliTemplate}},
    ),
    tunnel: {
      terminals: seen.terminals,
      attachQuestions: () => ({
        onQuestion: () => undefined,
        dispose: () => undefined,
      }),
      revealLoginTerminals: () => false,
      settings: () => ({
        listenOnSocket: false,
        useLocalServer: true,
        enableDynamicForwarding: true,
      }),
      local: new FakeLocalPort(),
      scheduler: new FakeClock().scheduler(),
      limits: {
        readyMilliseconds: 50,
        retryMilliseconds: 10,
        heldBytesMaximum: 8,
      },
      dialerFor: () => new FakeDialer(['work']),
      chooseLocalPort: () => Promise.resolve(50000),
      logger,
    },
    cliPath: {
      local: seen.cliLocal,
      scheduler: seen.clock.scheduler(),
      chooseLocalPort: () =>
        Promise.resolve(
          changes.bridgePort === 'none'
            ? undefined
            : (changes.bridgePort ?? BRIDGE_PORT),
        ),
      newSecret: () => 'fresh-secret',
      presenter: {
        present: failed => {
          seen.presented.push(failed.kind);
          return Promise.resolve('handled');
        },
      },
      downloadProgress: () =>
        serverDownloadProgress(
          {
            show: title => {
              seen.progress.push(`show ${title}`);
              return {
                report: percent =>
                  seen.progress.push(`report ${String(percent)}`),
                close: () => seen.progress.push('close'),
              };
            },
          },
          'S045',
        ),
    },
    logger,
  };
  return {ports, seen};
}

/** The port the CLI path's bridge listens on, unless a row says otherwise. */
const BRIDGE_PORT = 52000;

/** The alias the rows connect to. */
const ALIAS = 'dev';

/** `INPUT` for the plain host text `text`. */
function inputFor(text: string): ConnectInput {
  return {...INPUT, target: {kind: 'plain', text}, rawHostString: text};
}

/** The steps of one connect, with a stage listener that nothing here reads. */
function stepsOf(ports: WiringPorts): ReturnType<typeof stepsWith> {
  return stepsWith(ports, () => undefined);
}

describe("the composition of a connect's steps", () => {
  it("connect-14: validate reads the server settings of this connect's host alias", () => {
    const {ports} = portsOf({server: {serverInstallPath: {[ALIAS]: '/$bad'}}});
    deepStrictEqual(stepsOf(ports).validate(inputFor('alex@dev:22')), {
      kind: 'failed',
      failure: {
        kind: 'invalidSetting',
        reason: {id: 'installPathProvided', values: ['/$bad']},
      },
    });
  });

  it("connect-14: another host's entry does not apply", () => {
    const {ports} = portsOf({server: {serverInstallPath: {other: '/$bad'}}});
    deepStrictEqual(stepsOf(ports).validate(inputFor('dev')), {
      kind: 'done',
      value: undefined,
    });
  });

  it('#140 R3 interim: the pre-connection step reads remote.SSH.preconnect', async () => {
    const {ports} = portsOf({preconnect: '/home/a/renew.sh'});
    deepStrictEqual(
      await stepsOf(ports).preconnect(INPUT, new AbortController().signal),
      {kind: 'failed', failure: {kind: 'preconnectFailed'}},
    );
  });

  it('connect-14: the client step looks the host up with the settings of the connect', async () => {
    const {ports, seen} = portsOf();
    await stepsOf(ports).locateClient(inputFor('dev'));
    deepStrictEqual(seen.spawned.started, ['ssh -V', 'ssh -G -- dev']);
  });

  it('F-2105 BR-1: the waits follow the setting when the host names no timeout', async () => {
    const {ports} = portsOf({connectTimeout: 30});
    deepStrictEqual(await stepsOf(ports).locateClient(inputFor('dev')), {
      kind: 'done',
      value: {probeMilliseconds: 32000, tunnelMilliseconds: 30000},
    });
  });

  it("connect-14: the connection is asked for with what this connect's client step found", async () => {
    const {ports, seen} = portsOf();
    const steps = stepsOf(ports);
    await steps.locateClient(inputFor('dev'));
    await steps.openConnection(
      inputFor('dev'),
      TERMS,
      new AbortController().signal,
    );
    const request = JSON.parse(
      seen.acquires[0]?.request.options.request ?? '{}',
    ) as {effective?: {user?: string}};
    deepStrictEqual(request.effective?.user, 'alex');
  });

  it('ruled on #253 Q8: the client waits follow the looked-up timeout', async () => {
    const {ports, seen} = portsOf({
      lookup: {
        kind: 'exit',
        output: `${OPTIONS_TEXT}connecttimeout 9\n`,
        status: 0,
      },
    });
    const steps = stepsOf(ports);
    await steps.locateClient(inputFor('dev'));
    await steps.openConnection(
      inputFor('dev'),
      TERMS,
      new AbortController().signal,
    );
    deepStrictEqual(seen.acquires[0]?.limits, {
      requestMilliseconds: 10000,
      loginMilliseconds: 21000,
    });
  });

  it('connect-14: a connection asked for before the client step is a defect, and throws', async () => {
    const {ports} = portsOf();
    await rejects(
      stepsOf(ports).openConnection(
        inputFor('dev'),
        TERMS,
        new AbortController().signal,
      ),
      /before the client was found/,
    );
  });

  it('connect-14: each set of steps has its own state', async () => {
    const {ports} = portsOf();
    const first = stepsOf(ports);
    await first.locateClient(inputFor('dev'));
    await rejects(
      stepsOf(ports).openConnection(
        inputFor('dev'),
        TERMS,
        new AbortController().signal,
      ),
      /before the client was found/,
    );
  });
});

describe("the composition's forwarding to this connect's server steps", () => {
  /** The fixture's host with its server installed, so the plan reuses it. */
  const host = {...HOST, installed: true};

  it("connect-14: the plan is this connect's server steps' plan", () => {
    const {ports} = portsOf();
    deepStrictEqual(
      'plan' in stepsOf(ports).plan(inputFor('dev'), host)
        ? 'planned'
        : 'failed',
      'planned',
    );
  });

  it("connect-14: the licence gate is this connect's server steps' gate", async () => {
    const {ports} = portsOf();
    const steps = stepsOf(ports);
    steps.plan(inputFor('dev'), host);
    deepStrictEqual(
      (await steps.gate(inputFor('dev'), new AbortController().signal)).kind,
      'cleared',
    );
  });
});

describe("the download mode reaches this connect's plan (card connect-38)", () => {
  /** Where the plan of a connect over `ports` downloads the server for a host with none installed, and its fallback. */
  async function placementOf(
    ports: WiringPorts,
  ): Promise<{where: string; clientFallback: boolean}> {
    const steps = stepsOf(ports);
    await steps.locateClient(inputFor('dev'));
    const planned = steps.plan(inputFor('dev'), HOST);
    if (!('plan' in planned) || planned.plan.kind !== 'download') {
      throw new Error('the plan should download');
    }
    return {
      where: planned.plan.where,
      clientFallback: planned.plan.clientFallback,
    };
  }

  it('F-2405 BR-1: each mode reaches the placement of the plan', async () => {
    deepStrictEqual(
      await Promise.all(
        (['auto', 'always', 'off'] as const).map(
          async localDownloadMode =>
            await placementOf(portsOf({localDownloadMode}).ports),
        ),
      ),
      [
        {where: 'host', clientFallback: true},
        {where: 'client', clientFallback: false},
        {where: 'host', clientFallback: false},
      ],
    );
  });

  it('F-2405 BR-1: a connect reads the mode as it is when it starts', async () => {
    const changes: {localDownloadMode: LocalDownloadMode} = {
      localDownloadMode: 'auto',
    };
    const {ports} = portsOf(changes);
    const first = await placementOf(ports);
    changes.localDownloadMode = 'off';
    deepStrictEqual(
      [first, await placementOf(ports)],
      [
        {where: 'host', clientFallback: true},
        {where: 'host', clientFallback: false},
      ],
    );
  });
});

describe("the composition's forwarding of the later server steps", () => {
  /** The fixture's host with no server installed, so the plan downloads. */
  const fresh = HOST;

  it("connect-14: the transfer is this connect's server steps' transfer", async () => {
    const {ports} = portsOf();
    const steps = stepsOf(ports);
    await steps.locateClient(inputFor('dev'));
    const planned = steps.plan(inputFor('dev'), fresh);
    if (!('plan' in planned) || planned.plan.kind !== 'download') {
      throw new Error('the plan should download');
    }
    const outcome = await steps.transfer(
      inputFor('dev'),
      leaseOn(
        channelAnswering(
          lines(
            'Ok',
            'server.installDir=/home/alex/.fixture-server/bin/abc123',
          ),
        ),
      ),
      fresh,
      planned.plan,
      () => undefined,
      new AbortController().signal,
    );
    deepStrictEqual(outcome.kind, 'transferred');
  });

  it("connect-14: the start runs after the client step, with this connect's looked-up user", async () => {
    const {ports} = portsOf();
    const steps = stepsOf(ports);
    await steps.locateClient(inputFor('dev'));
    const channel = channelAnswering(
      lines(
        'Ok',
        'server.port=4321',
        'server.pid=77',
        'server.token=abcdefghijklmnopqrstuvwxyz012345',
      ),
    );
    await steps.start(
      inputFor('dev'),
      leaseOn(channel),
      fresh,
      false,
      new AbortController().signal,
    );
    const [call] = channel.calls;
    deepStrictEqual(
      call?.operation === 'runScript' &&
        call.request.script.includes('remote-lock.alex'),
      true,
    );
  });

  it("F-2411.BR-2: the maintenance is this connect's server steps' kill, after the client step", async () => {
    const {ports} = portsOf();
    const steps = stepsOf(ports);
    await steps.locateClient(inputFor('dev'));
    const channel = channelAnswering(lines('Ok'));
    const outcome = await steps.maintain(
      inputFor('dev'),
      leaseOn(channel),
      'kill',
      new AbortController().signal,
    );
    const [call] = channel.calls;
    deepStrictEqual(
      [outcome.kind, call?.operation === 'runScript'],
      ['done', true],
    );
  });

  it("connect-14: the extensions install is this connect's server steps' install", async () => {
    const {ports} = portsOf({server: {defaultExtensions: ['pub.ext']}});
    const steps = stepsOf(ports);
    await steps.locateClient(inputFor('dev'));
    const channel = channelAnswering(lines('Ok'));
    await steps.installExtensions(
      inputFor('dev'),
      leaseOn(channel),
      new AbortController().signal,
    );
    deepStrictEqual(channel.calls.length, 1);
  });

  it('connect-14: the login questions name the host by its alias', async () => {
    const {ports, seen} = portsOf();
    const steps = stepsOf({
      ...ports,
      acquire: () =>
        Promise.resolve({
          kind: 'acquired',
          connection: {
            onNotice: () => () => undefined,
            answer: () => Promise.resolve(false),
            refuse: () => Promise.resolve(false),
            connect: () =>
              Promise.resolve({kind: 'failed', failure: {kind: 'cancelled'}}),
            release: () => undefined,
          } as unknown as SharedConnection,
        }),
    });
    await steps.locateClient(inputFor('alex@dev:22'));
    await steps.openConnection(
      inputFor('alex@dev:22'),
      TERMS,
      new AbortController().signal,
    );
    deepStrictEqual(seen.logins, ['dev']);
  });
});

describe('the connection step by mode (card connect-17)', () => {
  /** Opens the connection of a connect in `mode`, and what the shared and the terminal steps were asked for. */
  async function connectIn(mode: ConnectionMode) {
    const {ports, seen} = portsOf({mode});
    const steps = stepsOf(ports);
    await steps.locateClient(inputFor('dev'));
    void steps
      .openConnection(inputFor('dev'), TERMS, new AbortController().signal)
      .catch(() => undefined);
    await Promise.resolve();
    return seen;
  }

  it('F-2102 BR-9: the shared connection on uses the shared step', async () => {
    const seen = await connectIn('shared');
    deepStrictEqual(
      [seen.acquires.length, seen.terminals.opened.length],
      [1, 0],
    );
  });

  it('F-2102 BR-10: the shared connection off uses the terminal step', async () => {
    const seen = await connectIn('terminal');
    deepStrictEqual(
      [seen.acquires.length, seen.terminals.opened.length],
      [0, 1],
    );
  });

  it('F-2410 BR-2: socket mode, which is the terminal mode, opens the install terminal', async () => {
    const seen = await connectIn('terminal');
    deepStrictEqual(seen.terminals.opened[0]?.name, 'install');
  });

  it('F-2102 BR-9: the mode is read when the step runs', async () => {
    let mode: ConnectionMode = 'shared';
    const {ports, seen} = portsOf();
    const steps = stepsOf({
      ...ports,
      locate: {...ports.locate, mode: () => mode},
    });
    await steps.locateClient(inputFor('dev'));
    mode = 'terminal';
    void steps
      .openConnection(inputFor('dev'), TERMS, new AbortController().signal)
      .catch(() => undefined);
    await Promise.resolve();
    deepStrictEqual(
      [seen.acquires.length, seen.terminals.opened.length],
      [0, 1],
    );
  });
});

describe("a terminal-mode connect's tunnel run", () => {
  const REMOTE_COMMAND_LOOKUP: Answer = {
    kind: 'exit',
    output: `${OPTIONS_TEXT}remotecommand bash -l\n`,
    status: 0,
  };

  /** The arguments of the tunnel run a connect with `terms` opens on the second-ssh path. */
  async function tunnelArguments(
    remoteCommandInEffect: boolean,
  ): Promise<readonly string[] | undefined> {
    const {ports, seen} = portsOf({lookup: REMOTE_COMMAND_LOOKUP});
    const steps = stepsOf({
      ...ports,
      tunnel: {
        ...ports.tunnel,
        settings: () => ({
          listenOnSocket: false,
          useLocalServer: false,
          enableDynamicForwarding: false,
        }),
      },
    });
    await steps.locateClient(inputFor('dev'));
    await steps
      .openConnection(
        inputFor('dev'),
        {...TERMS, remoteCommandInEffect},
        new AbortController().signal,
      )
      .catch(() => undefined);
    void steps.openTunnel(
      inputFor('dev'),
      leaseOf(emptyRecording()),
      STARTED.server,
      () => undefined,
      new AbortController().signal,
    );
    await new Promise(resolve => setImmediate(resolve));
    return seen.terminals.opened[0]?.invocation.arguments;
  }

  it('connect-18: the run is a tunnel run holding the forward to the server', async () => {
    const given = await tunnelArguments(true);
    deepStrictEqual(
      [
        given?.includes('-L'),
        given?.some(argument => argument.includes(':4321')),
      ],
      [true, true],
    );
  });

  it('connect-18: the run carries the tunnel command, not an install shell', async () => {
    deepStrictEqual(
      (await tunnelArguments(true))?.at(-1)?.includes(TUNNEL_SUCCESS_LINE),
      true,
    );
  });

  it('ssh-19: the run clears a RemoteCommand the terms say is not in effect', async () => {
    deepStrictEqual(
      (await tunnelArguments(false))?.includes('RemoteCommand=none'),
      true,
    );
  });

  it('ssh-19: the run leaves a RemoteCommand the terms say is in effect', async () => {
    deepStrictEqual(
      (await tunnelArguments(true))?.includes('RemoteCommand=none'),
      false,
    );
  });

  it('connect-18: a tunnel asked for before the connection is a defect, and throws', async () => {
    const {ports} = portsOf();
    const steps = stepsOf({
      ...ports,
      tunnel: {
        ...ports.tunnel,
        settings: () => ({
          listenOnSocket: false,
          useLocalServer: false,
          enableDynamicForwarding: false,
        }),
      },
    });
    await rejects(
      steps.openTunnel(
        inputFor('dev'),
        leaseOf(emptyRecording()),
        STARTED.server,
        () => undefined,
        new AbortController().signal,
      ),
      /before the connection/,
    );
  });
});

describe("the composition's server steps", () => {
  it('connect-14: a probe before the client step is a defect, and throws', () => {
    const {ports} = portsOf();
    throws(() => {
      void stepsOf(ports).probe(
        inputFor('dev'),
        {} as unknown as Parameters<ReturnType<typeof stepsOf>['probe']>[1],
        new AbortController().signal,
      );
    }, /before its configuration was read/);
  });
});

/** A connection that logs in at once on the SOCKS port 1080. */
const CONNECTED = {
  onNotice: () => () => undefined,
  answer: () => Promise.resolve(false),
  refuse: () => Promise.resolve(false),
  connect: () => Promise.resolve({kind: 'connected', socksPort: 1080}),
  release: () => undefined,
} as unknown as SharedConnection;

/** The lookup's output with the `LocalForward` lines `forwards`. */
function lookupWith(...forwards: string[]): Answer {
  return {
    kind: 'exit',
    output:
      OPTIONS_TEXT + forwards.map(line => `localforward ${line}\n`).join(''),
    status: 0,
  };
}

/** The opened tunnel of a connect whose lookup prints `forwards`, with what the fakes saw. */
async function tunnelWith(
  ...forwards: string[]
): Promise<{opened: unknown; seen: WiringSeen}> {
  const {ports, seen} = portsOf({lookup: lookupWith(...forwards)});
  const steps = stepsOf(ports);
  await steps.locateClient(inputFor('dev'));
  const outcome = await steps.openTunnel(
    inputFor('dev'),
    leaseOf(emptyRecording()),
    STARTED.server,
    () => undefined,
    new AbortController().signal,
  );
  return {
    opened: outcome.kind === 'done' ? outcome.value.opened : outcome,
    seen,
  };
}

/** The channel run of a shared connect to `text` that logs in, with `lookup` as the host's options and `connectTimeout` as the setting's. */
async function channelRunOf(
  text: string,
  lookup?: Answer,
  connectTimeout?: unknown,
): Promise<ChannelRun | undefined> {
  const {ports, seen} = portsOf({
    connection: CONNECTED,
    connectTimeout,
    ...(lookup === undefined ? {} : {lookup}),
  });
  const steps = stepsOf(ports);
  await steps.locateClient(inputFor(text));
  await steps.openConnection(
    inputFor(text),
    TERMS,
    new AbortController().signal,
  );
  return seen.channels[0];
}

describe("the composition's channel and window environment", () => {
  it("connect-14: the channel is made with the host as written and this connect's runs", async () => {
    const channelRun = await channelRunOf('alex@dev:22');
    deepStrictEqual(
      [channelRun?.hostString, channelRun?.base.target, channelRun?.terms],
      ['alex@dev:22', {host: 'dev', port: 22, user: 'alex'}, TERMS],
    );
  });

  it("connect-14: the channel's runs use the programs and options the client step found", async () => {
    const channelRun = await channelRunOf('dev');
    deepStrictEqual(
      [channelRun?.base.programs.sshProgram, channelRun?.base.effective.user],
      [SSH_PROGRAM, 'alex'],
    );
  });

  it('F-2507: the window is told the looked-up LocalForward entries as tunnels', async () => {
    const {opened} = await tunnelWith('127.0.0.1:13000 localhost:3000');
    deepStrictEqual(
      (opened as {environmentTunnels: unknown}).environmentTunnels,
      [
        {
          remoteAddress: {host: 'localhost', port: 3000},
          localAddress: {host: '127.0.0.1', port: 13000},
        },
      ],
    );
  });

  it('F-2507: the window gets no environment variables of its own', async () => {
    const {opened} = await tunnelWith();
    deepStrictEqual(
      (opened as {extensionHostEnv: unknown}).extensionHostEnv,
      {},
    );
  });

  it('F-2507: an entry left out is logged with its position and why', async () => {
    const {seen} = await tunnelWith(
      '127.0.0.1:13000 localhost:3000',
      '/tmp/local.sock localhost:3000',
    );
    deepStrictEqual(
      seen.sink.lines.some(line =>
        line.message.includes(
          'LocalForward entry 1 is not shown as a tunnel: localSocket',
        ),
      ),
      true,
    );
  });

  it("F-3902 rule 1: the download override is read at each connect's server steps", () => {
    const reads: string[] = [];
    const {ports} = portsOf();
    const counted = {
      ...ports,
      settings: {
        ...ports.settings,
        override: () => {
          reads.push('override');
          return ports.settings.override();
        },
      },
    };
    stepsOf(counted).validate(inputFor('dev'));
    stepsOf(counted).validate(inputFor('dev'));
    deepStrictEqual(reads, ['override', 'override']);
  });

  it("connect-14: one connect reads the connection's settings once, so its runs agree", async () => {
    const {ports} = portsOf({connection: CONNECTED});
    let reads = 0;
    const steps = stepsOf({
      ...ports,
      settings: {
        ...ports.settings,
        connection: () => {
          reads += 1;
          return ports.settings.connection();
        },
      },
    });
    await steps.locateClient(inputFor('dev'));
    await steps.openConnection(
      inputFor('dev'),
      TERMS,
      new AbortController().signal,
    );
    deepStrictEqual(reads, 1);
  });
});

describe("a terminal-mode login's wait", () => {
  it("F-2105 BR-2: the host's own timeout wins over the setting", () => {
    deepStrictEqual(terminalWaitOf('7', 30), {
      connectTimeoutSeconds: 7,
      fromHost: true,
      unboundedWaitSeconds: 600,
    });
  });

  it('F-2105 BR-1: with no host timeout the setting applies', () => {
    deepStrictEqual(terminalWaitOf(undefined, 30), {
      connectTimeoutSeconds: 30,
      fromHost: false,
      unboundedWaitSeconds: 600,
    });
  });

  it("ruled on #253 Q8: a host's own 0 waits the 600 s ceiling with no margin", () => {
    deepStrictEqual(terminalWaitOf('0', 30), {
      connectTimeoutSeconds: 0,
      fromHost: true,
      unboundedWaitSeconds: 600,
    });
  });

  it("F-2105 AC-9: the setting's 0 stays 0, which the wait reads as the extra wait alone", () => {
    deepStrictEqual(terminalWaitOf(undefined, 0).connectTimeoutSeconds, 0);
  });
});

describe("a terminal-mode connect's channel", () => {
  it("connect-17: the install terminal's channel gets this connect's host and runs", async () => {
    const {ports, seen} = portsOf({mode: 'terminal'});
    const steps = stepsOf(ports);
    await steps.locateClient(inputFor('alex@dev:22'));
    const result = steps.openConnection(
      inputFor('alex@dev:22'),
      TERMS,
      new AbortController().signal,
    );
    await Promise.resolve();
    seen.terminals.opened[0]?.write(
      'Authenticated to dev ([192.0.2.1]:22) using "publickey".\nLAYER1-READY\n',
    );
    await result;
    deepStrictEqual(
      [seen.channels[0]?.hostString, seen.channels[0]?.base.effective.user],
      ['alex@dev:22', 'alex'],
    );
  });
});

describe("a terminal-mode connect's wait, from this connect's lookup and settings", () => {
  /** Whether a terminal-mode connect whose terminal stays silent has settled after `milliseconds`. */
  async function settledAfter(
    milliseconds: number,
    changes: {lookup?: Answer; connectTimeout?: unknown},
  ): Promise<boolean> {
    const {ports, seen} = portsOf({mode: 'terminal', ...changes});
    const steps = stepsOf(ports);
    await steps.locateClient(inputFor('dev'));
    let settled = false;
    void steps
      .openConnection(inputFor('dev'), TERMS, new AbortController().signal)
      .then(() => {
        settled = true;
      });
    await Promise.resolve();
    seen.clock.advance(milliseconds);
    await new Promise(resolve => {
      setImmediate(resolve);
    });
    return settled;
  }

  const HOST_SEVEN: Answer = {
    kind: 'exit',
    output: `${OPTIONS_TEXT}connecttimeout 7\n`,
    status: 0,
  };

  it("themis on #385: the host's looked-up ConnectTimeout bounds the wait (7 s + 2 s)", async () => {
    deepStrictEqual(
      [
        await settledAfter(8999, {lookup: HOST_SEVEN, connectTimeout: 30}),
        await settledAfter(9000, {lookup: HOST_SEVEN, connectTimeout: 30}),
      ],
      [false, true],
    );
  });

  it('themis on #385: without a host value, the setting bounds the wait (30 s + 2 s)', async () => {
    deepStrictEqual(
      [
        await settledAfter(31999, {connectTimeout: 30}),
        await settledAfter(32000, {connectTimeout: 30}),
      ],
      [false, true],
    );
  });

  it("F-2405 BR-8: the channel's own login waits as this connect does, from its looked-up timeout", async () => {
    const channelRun = await channelRunOf('dev', {
      kind: 'exit',
      output: `${OPTIONS_TEXT}connecttimeout 7\n`,
      status: 0,
    });
    deepStrictEqual(channelRun?.connectWait, {
      connectTimeoutSeconds: 7,
      fromHost: true,
      unboundedWaitSeconds: 600,
    });
  });

  it('themis on #419 (3), F-2105 BR-1: the channel run takes the setting when the host sets no timeout', async () => {
    const channelRun = await channelRunOf('dev', undefined, 30);
    deepStrictEqual(channelRun?.connectWait, {
      connectTimeoutSeconds: 30,
      fromHost: false,
      unboundedWaitSeconds: 600,
    });
  });

  it("F-2305 3.4: the channel's own login names the host as the user wrote it, without user and port", async () => {
    deepStrictEqual((await channelRunOf('alex@dev:22'))?.displayHost, 'dev');
  });
});

describe("the composition's CLI path", () => {
  const SERVE_PARAMS = {
    commit: 'c1',
    quality: 'insider',
    connectionToken: 'server-token',
    useLocalDownload: false,
  };

  /** Lets the control client's decoder and the bridge's callbacks run. */
  async function settled(): Promise<void> {
    await new Promise(resolve => {
      setImmediate(resolve);
    });
  }

  /** A CLI whose first `serve` logs a download and succeeds, and whose later ones are never answered. */
  function downloading(request: Request): readonly unknown[] {
    const {socket_id: socketId} = (request.params ?? {}) as {
      socket_id?: number;
    };
    if (request.method !== 'serve' || socketId !== 0) {
      return [];
    }
    return [
      {
        id: null,
        method: 'serverlog',
        params: {line: 'Downloading VSCodium server -> /tmp/x', level: 2},
      },
      {id: request.id, result: {}},
    ];
  }

  /** The bridge of a located connect over a CLI answering `script`, with what the fakes saw. */
  async function bridged(
    changes: Parameters<typeof portsOf>[0] = {},
    script: CliScript = downloading,
  ) {
    const {ports, seen} = portsOf(changes);
    const steps = stepsOf(ports);
    await steps.locateClient(inputFor('dev'));
    const peer = fakeCli(script);
    const bridge = await steps.openBridge(
      openCliControl(peer.stream),
      SERVE_PARAMS,
      {onServeLog: () => undefined, onControlEnded: () => undefined},
    );
    return {seen, peer, bridge};
  }

  /** The messages the composition logged. */
  function messagesOf(seen: WiringSeen): string[] {
    return seen.sink.lines.map(line => line.message);
  }

  it("cli-04 §3 step 3: the control connection goes to the tunnel's local port", async () => {
    const {ports, seen} = portsOf();
    await stepsOf(ports).connectControl(50001);
    deepStrictEqual(seen.cliLocal.connected, [50001]);
  });

  it('cli-04 §3 step 3: a control port that refuses gives no connection', async () => {
    const {ports} = portsOf({cliLocal: new FakeLocalPort('work', ['fail'])});
    deepStrictEqual(await stepsOf(ports).connectControl(50001), undefined);
  });

  it('cli-04 §3 step 3: the refusal is logged with its reason', async () => {
    const {ports, seen} = portsOf({
      cliLocal: new FakeLocalPort('work', ['fail']),
    });
    await stepsOf(ports).connectControl(50001);
    deepStrictEqual(
      messagesOf(seen).filter(message => message.startsWith("the CLI's")),
      ["the CLI's control port refused a connection: connection refused"],
    );
  });

  it("cli-04 §4: the bridge listens on the port chosen as the tunnel's is", async () => {
    const {seen} = await bridged();
    deepStrictEqual(seen.cliLocal.listened, [BRIDGE_PORT]);
  });

  it('cli-04 §4: the bridge gives the window that port on 127.0.0.1', async () => {
    const {bridge} = await bridged();
    deepStrictEqual(bridge?.address, {host: '127.0.0.1', port: BRIDGE_PORT});
  });

  it('cli-04 §4: with no free port there is no bridge', async () => {
    const {bridge} = await bridged({bridgePort: 'none'});
    deepStrictEqual(bridge, undefined);
  });

  it('cli-04 §4: a port that cannot be listened on gives no bridge', async () => {
    const {bridge} = await bridged({cliLocal: new FakeLocalPort('fail')});
    deepStrictEqual(bridge, undefined);
  });

  it('cli-04 §4: the failed listen is logged with its reason', async () => {
    const {seen} = await bridged({cliLocal: new FakeLocalPort('fail')});
    deepStrictEqual(
      messagesOf(seen).filter(message => message.startsWith('the bridge')),
      ['the bridge could not listen on 52000: port 52000 is in use'],
    );
  });

  it("F-2103 5.0 step 6: the first serve's download shows S045, and its reply closes it", async () => {
    const {seen} = await bridged();
    seen.cliLocal.accept(BRIDGE_PORT);
    await settled();
    await settled();
    deepStrictEqual(seen.progress, ['show S045', 'close']);
  });

  it("themis on #431: a later serve is bounded by the connect's wait (30 s + 2 s)", async () => {
    const {seen, peer} = await bridged({connectTimeout: 30});
    seen.cliLocal.accept(BRIDGE_PORT);
    await settled();
    seen.cliLocal.accept(BRIDGE_PORT);
    await settled();
    await settled();
    seen.clock.advance(31999);
    await settled();
    const before = peer.closes();
    seen.clock.advance(1);
    await settled();
    deepStrictEqual([before, peer.closes()], [0, 1]);
  });

  it('athena on #458: a late failure is shown through the failure dialog', () => {
    const {ports, seen} = portsOf();
    const failed: Failed = {
      kind: 'serverInstall',
      retryable: false,
      silent: false,
      userAlreadyNotified: false,
      hints: [],
      diagnostics: [],
    };
    stepsOf(ports).presentLateFailure(failed);
    deepStrictEqual(seen.presented, ['serverInstall']);
  });

  /** The steps of a located connect whose plan takes the CLI path, with the plan and what the fakes saw. */
  async function cliPlanned() {
    const {ports, seen} = portsOf({
      cliTemplate: 'https://example.invalid/cli-${os}-${arch}.tar.gz',
      useExecServer: true,
    });
    const steps = stepsOf(ports);
    await steps.locateClient(inputFor('dev'));
    const planned = steps.plan(inputFor('dev'), HOST);
    if (!('plan' in planned) || planned.plan.kind !== 'cli') {
      throw new Error('the plan should take the CLI path');
    }
    return {seen, steps, plan: planned.plan};
  }

  it("connect-14: the CLI's install, start and stop are this connect's server steps'", async () => {
    const {steps, plan} = await cliPlanned();
    const channels = [1, 2, 3].map(() => channelAnswering(lines('Ok')));
    const [installOn, startOn, stopOn] = channels.map(leaseOn);
    const signal = new AbortController().signal;
    await steps.installCli(
      inputFor('dev'),
      installOn ?? leaseOn(channelAnswering([])),
      HOST,
      {...plan, download: false},
      () => undefined,
      signal,
    );
    await steps.startCli(
      inputFor('dev'),
      startOn ?? leaseOn(channelAnswering([])),
      HOST,
      plan,
      'control-token',
      signal,
    );
    await steps.stopCli(
      inputFor('dev'),
      stopOn ?? leaseOn(channelAnswering([])),
      HOST,
      plan,
      88,
    );
    deepStrictEqual(
      channels.map(channel => channel.calls.length > 0),
      [true, true, true],
    );
  });

  /** The steps of a CLI plan and the stop of process 88 over a channel that holds the stop until it's cancelled. */
  async function heldStop() {
    const {seen, steps, plan} = await cliPlanned();
    const channel = new RecordingChannel({
      identity: 'devbox',
      platformHint: 'linux',
      scripts: [
        {
          interpreter: 'posixShell',
          matches: () => true,
          lines: [],
          ending: {kind: 'holdUntilCancelled'},
        },
      ],
    });
    let settled = false;
    void steps
      .stopCli(inputFor('dev'), leaseOn(channel), HOST, plan, 88)
      .then(() => {
        settled = true;
      });
    await new Promise(resolve => {
      setImmediate(resolve);
    });
    return {seen, channel, settled: () => settled};
  }

  it('athena on #519: a stop the host never answers settles once the 10 s bound passes, not before', async () => {
    const {seen, settled} = await heldStop();
    seen.clock.advance(9999);
    await new Promise(resolve => {
      setImmediate(resolve);
    });
    const before = settled();
    seen.clock.advance(1);
    await new Promise(resolve => {
      setImmediate(resolve);
    });
    deepStrictEqual([before, settled()], [false, true]);
  });

  it("athena on #519: the bound aborts the stop's own signal", async () => {
    const {seen, channel} = await heldStop();
    seen.clock.advance(10000);
    const [call] = channel.calls;
    deepStrictEqual(
      call?.operation === 'runScript' && call.request.cancellation.aborted,
      true,
    );
  });

  it('athena on #519: a stop past the bound is logged', async () => {
    const {seen} = await heldStop();
    seen.clock.advance(10000);
    deepStrictEqual(
      seen.sink.lines
        .map(line => line.message)
        .filter(message => message.startsWith('the CLI was not stopped')),
      ['the CLI was not stopped within 10000 ms'],
    );
  });

  it("cli-04 §3: the connect's secrets are the port's", () => {
    const {ports} = portsOf();
    deepStrictEqual(stepsOf(ports).newSecret(), 'fresh-secret');
  });
});
