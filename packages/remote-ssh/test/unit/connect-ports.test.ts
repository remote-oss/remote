import {deepStrictEqual, throws} from 'node:assert';
import type {ConnectPhase, DecodedTarget, Failed} from 'lib-authority';
import {FakeProber} from 'lib-forwarding/testing/fake-prober';
import {FakeLocalPort} from 'lib-forwarding/testing/fake-network';
import {FakeClock} from 'lib-helper/testing/fake-clock';
import {FakeEndpointPort} from 'lib-helper/testing/fake-endpoint';
import {MemoryFilePort} from 'lib-helper/testing/memory-file-port';
import {clientEnvironment} from 'lib-helper/testing/client-environment';
import type {SettingHost, SettingInspection} from 'lib-identifiers';
import {createLogger, type Level} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import type {RunBase, SharedConnection} from 'lib-ssh';
import {RecordingTerminals} from 'lib-ssh/testing/recording-terminal';
import {
  connectAssemblyOf,
  type ConnectMachine,
  type ConnectSurfaces,
  sshOverridePolicy,
  wiringPortsOf,
} from '../../src/connect-ports.ts';
import {settings as SETTINGS} from '../../src/identifiers.generated.ts';
import {
  type ConnectorDependencies,
  connectorOf,
} from '../../src/pipeline/connector.ts';
import {
  connectionSettingsOf,
  termsSettingsOf,
  textOf as settingTextOf,
} from '../../src/pipeline/connect-settings.ts';
import {decidePlatform} from '../../src/pipeline/platform.ts';
import type {PromptEditor} from '../../src/surfaces/prompt-surface.ts';
import {textOf} from '../../src/surfaces/prompt-strings.ts';
import {
  OPENSSH,
  OPTIONS_TEXT,
  type Seen,
  SSH_PROGRAM,
  spawnerOf,
} from './locate.fixture.ts';
import {INPUT, SILENT_PROMPTS, TERMS} from './pipeline.fixture.ts';
import {PROFILE, surfacesOf} from './server-steps.fixture.ts';

/** The settings the user wrote, by id, at the user level. */
type Written = Readonly<Record<string, unknown>>;

/** What the fakes saw. */
interface Recorded {
  spawned: Seen;
  helperStarts: Array<Record<string, string>>;
  revealed: number;
  sink: MemorySink;
}

/** A setting host over `written`; a setting the user did not write has its manifest default, as the editor gives it. */
function settingHostOf(written: Written): {
  inspectSetting(settingId: string): SettingInspection;
} {
  const defaults: Readonly<Record<string, unknown>> = {
    'remote.SSH.useLocalServer': true,
    'remote.SSH.path': '',
    'remote.SSH.configFile': '',
    'remote.SSH.preferredLocalPortRange': '',
    'remote.SSH.maxReconnectionAttempts': null,
  };
  return {
    inspectSetting: settingId => ({
      defaultValue: defaults[settingId],
      ...(Object.hasOwn(written, settingId)
        ? {globalValue: written[settingId]}
        : {}),
    }),
  };
}

/** The surfaces and the machine over fakes, with `written` as the user's settings. */
function assemblyInputs(
  written: Written = {},
  changes: {prober?: FakeProber} = {},
): {
  surfaces: ConnectSurfaces;
  machine: ConnectMachine;
  clock: FakeClock;
  recorded: Recorded;
} {
  const recorded: Recorded = {
    spawned: {started: [], killed: [], environments: []},
    helperStarts: [],
    revealed: 0,
    sink: new MemorySink(),
  };
  const clock = new FakeClock();
  const surfaces = surfacesOf(
    settingHostOf(written),
    template => `<${template}>`,
    () => {
      recorded.revealed += 1;
    },
  );
  const machine: ConnectMachine = {
    profile: PROFILE,
    platform: 'linux',
    homeFolder: '/home/alex',
    processEnvironment: {PATH: '/usr/bin', UNSET: undefined},
    clientSearch: {searchPath: '/usr/bin', programFilesFolder: ''},
    spawner: spawnerOf(
      {[SSH_PROGRAM]: OPENSSH},
      {kind: 'exit', output: OPTIONS_TEXT, status: 0},
      recorded.spawned,
    ),
    helpers: clientEnvironment(
      {
        files: new MemoryFilePort(),
        endpoints: new FakeEndpointPort(),
        spawn: specification => {
          recorded.helperStarts.push(specification.environment);
          return Promise.reject(new Error('no helper in a unit test'));
        },
      },
      clock,
    ),
    freeSocksPort: () => Promise.resolve(1080),
    bundles: {
      helperScript: '/extension/dist/connection-helper.js',
      askpassProgram: '/extension/dist/askpass.js',
      runtime: '/editor/code',
    },
    folders: {
      registry: '/storage/registry',
      runtime: '/run/user/1000',
      clientTemporary: '/tmp',
    },
    files: {} as unknown as ConnectMachine['files'],
    clientFiles: {} as unknown as ConnectMachine['clientFiles'],
    download: {} as unknown as ConnectMachine['download'],
    scheduler: clock.scheduler(),
    clock: {now: () => clock.now(), wait: () => Promise.resolve()},
    local: new FakeLocalPort(),
    prober: changes.prober ?? new FakeProber({}),
    newTemporaryToken: () => 'token',
    drawLinkNumber: () => 7,
  };
  return {surfaces, machine, clock, recorded};
}

