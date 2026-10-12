import {deepStrictEqual, rejects, throws} from 'node:assert';
import {FakeClock} from 'lib-helper/testing/fake-clock';
import type {HostChannel} from 'lib-host';
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
import type {LoginLease} from '../../src/pipeline/connection-step.ts';
import type {RawServerSettings} from '../../src/pipeline/host-settings.ts';
import type {ConnectInput} from '../../src/pipeline/steps.ts';
import {stepsOf, type WiringPorts} from '../../src/pipeline/wiring.ts';
import {
  type Answer,
  OPENSSH,
  OPTIONS_TEXT,
  type Seen,
  SSH_PROGRAM,
  spawnerOf,
} from './locate.fixture.ts';
import {INPUT, TERMS} from './pipeline.fixture.ts';
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
  terminals: RecordingTerminals;
}

/** Ports over fakes: a client that passes `-V` and looks the host up with `lookup`, and an acquire that fails. */
function portsOf(
  changes: {
    lookup?: Answer;
    server?: Partial<RawServerSettings>;
    preconnect?: unknown;
    connectTimeout?: unknown;
    mode?: ConnectionMode;
  } = {},
): {ports: WiringPorts; seen: WiringSeen} {
  const seen: WiringSeen = {
    spawned: {started: [], killed: []},
    acquires: [],
    logins: [],
    terminals: new RecordingTerminals(),
  };
  const logger = createLogger(new MemorySink(), {
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
      return Promise.resolve<AcquireConnectionOutcome>({
        kind: 'failed',
        failure: 'spawnFailed',
      });
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
    channelFor: () => ({}) as unknown as HostChannel,
    attachLogin: (login: LoginLease, alias: string) => {
      seen.logins.push(alias);
      return {dispose: () => undefined};
    },
    terminal: {
      terminals: seen.terminals,
      scheduler: new FakeClock().scheduler(),
      dynamicForwarding: () => false,
      freePort: () => Promise.resolve(41000),
      newMarker: () => 'marker',
      channelFor: () => ({}) as unknown as HostChannel,
      attachQuestions: () => ({
        onQuestion: () => undefined,
        dispose: () => undefined,
      }),
      revealLoginTerminals: () => false,
      connectWait: () => ({
        connectTimeoutSeconds: 10,
        fromHost: false,
        unboundedWaitSeconds: 600,
      }),
    },
    server: dependencies(),
    tunnel: {} as unknown as WiringPorts['tunnel'],
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
