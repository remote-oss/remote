import {deepStrictEqual, rejects, throws} from 'node:assert';
import {FakeClock} from 'lib-helper/testing/fake-clock';
import {FakeDialer, FakeLocalPort} from 'lib-forwarding/testing/fake-network';
import type {HostChannel} from 'lib-host';
import {createLogger, type Level} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import type {
  AcquireConnectionOutcome,
  ConnectionAcquireRequest,
  ConnectionLimits,
  SharedConnection,
} from 'lib-ssh';
import type {LoginLease} from '../../src/pipeline/connection-step.ts';
import type {RawServerSettings} from '../../src/pipeline/host-settings.ts';
import type {ConnectInput} from '../../src/pipeline/steps.ts';
import {
  type ChannelRun,
  stepsOf,
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
import {INPUT, leaseOf, STARTED, TERMS} from './pipeline.fixture.ts';
import {
  channelAnswering,
  dependencies,
  HOST,
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
}

/** Ports over fakes: a client that passes `-V` and looks the host up with `lookup`, and an acquire that fails. */
function portsOf(
  changes: {
    lookup?: Answer;
    server?: Partial<RawServerSettings>;
    preconnect?: unknown;
    connectTimeout?: unknown;
    connection?: SharedConnection;
  } = {},
): {ports: WiringPorts; seen: WiringSeen} {
  const seen: WiringSeen = {
    spawned: {started: [], killed: []},
    acquires: [],
    logins: [],
    channels: [],
    sink: new MemorySink(),
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
      useExecServer: () => false,
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
    },
    locate: {
      settingValue: () => '',
      mode: () => 'shared',
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
    server: dependencies(),
    tunnel: {
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
    logger,
  };
  return {ports, seen};
}

/** The alias the rows connect to. */
const ALIAS = 'dev';

/** `INPUT` for the plain host text `text`. */
function inputFor(text: string): ConnectInput {
  return {...INPUT, target: {kind: 'plain', text}, rawHostString: text};
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
    leaseOf({calls: [], releases: 0, tunnelCloses: 0, records: [], phases: []}),
    STARTED.server,
    () => undefined,
    new AbortController().signal,
  );
  return {
    opened: outcome.kind === 'done' ? outcome.value.opened : outcome,
    seen,
  };
}

describe("the composition's channel and window environment", () => {
  it("connect-14: the channel is made with the host as written and this connect's runs", async () => {
    const {ports, seen} = portsOf({connection: CONNECTED});
    const steps = stepsOf(ports);
    await steps.locateClient(inputFor('alex@dev:22'));
    await steps.openConnection(
      inputFor('alex@dev:22'),
      TERMS,
      new AbortController().signal,
    );
    const [channelRun] = seen.channels;
    deepStrictEqual(
      [channelRun?.hostString, channelRun?.base.target, channelRun?.terms],
      ['alex@dev:22', {host: 'dev', port: 22, user: 'alex'}, TERMS],
    );
  });

  it("connect-14: the channel's runs use the programs and options the client step found", async () => {
    const {ports, seen} = portsOf({connection: CONNECTED});
    const steps = stepsOf(ports);
    await steps.locateClient(inputFor('dev'));
    await steps.openConnection(
      inputFor('dev'),
      TERMS,
      new AbortController().signal,
    );
    deepStrictEqual(
      [
        seen.channels[0]?.base.programs.sshProgram,
        seen.channels[0]?.base.effective.user,
      ],
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
});