function loggerOf(recorded: Recorded): ReturnType<typeof createLogger> {
  return createLogger(recorded.sink, {minimumLevel: (): Level => 'info'});
}

/** The ssh-remote target of `text`, as the resolver host decodes it. */
function decoded(text: string): DecodedTarget {
  return {
    family: 'ssh-remote',
    target: {kind: 'plain', text},
    rawHostString: text,
  };
}

/** The connect of the fixture's input through a connector over `written`, with what the fakes saw. */
async function connected(
  written: Written = {},
): Promise<{result: unknown; recorded: Recorded}> {
  const {surfaces, machine, recorded} = assemblyInputs(written);
  const {connector} = connectAssemblyOf(surfaces, machine, loggerOf(recorded));
  const result = await connector.connect({
    ...INPUT,
    target: {kind: 'plain', text: 'dev'},
    rawHostString: 'dev',
  });
  return {result, recorded};
}

/** The assembly over a helper client on `files`, which starts no helper. */
function assemblyOverFiles(
  files: MemoryFilePort,
): ReturnType<typeof connectAssemblyOf> {
  const {surfaces, machine, clock, recorded} = assemblyInputs();
  return connectAssemblyOf(
    surfaces,
    {
      ...machine,
      helpers: clientEnvironment(
        {
          files,
          endpoints: new FakeEndpointPort(),
          spawn: () => Promise.reject(new Error('no helper in a unit test')),
        },
        clock,
      ),
    },
    loggerOf(recorded),
  );
}

describe('the Kill Local Connection Server of the assembled connect (card connect-21)', () => {
  /** The assembly over a helper client on a file port the test can read afterwards. */
  function killing(): {
    files: MemoryFilePort;
    kill: (hostString: string) => Promise<void>;
  } {
    const files = new MemoryFilePort();
    const assembly = assemblyOverFiles(files);
    return {files, kill: hostString => assembly.killLocalServer(hostString)};
  }

  it('F-2102 AC-21: the kill reads the record of the host in the registry folder and creates and removes nothing', async () => {
    const {files, kill} = killing();
    await kill('dev');
    deepStrictEqual(
      [
        files.calls.map(call => call.operation),
        files.calls.every(call => call.path.startsWith('/storage/registry')),
      ],
      [['read'], true],
    );
  });

  it('F-2102 AC-17: two host strings read two different records', async () => {
    const {files, kill} = killing();
    await kill('dev');
    await kill('alex@10.0.0.5');
    deepStrictEqual(new Set(files.calls.map(call => call.path)).size, 2);
  });
});

