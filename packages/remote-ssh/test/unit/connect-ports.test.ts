import {deepStrictEqual, throws} from 'node:assert';
import type {ConnectPhase, DecodedTarget, Failed} from 'lib-authority';
import {FakeProber} from 'lib-forwarding/testing/fake-prober';
import {FakeLocalPort} from 'lib-forwarding/testing/fake-network';
import {FakeClock} from 'lib-helper/testing/fake-clock';
import {FakeEndpointPort} from 'lib-helper/testing/fake-endpoint';
import {MemoryFilePort} from 'lib-helper/testing/memory-file-port';
import {clientEnvironment} from 'lib-helper/testing/client-environment';
import type {SettingInspection} from 'lib-identifiers';
import {createLogger, type Level} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import type {SharedConnection} from 'lib-ssh';
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
  OPENSSH,
  OPTIONS_TEXT,
  type Seen,
  SSH_PROGRAM,
  spawnerOf,
} from './locate.fixture.ts';
import {INPUT, TERMS} from './pipeline.fixture.ts';
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
): {surfaces: ConnectSurfaces; machine: ConnectMachine; recorded: Recorded} {
  const recorded: Recorded = {
    spawned: {started: [], killed: []},
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
  };
  return {surfaces, machine, recorded};
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
      40001,
    );
  });

  it('F-2104 BR-9: no free port in the range gives none', async () => {
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
      undefined,
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

describe("the assembled ports' channel", () => {
  it('ruled on #253 Q10: the channel runs on the shared session', () => {
    const {surfaces, machine, recorded} = assemblyInputs();
    const channel = wiringPortsOf(
      surfaces,
      machine,
      loggerOf(recorded),
    ).channelFor({} as unknown as SharedConnection, {
      hostString: 'alex@dev:22',
      base: {} as unknown as Parameters<
        ReturnType<typeof wiringPortsOf>['channelFor']
      >[1]['base'],
      terms: TERMS,
    });
    deepStrictEqual(
      [channel.identity(), channel.platformHint()],
      ['alex@dev:22', 'unknown'],
    );
  });

  it('lib-product: a policy table without remote-ssh is a defect', () => {
    throws(() => sshOverridePolicy({}), /no override policy for remote-ssh/);
  });
});