describe('the connect assembled from the editor and the machine', () => {
  it('connect-14: a connect looks the host up with the found client, then asks the helper to start', async () => {
    const {recorded} = await connected();
    deepStrictEqual(
      [recorded.spawned.started, recorded.helperStarts.length],
      [['ssh -V', 'ssh -G -- dev'], 1],
    );
  });

  it('F-2101: remote.SSH.path names the client the connect checks first', async () => {
    const {surfaces, machine, recorded} = assemblyInputs({
      'remote.SSH.path': '/opt/ssh',
    });
    const {connector} = connectAssemblyOf(
      surfaces,
      {
        ...machine,
        spawner: spawnerOf(
          {'/opt/ssh': OPENSSH},
          {kind: 'exit', output: OPTIONS_TEXT, status: 0},
          recorded.spawned,
        ),
      },
      loggerOf(recorded),
    );
    await connector.connect({
      ...INPUT,
      target: {kind: 'plain', text: 'dev'},
      rawHostString: 'dev',
    });
    deepStrictEqual(recorded.spawned.started[0], '/opt/ssh -V');
  });

  it("ruled on #253 Q8: the helper is the extension's bundle, run by the editor's runtime", async () => {
    const {recorded} = await connected();
    const parameters = JSON.parse(
      recorded.helperStarts[0]?.REMOTE_OSS_HELPER_PARAMETERS ?? '{}',
    ) as {options?: {runtime?: string; askpassProgram?: string}};
    deepStrictEqual(
      [parameters.options?.runtime, parameters.options?.askpassProgram],
      ['/editor/code', '/extension/dist/askpass.js'],
    );
  });

  it('F-2601: a helper that cannot start fails the connect, which the window is told', async () => {
    const {result} = await connected();
    deepStrictEqual((result as Failed).kind, 'unknown');
  });

  it('F-2304: the progress starts with S129 naming the host alias', () => {
    const {surfaces, machine, recorded} = assemblyInputs();
    const {options} = connectAssemblyOf(surfaces, machine, loggerOf(recorded));
    deepStrictEqual(
      options.startTitle(decoded('alex@dev:22')),
      '<Setting up SSH Host {0}>'.replace('{0}', 'dev'),
    );
  });

  it('F-2304 AC-29: a typed user@host or user@host:port target is titled by the host alone', () => {
    const {surfaces, machine, recorded} = assemblyInputs();
    const {options} = connectAssemblyOf(surfaces, machine, loggerOf(recorded));
    deepStrictEqual(
      [
        options.startTitle(decoded('alex@dev')),
        options.startTitle(decoded('alex@dev:22')),
      ],
      ['<Setting up SSH Host dev>', '<Setting up SSH Host dev>'],
    );
  });

  it('F-2304: a stage shows its own message', () => {
    const {surfaces, machine, recorded} = assemblyInputs();
    const {options} = connectAssemblyOf(surfaces, machine, loggerOf(recorded));
    deepStrictEqual(
      options.titleOf({name: 'initializing'}, decoded('dev')),
      '<Initializing VS Code Server>',
    );
  });

  it('F-2304: the share downloaded keeps the message of the stage before it', () => {
    const {surfaces, machine, recorded} = assemblyInputs();
    const {options} = connectAssemblyOf(surfaces, machine, loggerOf(recorded));
    const stages: ConnectPhase[] = [
      {name: 'downloading'},
      {name: 'serverDownloadPercent', percent: 40},
    ];
    deepStrictEqual(
      stages.map(phase => options.titleOf(phase, decoded('dev'))),
      ['<Downloading VS Code Server>', '<Downloading VS Code Server>'],
    );
  });

  it('F-2304: a share downloaded before any stage shows nothing', () => {
    const {surfaces, machine, recorded} = assemblyInputs();
    const {options} = connectAssemblyOf(surfaces, machine, loggerOf(recorded));
    deepStrictEqual(
      options.titleOf(
        {name: 'serverDownloadPercent', percent: 40},
        decoded('dev'),
      ),
      '',
    );
  });

  it("F-2304: a new connect's share downloaded does not keep the last connect's message", () => {
    const {surfaces, machine, recorded} = assemblyInputs();
    const {options} = connectAssemblyOf(surfaces, machine, loggerOf(recorded));
    options.titleOf({name: 'downloading'}, decoded('dev'));
    options.startTitle(decoded('dev'));
    deepStrictEqual(
      options.titleOf(
        {name: 'serverDownloadPercent', percent: 40},
        decoded('dev'),
      ),
      '',
    );
  });

  it('F-2304 BR-2, F-2001 BR-12: ssh-remote is not cancellable and never trusted', () => {
    const {surfaces, machine, recorded} = assemblyInputs();
    const {options} = connectAssemblyOf(surfaces, machine, loggerOf(recorded));
    deepStrictEqual(
      [options.family, options.cancellable, options.allowsTrust],
      ['ssh-remote', false, false],
    );
  });

  /** The connector's and the client check's answers on the mode, for the user's `written` settings. */
  function modesFor(written: Written): [boolean | undefined, string] {
    const {surfaces, machine, recorded} = assemblyInputs(written);
    let given: ConnectorDependencies | undefined;
    connectAssemblyOf(surfaces, machine, loggerOf(recorded), dependencies => {
      given = dependencies;
      return connectorOf(dependencies);
    });
    return [
      given?.terminalMode(),
      wiringPortsOf(surfaces, machine, loggerOf(recorded)).locate.mode(),
    ];
  }

  it('contracts §3.2 (athena on #385): the details link and the client check agree on shared mode', () => {
    deepStrictEqual(modesFor({}), [false, 'shared']);
  });

  it('contracts §3.2 (athena on #385): the details link and the client check agree on terminal mode', () => {
    deepStrictEqual(modesFor({'remote.SSH.useLocalServer': false}), [
      true,
      'terminal',
    ]);
  });

  it('F-2304: the details link reveals the log', () => {
    const {surfaces, machine, recorded} = assemblyInputs();
    connectAssemblyOf(
      surfaces,
      machine,
      loggerOf(recorded),
    ).connector.revealDetails();
    deepStrictEqual(recorded.revealed, 1);
  });

  it('contracts §3.2: a target that is not an ssh one has no alias in the title', () => {
    const {surfaces, machine, recorded} = assemblyInputs();
    const {options} = connectAssemblyOf(surfaces, machine, loggerOf(recorded));
    deepStrictEqual(
      options.startTitle({
        family: 'ssh-remote',
        target: {distro: 'Ubuntu'},
        rawHostString: 'Ubuntu',
      }),
      '<Setting up SSH Host {0}>'.replace('{0}', ''),
    );
  });
});

describe("the assembled ports' settings", () => {
  it('F-3902 rule 1: a user download template is an override from the default profile', () => {
    const {surfaces, machine, recorded} = assemblyInputs({
      'remote.SSH.serverDownloadUrlTemplate':
        'https://example.invalid/${commit}',
    });
    deepStrictEqual(
      wiringPortsOf(surfaces, machine, loggerOf(recorded)).settings.override(),
      {value: 'https://example.invalid/${commit}', layer: 'defaultProfileUser'},
    );
  });

  it('F-3902 rule 1: an empty template is no override', () => {
    const {surfaces, machine, recorded} = assemblyInputs({
      'remote.SSH.serverDownloadUrlTemplate': '',
    });
    deepStrictEqual(
      wiringPortsOf(surfaces, machine, loggerOf(recorded)).settings.override(),
      undefined,
    );
  });

  it('F-2403: remote.SSH.useExecServer is read as a switch', () => {
    const {surfaces, machine, recorded} = assemblyInputs({
      'remote.SSH.useExecServer': true,
    });
    deepStrictEqual(
      wiringPortsOf(
        surfaces,
        machine,
        loggerOf(recorded),
      ).settings.useExecServer(),
      true,
    );
  });

  it('F-2311 R1, F-2312 R1: the forwarding switches are read from the settings at each call', () => {
    const {surfaces, machine, recorded} = assemblyInputs({
      'remote.SSH.enableAgentForwarding': false,
    });
    const {settings} = wiringPortsOf(surfaces, machine, loggerOf(recorded));
    deepStrictEqual(
      [settings.agentForwarding(), settings.x11Forwarding()],
      [false, true],
    );
  });

  it('F-2108: remote.SSH.preconnect is passed on as written', () => {
    const {surfaces, machine, recorded} = assemblyInputs({
      'remote.SSH.preconnect': '/home/alex/renew.sh',
    });
    deepStrictEqual(
      wiringPortsOf(
        surfaces,
        machine,
        loggerOf(recorded),
      ).settings.preconnect(),
      '/home/alex/renew.sh',
    );
  });

  it('F-2102: the shared connection on is the shared mode', () => {
    const {surfaces, machine, recorded} = assemblyInputs();
    deepStrictEqual(
      wiringPortsOf(surfaces, machine, loggerOf(recorded)).locate.mode(),
      'shared',
    );
  });

  it('F-2410: socket mode is the terminal mode, whatever remote.SSH.useLocalServer says', () => {
    const {surfaces, machine, recorded} = assemblyInputs({
      'remote.SSH.remoteServerListenOnSocket': true,
    });
    deepStrictEqual(
      wiringPortsOf(surfaces, machine, loggerOf(recorded)).locate.mode(),
      'terminal',
    );
  });

  it('F-2102: the shared connection off is the terminal mode', () => {
    const {surfaces, machine, recorded} = assemblyInputs({
      'remote.SSH.useLocalServer': false,
    });
    deepStrictEqual(
      wiringPortsOf(surfaces, machine, loggerOf(recorded)).locate.mode(),
      'terminal',
    );
  });

  it("connect-14: the processes get the editor's environment without its unset entries", () => {
    const {surfaces, machine, recorded} = assemblyInputs();
    deepStrictEqual(
      wiringPortsOf(surfaces, machine, loggerOf(recorded)).locate
        .processEnvironment,
      {PATH: '/usr/bin'},
    );
  });

  it('F-2601: the reconnection limit is read at each connect', async () => {
    const {surfaces, machine, recorded} = assemblyInputs();
    const reads: string[] = [];
    const counted: ConnectSurfaces = {
      ...surfaces,
      settings: {
        inspectSetting: settingId => {
          if (settingId === SETTINGS.maxReconnectionAttempts.id) {
            reads.push(settingId);
          }
          return surfaces.settings.inspectSetting(settingId);
        },
      },
    };
    const {connector} = connectAssemblyOf(counted, machine, loggerOf(recorded));
    const input = {
      ...INPUT,
      target: {kind: 'plain', text: 'dev'},
      rawHostString: 'dev',
    } as const;
    await connector.connect(input);
    await connector.connect({...input, attempt: 2, isReconnection: true});
    deepStrictEqual(reads.length >= 2, true);
  });
});

describe("the assembled ports' other parts", () => {
  it('F-2101: a remote.SSH.path that is not text is no path', () => {
    const {surfaces, machine, recorded} = assemblyInputs({
      'remote.SSH.path': 42,
    });
    deepStrictEqual(
      wiringPortsOf(
        surfaces,
        machine,
        loggerOf(recorded),
      ).locate.settingValue(),
      '',
    );
  });

  it("F-2305: the login's questions are shown through the prompt surface, which ends when disposed", () => {
    const {surfaces, machine, recorded} = assemblyInputs();
    const listening: string[] = [];
    const attached = wiringPortsOf(
      surfaces,
      machine,
      loggerOf(recorded),
    ).attachLogin(
      {
        onNotice: () => {
          listening.push('on');
          return () => {
            listening.push('off');
          };
        },
        answer: () => Promise.resolve(false),
        refuse: () => Promise.resolve(false),
      },
      'dev',
    );
    attached.dispose();
    deepStrictEqual(listening, ['on', 'off']);
  });

  it("connect-14: the server steps read the machine's clock", () => {
    const {surfaces, machine, recorded} = assemblyInputs();
    deepStrictEqual(
      wiringPortsOf(
        surfaces,
        {...machine, clock: {now: () => 1234, wait: () => Promise.resolve()}},
        loggerOf(recorded),
      ).server.clock(),
      1234,
    );
  });

  it('F-2104: the tunnel reads its path settings at each connect', () => {
    const {surfaces, machine, recorded} = assemblyInputs({
      'remote.SSH.remoteServerListenOnSocket': true,
    });
    deepStrictEqual(
      wiringPortsOf(surfaces, machine, loggerOf(recorded)).tunnel.settings()
        .listenOnSocket,
      true,
    );
  });
});

describe("the assembled ports' terminal mode", () => {
  it('F-2104 BR-1: the install ssh holds the -D when the window tunnel takes the SOCKS path', () => {
    const {surfaces, machine, recorded} = assemblyInputs({
      'remote.SSH.useLocalServer': false,
      'remote.SSH.enableDynamicForwarding': true,
    });
    deepStrictEqual(
      wiringPortsOf(
        surfaces,
        machine,
        loggerOf(recorded),
      ).terminal.dynamicForwarding(),
      true,
    );
  });

  it('F-2104 BR-1: socket mode takes no -D', () => {
    const {surfaces, machine, recorded} = assemblyInputs({
      'remote.SSH.remoteServerListenOnSocket': true,
    });
    deepStrictEqual(
      wiringPortsOf(
        surfaces,
        machine,
        loggerOf(recorded),
      ).terminal.dynamicForwarding(),
      false,
    );
  });

  it("themis on #385: the install ssh's -D port is the machine's free loopback port", async () => {
    const {surfaces, machine, recorded} = assemblyInputs();
    deepStrictEqual(
      await wiringPortsOf(
        surfaces,
        {...machine, freeSocksPort: () => Promise.resolve(43210)},
        loggerOf(recorded),
      ).terminal.freePort(),
      43210,
    );
  });

  it("themis on #385: the install terminal's run markers are the helper client's nonces", () => {
    const {surfaces, machine, recorded} = assemblyInputs();
    deepStrictEqual(
      wiringPortsOf(
        surfaces,
        {...machine, helpers: {...machine.helpers, newNonce: () => 'n0nce'}},
        loggerOf(recorded),
      ).terminal.newMarker(),
      'n0nce',
    );
  });

  it('F-2308 BR-3: remote.SSH.showLoginTerminal is read as a switch', () => {
    const {surfaces, machine, recorded} = assemblyInputs({
      'remote.SSH.showLoginTerminal': true,
    });
    deepStrictEqual(
      wiringPortsOf(
        surfaces,
        machine,
        loggerOf(recorded),
      ).terminal.revealLoginTerminals(),
      true,
    );
  });

  it("F-2306 AC-20: the terminal's questions are answered by connect-16's owner, which refuses after a dismissal", () => {
    const {surfaces, machine, recorded} = assemblyInputs();
    const sent: string[] = [];
    const questions = wiringPortsOf(
      surfaces,
      machine,
      loggerOf(recorded),
    ).terminal.attachQuestions(
      {
        terminal: {
          send: (text: string) => {
            sent.push(text);
          },
        },
        reader: {inputOpened: () => undefined, inputClosed: () => undefined},
      },
      {...INPUT, target: {kind: 'plain', text: 'alex@dev'}},
    );
    questions.onQuestion("alex@dev's password: ");
    return new Promise<void>(resolve => {
      setImmediate(() => {
        questions.dispose();
        deepStrictEqual(sent, ['\r']);
        resolve();
      });
    });
  });
});

describe("the assembled ports' window port", () => {
  it('F-2104 BR-6: the window port is the first free one in the preferred range', async () => {
    const {surfaces, machine, recorded} = assemblyInputs(
      {'remote.SSH.preferredLocalPortRange': '40000-40002'},
      {prober: new FakeProber({40000: 'open', 40001: 'refused'})},
    );
    deepStrictEqual(
      await wiringPortsOf(
        surfaces,
        machine,
        loggerOf(recorded),
      ).tunnel.chooseLocalPort(),
      {port: 40001},
    );
  });

  it('F-2104 7.E1: no free port in the range gives the busy range', async () => {
    const {surfaces, machine, recorded} = assemblyInputs(
      {'remote.SSH.preferredLocalPortRange': '40000-40000'},
      {prober: new FakeProber({40000: 'open'})},
    );
    deepStrictEqual(
      await wiringPortsOf(
        surfaces,
        machine,
        loggerOf(recorded),
      ).tunnel.chooseLocalPort(),
      {busyRange: {first: 40000, last: 40000}},
    );
  });

  it('F-2104 7.E1: with no range and no free random port there is no port', async () => {
    const {surfaces, machine, recorded} = assemblyInputs(
      {},
      {prober: new FakeProber({})},
    );
    deepStrictEqual(
      await wiringPortsOf(
        surfaces,
        machine,
        loggerOf(recorded),
      ).tunnel.chooseLocalPort(),
      {noPort: true},
    );
  });

  it('F-2104 BR-6: an invalid range is ignored, and the log says why', async () => {
    const {surfaces, machine, recorded} = assemblyInputs(
      {'remote.SSH.preferredLocalPortRange': 'many'},
      {prober: new FakeProber({})},
    );
    await wiringPortsOf(
      surfaces,
      machine,
      loggerOf(recorded),
    ).tunnel.chooseLocalPort();
    deepStrictEqual(
      recorded.sink.lines.some(line =>
        line.message.includes(
          'remote.SSH.preferredLocalPortRange is ignored: badFormat',
        ),
      ),
      true,
    );
  });

  it('F-2104 BR-6: no range searches any port, and logs nothing about the setting', async () => {
    const prober = new FakeProber({});
    const {surfaces, machine, recorded} = assemblyInputs({}, {prober});
    await wiringPortsOf(
      surfaces,
      machine,
      loggerOf(recorded),
    ).tunnel.chooseLocalPort();
    deepStrictEqual(
      recorded.sink.lines.filter(line =>
        line.message.includes('preferredLocalPortRange'),
      ),
      [],
    );
  });

  it('F-2104 BR-1: the dialer reaches the server through the SOCKS port it is given', async () => {
    const local = new FakeLocalPort('work', ['fail']);
    const {surfaces, machine, recorded} = assemblyInputs();
    const dialer = wiringPortsOf(
      surfaces,
      {...machine, local},
      loggerOf(recorded),
    ).tunnel.dialerFor(1080);
    await dialer.dial({kind: 'port', port: 4321}).catch(() => undefined);
    deepStrictEqual(local.connected, [1080]);
  });
});

/** A run base for the host `dev`, with the client the lookup accepted. */
const RUN_BASE: RunBase = {
  target: {host: 'dev', user: 'alex', port: 22},
  settings: {
    configFile: '',
    connectTimeout: 15,
    permitPtyAllocation: false,
    remoteCommandInEffect: false,
  },
  effective: {
    hostName: 'dev',
    user: 'alex',
    port: '22',
    localForwards: [],
    clearAllForwardings: false,
  },
  programs: {sshProgram: 'ssh', scpProgram: 'scp'},
  homeFolder: '/home/alex',
  platform: 'linux',
};

/** The channel the assembly makes for `dev`, with `prompts` in place of the silent ones, its terminals and its clock. */
function channelOver(
  written: Written = {},
  prompts?: PromptEditor,
): {
  channel: ReturnType<ReturnType<typeof wiringPortsOf>['channelFor']>;
  terminals: RecordingTerminals;
  clock: FakeClock;
  recorded: Recorded;
} {
  const {surfaces, machine, clock, recorded} = assemblyInputs(written);
  const terminals = new RecordingTerminals();
  const channel = wiringPortsOf(
    {...surfaces, prompts: prompts ?? SILENT_PROMPTS, terminals},
    machine,
    loggerOf(recorded),
  ).channelFor({} as unknown as SharedConnection, {
    hostString: 'alex@dev:22',
    base: RUN_BASE,
    terms: TERMS,
    connectWait: {
      connectTimeoutSeconds: 15,
      fromHost: false,
      unboundedWaitSeconds: 600,
    },
    displayHost: 'dev',
  });
  return {channel, terminals, clock, recorded};
}

/** Starts a copy over the channel, with `prompts` in place of the silent ones, and lets the terminal open. */
async function copyStarted(
  written: Written = {},
  prompts?: PromptEditor,
): Promise<ReturnType<typeof channelOver> & {copy: Promise<unknown>}> {
  const over = channelOver(written, prompts);
  const copy = over.channel.copyToHost({
    localFile: '/tmp/server.tar.gz',
    remotePath: '/home/alex/.server/server.tar.gz',
    cancellation: new AbortController().signal,
  });
  await Promise.resolve();
  return {...over, copy};
}

/** Lets the microtasks that are ready run. */
async function settled(): Promise<void> {
  for (let round = 0; round < 5; round++) {
    await Promise.resolve();
  }
}

/** Whether the copy has not settled by the time the microtasks drain. */
async function stillOpen(copy: Promise<unknown>): Promise<boolean> {
  const which = await Promise.race([
    copy.then(() => 'settled'),
    settled().then(() => 'still-open'),
  ]);
  return which === 'still-open';
}

/** A prompt editor that records each pick's title and answers nothing; `translate` is the identity. */
function recordingPrompts(): {prompts: PromptEditor; titles: string[]} {
  const titles: string[] = [];
  const prompts: PromptEditor = {
    pick: request => {
      titles.push(request.title ?? '');
      return Promise.resolve(undefined);
    },
    maskedInput: () => Promise.resolve(undefined),
    translate: template => template,
  };
  return {prompts, titles};
}

describe("the assembled ports' channel", () => {
  it('ruled on #253 Q10: the channel runs on the shared session', () => {
    const {channel} = channelOver();
    deepStrictEqual(
      [channel.identity(), channel.platformHint()],
      ['alex@dev:22', 'unknown'],
    );
  });

  it('F-2405 BR-8, AC-9: the window copies in a login terminal of its own', async () => {
    const {terminals} = await copyStarted();
    deepStrictEqual(
      terminals.opened.map(terminal => terminal.name),
      ['Copy VS Code Server'],
    );
  });

  it('F-2405 BR-8: no copy process is started outside the terminal', async () => {
    const {recorded} = await copyStarted();
    deepStrictEqual(recorded.spawned.started, []);
  });

  it("F-2405 BR-6, #253 Q13: the terminal runs scp to the run's host with -v and the timeout", async () => {
    const {terminals} = await copyStarted();
    deepStrictEqual(terminals.opened[0]?.invocation, {
      program: 'scp',
      arguments: [
        '-v',
        '-o',
        'ConnectTimeout=15',
        '--',
        '/tmp/server.tar.gz',
        'dev:/home/alex/.server/server.tar.gz',
      ],
      environment: {},
    });
  });

  it('F-2405 AC-10: the copy terminal stays hidden', async () => {
    const {terminals} = await copyStarted();
    deepStrictEqual(terminals.opened[0]?.revealedAtOpen, false);
  });

  it('F-2308 BR-3: remote.SSH.showLoginTerminal reveals the copy terminal', async () => {
    const {terminals} = await copyStarted({
      'remote.SSH.showLoginTerminal': true,
    });
    deepStrictEqual(terminals.opened[0]?.revealedAtOpen, true);
  });

  it('F-2405 5.0 step 7: the copy ends copied when scp exits 0', async () => {
    const {terminals, copy} = await copyStarted();
    terminals.opened[0]?.end(0);
    deepStrictEqual(await copy, {kind: 'copied'});
  });

  it('themis on #419 (1), F-2105 BR-3: a silent copy is unsettled just before its connect wait (16 999 ms)', async () => {
    const {copy, clock} = await copyStarted();
    clock.advance(16_999);
    deepStrictEqual(await stillOpen(copy), true);
  });

  it('themis on #419 (1), F-2105 BR-3: a silent copy settles with a timeout at its connect wait (17 000 ms)', async () => {
    const {copy, clock} = await copyStarted();
    clock.advance(17_000);
    deepStrictEqual(await copy, {
      kind: 'failed',
      failure: {kind: 'timeout', detail: 'the copy login did not finish'},
    });
  });

  it("themis on #419 (2), F-2305 BR-2: the copy terminal's host-key question names the display host and the fingerprint", async () => {
    const {prompts, titles} = recordingPrompts();
    const {terminals, clock} = await copyStarted({}, prompts);
    const [terminal] = terminals.opened;
    terminal?.write(
      "The authenticity of host 'dev (192.0.2.1)' can't be established.\n" +
        'ED25519 key fingerprint is SHA256:abc.\n' +
        'Are you sure you want to continue connecting (yes/no/[fingerprint])? ',
    );
    clock.advance(100);
    deepStrictEqual(titles, [
      textOf({id: 'S001', values: ['dev', 'SHA256:abc']}, template => template),
    ]);
  });

  it('lib-product: a policy table without remote-ssh is a defect', () => {
    throws(() => sshOverridePolicy({}), /no override policy for remote-ssh/);
  });
});

describe('application-scope settings ignore workspace values', () => {
  /** A setting host whose remote.SSH.path, configFile and remotePlatform are set only in the workspace and the folder. */
  const WORKSPACE_ONLY: SettingHost = {
    inspectSetting: settingId =>
      ({
        'remote.SSH.path': {
          defaultValue: '',
          workspaceValue: '/w/ssh',
          workspaceFolderValue: '/f/ssh',
        },
        'remote.SSH.configFile': {
          defaultValue: '',
          workspaceValue: '/w/config',
          workspaceFolderValue: '/f/config',
        },
        'remote.SSH.remotePlatform': {
          defaultValue: undefined,
          workspaceValue: {devbox: 'windows'},
          workspaceFolderValue: {devbox: 'windows'},
        },
      })[settingId] ?? {defaultValue: undefined},
  };

  /** A setting host whose remote.SSH.path is set in the user settings, the workspace and the folder. */
  const USER_AND_WORKSPACE: SettingHost = {
    inspectSetting: () => ({
      defaultValue: '',
      globalValue: '/u/ssh',
      workspaceValue: '/w/ssh',
      workspaceFolderValue: '/f/ssh',
    }),
  };

  it('F-2101 AC-13: a remote.SSH.path set only in workspace settings is never used', () => {
    deepStrictEqual(settingTextOf(WORKSPACE_ONLY, 'path'), '');
  });

  it('F-2101 AC-13: a remote.SSH.path in the user settings is used, whatever the workspace sets', () => {
    deepStrictEqual(settingTextOf(USER_AND_WORKSPACE, 'path'), '/u/ssh');
  });

  it('F-2201 AC-14: a remote.SSH.configFile set only in workspace settings is ignored', () => {
    deepStrictEqual(connectionSettingsOf(WORKSPACE_ONLY).configFile, '');
  });

  it('F-2206 AC-23: a workspace remotePlatform entry is ignored, so non-local mode asks', () => {
    deepStrictEqual(
      decidePlatform(
        {...termsSettingsOf(WORKSPACE_ONLY), useLocalServer: false},
        'devbox',
      ),
      {kind: 'ask'},
    );
  });
});

describe("the assembly's maintenance run (card connect-23)", () => {
  it('F-2411.BR-2: a run on a host that cannot be reached is a failed connection, with the cause', async () => {
    const {surfaces, machine, recorded} = assemblyInputs();
    const outcome = await connectAssemblyOf(
      surfaces,
      machine,
      loggerOf(recorded),
    ).maintain('kill', {host: 'dev'});
    deepStrictEqual(outcome.result, 'connectionFailed');
  });

  /** The record files a helper client on a fresh file port reads during `action`, each once. */
  async function recordsRead(
    action: (
      assembly: ReturnType<typeof connectAssemblyOf>,
    ) => Promise<unknown>,
  ): Promise<string[]> {
    const files = new MemoryFilePort();
    await action(assemblyOverFiles(files));
    return [
      ...new Set(
        files.calls
          .filter(call => call.operation === 'read')
          .map(call => call.path),
      ),
    ];
  }

  it("F-2411 AC-33: each kill ends a helper of its own after the run, never the window's, also when the run fails", async () => {
    const [windowRecord] = await recordsRead(assembly =>
      assembly.killLocalServer('dev'),
    );
    const kills = await recordsRead(async assembly => {
      await assembly.maintain('kill', {host: 'dev'});
      await assembly.maintain('kill', {host: 'dev'});
    });
    deepStrictEqual(
      [kills.length, new Set(kills).size, kills.includes(windowRecord ?? '')],
      [2, 2, false],
    );
  });
});

describe("the assembled ports' platform notice", () => {
  it("F-2206 5.2: the terms announce a stored platform through the surfaces' notice, naming it", async () => {
    const {surfaces, machine, recorded} = assemblyInputs();
    const shown: string[] = [];
    wiringPortsOf(
      {
        ...surfaces,
        notice: {
          showInformation: message => {
            shown.push(message);
            return Promise.resolve(undefined);
          },
          showWarning: () => Promise.resolve(undefined),
          showError: () => Promise.resolve(undefined),
        },
      },
      machine,
      loggerOf(recorded),
    ).terms.announcePlatform('linux');
    await new Promise(resolve => setImmediate(resolve));
    deepStrictEqual(
      shown.map(message => message.includes('"linux"')),
      [true],
    );
  });
});

describe("the assembled ports' CLI path", () => {
  it('F-2103 5.0 step 6: the S045 notification has its own text, translated', () => {
    const {surfaces, machine, recorded} = assemblyInputs();
    const titles: string[] = [];
    const progress = wiringPortsOf(
      {
        ...surfaces,
        downloadProgress: {
          show: title => {
            titles.push(title);
            return {report: () => undefined, close: () => undefined};
          },
        },
      },
      machine,
      loggerOf(recorded),
    ).cliPath.downloadProgress();
    progress.onLine({text: 'Downloading VSCodium server -> /tmp/x', level: 2});
    deepStrictEqual(titles, ['<Downloading VS Code Server...>']);
  });

  it("cli-04 §3: the CLI's secrets are the helpers' nonces, a new one each time", () => {
    const {surfaces, machine, recorded} = assemblyInputs();
    const {cliPath} = wiringPortsOf(surfaces, machine, loggerOf(recorded));
    deepStrictEqual(
      [cliPath.newSecret(), cliPath.newSecret()],
      ['nonce-1', 'nonce-2'],
    );
  });

  it("cli-04 §3: the CLI's serve names the editor's commit and quality", () => {
    const {surfaces, machine, recorded} = assemblyInputs();
    let given: unknown;
    connectAssemblyOf(surfaces, machine, loggerOf(recorded), options => {
      given = options.options.serve;
      return connectorOf(options);
    });
    deepStrictEqual(given, {
      commit: machine.profile.commit,
      quality: machine.profile.quality,
    });
  });
});
