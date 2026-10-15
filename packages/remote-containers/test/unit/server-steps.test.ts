import {deepStrictEqual} from 'node:assert';
import {
  RecordingChannel,
  type CopyAnswer,
  type ScriptAnswer,
} from 'lib-host/testing/recording-channel';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import type {OverrideValue, ProductProfile} from 'lib-product';
import {
  archiveKeyOf,
  type ClientFilePort,
  clientArchiveFolder,
  type DownloadPort,
  type DownloadRequest,
  type DownloadResult,
  type LicenceModal,
  RESULT_BEGIN,
  RESULT_END,
} from 'lib-server';
import {FakeClock} from 'lib-server/testing/fake-clock';
import {
  containersOverridePolicy,
  runServerSteps,
  type ServerRequest,
  type ServerResult,
  type ServerStepDependencies,
  transferredDetail,
} from '../../src/connect/server-steps.ts';
import {VOLUME_FOLDERS_SCRIPT} from '../../src/connect/volume-folders.ts';

const PROFILE: ProductProfile = {
  applicationName: 'fixture',
  commit: 'abc123',
  version: '1.2.3',
  release: '',
  quality: 'stable',
  serverApplicationName: 'fixture-server',
  serverDataFolderName: '.fixture-server',
  serverDownloadUrlTemplate: '',
  serverLicense: [],
  serverLicenseUrl: '',
  dataFolderName: '.fixture',
  tunnelApplicationName: 'fixture-tunnel',
  urlProtocol: 'fixture',
  cliDownloadUrlTemplate: '',
  updateUrl: '',
  downloadUrl: '',
};

const OVERRIDE: OverrideValue = {
  value: 'https://example.invalid/server-${os}-${arch}.tar.gz',
  layer: 'defaultProfileUser',
};

const NEVER = new AbortController().signal;
const TREE = '/vscode/fixture-server/bin/linux-x64/abc123';

function blockOf(status: string, ...facts: string[]): string[] {
  return [RESULT_BEGIN, `status=${status}`, ...facts, RESULT_END];
}

function hostFacts(
  libc: string,
  treeComplete: boolean | undefined,
  installed = false,
): string[] {
  return [
    'host.os=linux',
    'host.arch=x64',
    `host.libc=${libc}`,
    'host.release=debian',
    'host.home=/home/node',
    'host.tmp=/tmp',
    'host.shell=sh',
    'host.tool.tar=yes',
    'host.tool.wget=yes',
    'host.tool.curl=no',
    'host.tool.unzip=no',
    'host.tool.flock=no',
    'host.wgetBusybox=no',
    'host.sshAuthSock=',
    'host.display=',
    `server.installDir=/home/node/.fixture-server/bin/abc123`,
    `server.installed=${installed ? 'yes' : 'no'}`,
    ...(treeComplete === undefined
      ? []
      : [`server.treeComplete=${treeComplete ? 'yes' : 'no'}`]),
  ];
}

const STARTED = blockOf(
  'Ok',
  'server.port=4321',
  'server.pid=77',
  'server.token=abcdefghijklmnopqrstuvwxyz012345',
  'server.reused=no',
);

function answer(
  matches: (script: string) => boolean,
  lines: readonly string[],
  status = 0,
): ScriptAnswer {
  return {
    interpreter: 'posixShell',
    matches,
    lines,
    ending: {kind: 'exit', status},
  };
}

function isProbe(script: string): boolean {
  return script.includes('fact host.os');
}
function isTreeProbe(script: string): boolean {
  return isProbe(script) && script.includes("INSTALL_TREE='/vscode");
}
function isFirstProbe(script: string): boolean {
  return isProbe(script) && !script.includes("INSTALL_TREE='/vscode");
}
function isRelay(script: string): boolean {
  return script.includes('cat > ');
}
function isInstall(script: string): boolean {
  return (
    script.includes('unpack_into "$ARCHIVE" "$INSTALL_DIR"') ||
    script.includes('install_tree "$ARCHIVE" ||')
  );
}
function isStart(script: string): boolean {
  return script.includes('ready_port()');
}

function isDiscard(script: string): boolean {
  return script.includes("ARCHIVE_REMOVE='yes'");
}

const COPIED: CopyAnswer = {matches: () => true, ending: {kind: 'copied'}};

/** The channel of a container whose probe finds `libc`, with the answers of a fresh install. */
function channelOf(
  options: {
    libc?: string;
    volume?: boolean;
    treeComplete?: boolean;
    installed?: boolean;
    start?: readonly string[];
    startStatus?: number;
    install?: readonly string[];
    extra?: ScriptAnswer[];
    copies?: CopyAnswer[];
  } = {},
): RecordingChannel {
  const libc = options.libc ?? 'glibc';
  const volume = options.volume ?? false;
  return new RecordingChannel({
    identity: 'c1',
    platformHint: 'linux',
    scripts: [
      answer(
        isFirstProbe,
        blockOf('Ok', ...hostFacts(libc, volume ? false : undefined)),
      ),
      ...(volume
        ? [
            answer(
              isTreeProbe,
              blockOf(
                'Ok',
                ...hostFacts(
                  libc,
                  options.treeComplete ?? false,
                  options.installed ?? false,
                ),
              ),
            ),
          ]
        : []),
      answer(isRelay, []),
      answer(isStart, options.start ?? STARTED, options.startStatus ?? 0),
      answer(isInstall, options.install ?? blockOf('Ok')),
      ...(options.extra ?? []),
    ],
    copies: options.copies ?? [COPIED],
  });
}

/** What a run recorded besides the channel. */
interface Seen {
  downloads: DownloadRequest[];
  renames: Array<[string, string]>;
  asked: string[];
  phases: string[];
  sink: MemorySink;
}

function dependenciesOf(
  seen: Seen,
  options: {
    profile?: ProductProfile;
    override?: OverrideValue | undefined;
    downloadFolder?: unknown;
    downloads?: DownloadResult[];
    modal?: LicenceModal;
  } = {},
): ServerStepDependencies {
  const downloads = [...(options.downloads ?? [])];
  const download: DownloadPort = {
    download: request => {
      seen.downloads.push(request);
      return Promise.resolve(
        downloads.shift() ?? {
          kind: 'downloaded',
          facts: {},
          finalAddress: request.address,
        },
      );
    },
  };
  const files: ClientFilePort = {
    remove: () => Promise.resolve(),
    exists: file =>
      Promise.resolve(seen.renames.some(([, kept]) => kept === file)),
    size: () => Promise.resolve(10),
    sha256: () => Promise.resolve('00'),
    rename: (source, destination) => {
      seen.renames.push([source, destination]);
      return Promise.resolve({kind: 'renamed'});
    },
  };
  return {
    profile: options.profile ?? PROFILE,
    override: 'override' in options ? options.override : OVERRIDE,
    downloadFolder: options.downloadFolder,
    temporaryFolder: '/tmp',
    store: {
      isAccepted: () => false,
      accept: () => Promise.resolve(),
    },
    modal: options.modal ?? {
      askUser: terms => {
        seen.asked.push(terms);
        return Promise.resolve('accept');
      },
    },
    download,
    files,
    clock: new FakeClock(),
    newTemporaryToken: () => 'token',
    logger: createLogger(seen.sink, {minimumLevel: () => 'info'}),
  };
}

/** A root channel whose one script prints `lines` and ends as `ending` says; `onRun` sees when it runs. */
function rootChannelOf(
  lines: readonly string[] = blockOf('Ok', 'server.created='),
  ending: ScriptAnswer['ending'] = {kind: 'exit', status: 0},
  onRun: () => void = () => undefined,
): RecordingChannel {
  return new RecordingChannel({
    identity: 'c1',
    platformHint: 'linux',
    scripts: [
      {
        interpreter: 'posixShell',
        matches: script => script === VOLUME_FOLDERS_SCRIPT,
        lines: () => {
          onRun();
          return lines;
        },
        ending,
      },
    ],
  });
}

async function runSteps(
  channel: RecordingChannel,
  options: Parameters<typeof dependenciesOf>[1] & {
    volume?: boolean;
    defaultExtensions?: readonly string[];
    cancellation?: AbortSignal;
    root?: RecordingChannel;
  } = {},
): Promise<{result: ServerResult; seen: Seen}> {
  const seen: Seen = {
    downloads: [],
    renames: [],
    asked: [],
    phases: [],
    sink: new MemorySink(),
  };
  const request: ServerRequest = {
    channel,
    rootChannel: options.root ?? rootChannelOf(),
    remoteUser: 'node',
    volumeMounted: options.volume ?? false,
    defaultExtensions: options.defaultExtensions ?? [],
    onPhase: phase => {
      seen.phases.push(phase);
    },
    cancellation: options.cancellation ?? NEVER,
  };
  return {
    result: await runServerSteps(dependenciesOf(seen, options), request),
    seen,
  };
}

function scriptsOf(channel: RecordingChannel): string[] {
  return channel.calls.flatMap(call =>
    call.operation === 'runScript' ? [call.request.script] : [],
  );
}

function failureKind(result: ServerResult): string | undefined {
  return result.kind === 'failed' ? result.failure.kind : undefined;
}

function treesOf(channel: RecordingChannel): string[] {
  return scriptsOf(channel).map(script => {
    const found = /INSTALL_TREE='([^']*)'/.exec(script);
    return found?.[1] ?? 'none';
  });
}

describe('the server steps of a connect (card containers-08)', () => {
  it('transport contracts 5.0, F-0419 AC-37: every script of a connect runs under umask 022, the server’s scripts by their parameter and the relay’s own copy by its own line', async () => {
    const channel = channelOf();
    await runSteps(channel);
    deepStrictEqual(
      scriptsOf(channel).map(
        script =>
          script.includes("INSTALL_UMASK='022'") ||
          script.startsWith('set -e\numask 022\n'),
      ),
      scriptsOf(channel).map(() => true),
    );
  });

  it('F-0503 5.0: a fresh install downloads, installs, starts and gives the port, the token and the paths', async () => {
    const channel = channelOf();
    const {result, seen} = await runSteps(channel);
    deepStrictEqual(
      [result, seen.phases],
      [
        {
          kind: 'started',
          port: 4321,
          connectionToken: 'abcdefghijklmnopqrstuvwxyz012345',
          processId: 77,
          reused: false,
          nodePath: '/home/node/.fixture-server/bin/abc123/node',
          relayPath: result.kind === 'started' ? result.relayPath : '',
        },
        ['installing', 'startingServer'],
      ],
    );
  });

  it("F-0505 5.0 step 5: the new container's extensions reach the start as installs, in order", async () => {
    const channel = channelOf();
    await runSteps(channel, {defaultExtensions: ['a.b', 'c.d']});
    const start = scriptsOf(channel).find(isStart) ?? '';
    deepStrictEqual(
      [
        start.indexOf("'--install-extension' 'a.b'") <
          start.indexOf("'--install-extension' 'c.d'"),
        start.includes("'--install-extension' 'a.b'"),
      ],
      [true, true],
    );
  });

  it('F-0505 BR-11: a request with no extensions starts the server with no install', async () => {
    const channel = channelOf();
    await runSteps(channel);
    deepStrictEqual(
      (scriptsOf(channel).find(isStart) ?? '').includes('--install-extension'),
      false,
    );
  });

  it('F-0503 AC-52: the start runs with telemetry off (BR-17) and in host-proxy mode', async () => {
    const channel = channelOf();
    await runSteps(channel);
    const start = scriptsOf(channel).find(isStart) ?? '';
    deepStrictEqual(
      [
        start.includes("'--telemetry-level' 'off'"),
        start.includes("'--use-host-proxy'"),
      ],
      [true, true],
    );
  });

  it('F-1402, F-0503 BR-14(e): the override, the product template and the built-in table each give the address', async () => {
    const withTemplate: ProductProfile = {
      ...PROFILE,
      serverDownloadUrlTemplate:
        'https://product.invalid/${os}-${arch}-${commit}.tar.gz',
    };
    const codium: ProductProfile = {...PROFILE, applicationName: 'codium'};
    const addresses: string[] = [];
    for (const [profile, override] of [
      [PROFILE, OVERRIDE],
      [withTemplate, undefined],
      [codium, undefined],
    ] as const) {
      const {seen} = await runSteps(channelOf(), {profile, override});
      addresses.push(seen.downloads[0]?.address ?? '');
    }
    deepStrictEqual(addresses, [
      'https://example.invalid/server-linux-x64.tar.gz',
      'https://product.invalid/linux-x64-abc123.tar.gz',
      'https://github.com/VSCodium/vscodium/releases/download/1.2.3/vscodium-reh-linux-x64-1.2.3.tar.gz',
    ]);
  });

  it('F-0503 BR-14(e): no source at all is noServerSource', async () => {
    const {result} = await runSteps(channelOf(), {override: undefined});
    deepStrictEqual(
      result.kind === 'failed' && [result.failure.kind, result.failure.reason],
      [
        'noServerSource',
        {
          id: 'noServerSource',
          values: ['remote-oss.remote-containers', 'fixture'],
        },
      ],
    );
  });

  it('F-0503 BR-14(d): an override that is not usable is noServerSource too', async () => {
    const {result} = await runSteps(channelOf(), {
      override: {
        value: 'https://x.invalid/${nope}',
        layer: 'defaultProfileUser',
      },
    });
    deepStrictEqual(failureKind(result), 'noServerSource');
  });

  it('F-0503 AC-38: a built-in table archive is kept under its version', async () => {
    const codium: ProductProfile = {...PROFILE, applicationName: 'codium'};
    const {seen} = await runSteps(channelOf(), {
      profile: codium,
      override: undefined,
      downloadFolder: '/cache',
    });
    const folder = clientArchiveFolder(
      '/cache',
      codium,
      archiveKeyOf('builtInTable', codium),
    );
    deepStrictEqual(
      seen.renames.map(([, destination]) => destination.startsWith(folder)),
      [true],
    );
  });

  it('F-0503 §3.2: the cache root is the download folder setting, else the temporary folder’s own folder', async () => {
    const withFolder = await runSteps(channelOf(), {downloadFolder: '/cache'});
    const unset = await runSteps(channelOf());
    const empty = await runSteps(channelOf(), {downloadFolder: ''});
    deepStrictEqual(
      [withFolder, unset, empty].map(({seen}) => seen.renames[0]?.[1]),
      [
        '/cache/fixture/stable/abc123/fixture-server-linux-x64.tar.gz',
        '/tmp/vscode-remote-containers/fixture/stable/abc123/fixture-server-linux-x64.tar.gz',
        '/tmp/vscode-remote-containers/fixture/stable/abc123/fixture-server-linux-x64.tar.gz',
      ].map(expected => expected),
    );
  });

  it('contracts §5.2: with the volume the first probe has no tree and the second has the tree of the first probe’s platform, and every later script has it', async () => {
    const channel = channelOf({volume: true});
    await runSteps(channel, {volume: true});
    deepStrictEqual(treesOf(channel), ['', TREE, 'none', TREE, TREE]);
  });

  it('contracts §5.2: without the volume there is one probe and no script has a tree', async () => {
    const channel = channelOf();
    await runSteps(channel);
    deepStrictEqual(treesOf(channel), ['', 'none', '', '']);
  });

  it('contracts §5.2: a musl container’s tree is under alpine', async () => {
    const channel = channelOf({libc: 'musl', volume: true});
    await runSteps(channel, {volume: true});
    deepStrictEqual(
      treesOf(channel)[1],
      TREE.replace('linux-x64', 'alpine-x64'),
    );
  });

  it('F-0503 AC-1: a complete tree is reused: no installing phase, no download, no install', async () => {
    const channel = channelOf({volume: true, treeComplete: true});
    const {result, seen} = await runSteps(channel, {volume: true});
    deepStrictEqual(
      [
        result.kind,
        seen.phases,
        seen.downloads,
        channel.calls.filter(call => call.operation === 'copyToHost'),
      ],
      ['started', ['startingServer'], [], []],
    );
  });

  it('F-0503 AC-12: an installed server is reused with no download', async () => {
    const first = hostFacts('glibc', undefined, true);
    const reusing = new RecordingChannel({
      identity: 'c1',
      platformHint: 'linux',
      scripts: [
        answer(isProbe, blockOf('Ok', ...first)),
        answer(isRelay, []),
        answer(isStart, STARTED),
      ],
    });
    const {seen} = await runSteps(reusing);
    deepStrictEqual([seen.phases, seen.downloads], [['startingServer'], []]);
  });

  it('F-0503 7.E3: an unsupported machine on Alpine and on glibc is S031 and S359, with the machine named, and a failed first probe runs no second one', async () => {
    const outcomes: unknown[] = [];
    for (const libc of ['musl', 'glibc']) {
      const channel = new RecordingChannel({
        identity: 'c1',
        platformHint: 'linux',
        scripts: [
          answer(
            isProbe,
            blockOf('UnsupportedArch', 'host.arch=armv7l', `host.libc=${libc}`),
          ),
        ],
      });
      const {result} = await runSteps(channel, {volume: true});
      outcomes.push([
        result.kind === 'failed' && result.failure.reason,
        channel.calls.length,
      ]);
    }
    deepStrictEqual(outcomes, [
      [{id: 'S031', values: ['armv7l']}, 1],
      [{id: 'S359', values: ['armv7l']}, 1],
    ]);
  });

  it('contracts §5.2: a second probe that fails ends the connect as serverFailed', async () => {
    const channel = new RecordingChannel({
      identity: 'c1',
      platformHint: 'linux',
      scripts: [
        answer(isFirstProbe, blockOf('Ok', ...hostFacts('glibc', false))),
        answer(isTreeProbe, blockOf('SomethingElse')),
      ],
    });
    const {result} = await runSteps(channel, {volume: true});
    deepStrictEqual(failureKind(result), 'serverFailed');
  });

  it('F-0503 BR-14: the override policy comes from lib-product’s table, and a table without one is a defect', () => {
    deepStrictEqual(
      [
        containersOverridePolicy().settingKey,
        (() => {
          try {
            return containersOverridePolicy({});
          } catch (caught) {
            return String(caught);
          }
        })(),
      ],
      [
        'remote.serverDownloadBaseUrl',
        'Error: lib-product names no override policy for remote-containers',
      ],
    );
  });

  it('F-0503 7.E3: an unsupported platform is S031 and the system is named', async () => {
    const channel = new RecordingChannel({
      identity: 'c1',
      platformHint: 'linux',
      scripts: [
        answer(isProbe, blockOf('UnsupportedPlatform', 'host.os=FreeBSD')),
      ],
    });
    const {result} = await runSteps(channel);
    deepStrictEqual(result.kind === 'failed' && result.failure.reason, {
      id: 'S031',
      values: ['FreeBSD'],
    });
  });

  it('F-0503 7.E1: a probe that finds a tool missing is serverFailed, and the log names the tool', async () => {
    const channel = new RecordingChannel({
      identity: 'c1',
      platformHint: 'linux',
      scripts: [
        answer(
          isProbe,
          blockOf(
            'Ok',
            ...hostFacts('glibc', undefined).map(fact =>
              fact === 'host.tool.tar=yes' ? 'host.tool.tar=no' : fact,
            ),
          ),
        ),
      ],
    });
    const {result, seen} = await runSteps(channel);
    deepStrictEqual(
      [failureKind(result), seen.sink.lines.map(line => line.message)],
      [
        'serverFailed',
        ['the probe failed: prerequisiteMissing', 'the container lacks: tar'],
      ],
    );
  });

  it('F-0503 7.E1: a start that finds the prerequisites missing is requirementsNotMet', async () => {
    const {result} = await runSteps(
      channelOf({start: blockOf('LinuxPrereqs'), startStatus: 0}),
    );
    deepStrictEqual(failureKind(result), 'requirementsNotMet');
  });

  it("F-0503 7.E1: the requirements failure carries the check's output as its text, unread", async () => {
    const {result} = await runSteps(
      channelOf({
        start: blockOf(
          'LinuxPrereqs',
          'server.prerequisites.1=Warning: Missing GLIBC >= 2.28!',
          'server.prerequisites.2=Error: Missing required dependencies.',
        ),
        startStatus: 0,
      }),
    );
    deepStrictEqual(result.kind === 'failed' && result.failure.reason, {
      text: 'Warning: Missing GLIBC >= 2.28!\nError: Missing required dependencies.',
    });
  });

  it('F-0503 5.0 step 6: a server with no requirements helper is logged at warn', async () => {
    const {seen} = await runSteps(
      channelOf({
        start: blockOf(
          'Ok',
          'server.port=4321',
          'server.pid=77',
          'server.token=abcdefghijklmnopqrstuvwxyz012345',
          'server.prerequisitesHelper=missing',
        ),
      }),
    );
    deepStrictEqual(
      seen.sink.lines
        .filter(line => line.level === 'warn')
        .map(line => line.message),
      [
        "the server has no requirements helper; the container's requirements weren't checked",
      ],
    );
  });

  it('F-0503 7.E4: a start that fails otherwise is serverFailed', async () => {
    const {result} = await runSteps(
      channelOf({start: blockOf('ServerFailedToStart')}),
    );
    deepStrictEqual(failureKind(result), 'serverFailed');
  });

  it('F-0503 3.5: a server that listens on a socket is serverFailed', async () => {
    const {result} = await runSteps(
      channelOf({
        start: blockOf(
          'Ok',
          'server.socketPath=/tmp/s.sock',
          'server.pid=77',
          'server.token=abcdefghijklmnopqrstuvwxyz012345',
          'server.reused=no',
        ),
      }),
    );
    deepStrictEqual(failureKind(result), 'serverFailed');
  });

  it('F-0503 3.5: a reused server is told in the log', async () => {
    const channel = channelOf({
      start: blockOf(
        'Ok',
        'server.port=4321',
        'server.pid=77',
        'server.token=abcdefghijklmnopqrstuvwxyz012345',
        'server.reused=yes',
      ),
    });
    const {result, seen} = await runSteps(channel);
    deepStrictEqual(
      [
        result.kind === 'started' && result.reused,
        seen.sink.lines
          .map(line => line.message)
          .filter(message => message.includes('reusing')),
      ],
      [true, ['reusing the running server']],
    );
  });

  it('F-0503 3.5: the log says the server starts and where it listens, and never holds the token', async () => {
    const {seen} = await runSteps(channelOf());
    const messages = seen.sink.lines.map(line => line.message);
    deepStrictEqual(
      [
        messages.includes('Starting VS Code Server'),
        messages.includes('server listening on 127.0.0.1:4321'),
        messages.some(message =>
          message.includes('abcdefghijklmnopqrstuvwxyz012345'),
        ),
      ],
      [true, true, false],
    );
  });

  it('F-1402 AC-2: a licence the user declines ends the connect as cancelled, with no transfer and no start', async () => {
    const licensed: ProductProfile = {...PROFILE, serverLicense: ['terms']};
    const channel = channelOf();
    const {result, seen} = await runSteps(channel, {
      profile: licensed,
      override: {
        value: 'https://update.code.visualstudio.com/x/${os}-${arch}.tar.gz',
        layer: 'defaultProfileUser',
      },
      modal: {askUser: () => Promise.resolve('cancel')},
    });
    deepStrictEqual(
      [
        failureKind(result),
        seen.downloads,
        channel.calls.filter(call => call.operation === 'copyToHost'),
        scriptsOf(channel).some(isStart),
      ],
      ['cancelled', [], [], false],
    );
  });

  it('R-68: a licence the user accepts is passed to the start', async () => {
    const licensed: ProductProfile = {...PROFILE, serverLicense: ['terms']};
    const channel = channelOf();
    await runSteps(channel, {
      profile: licensed,
      override: {
        value: 'https://update.code.visualstudio.com/x/${os}-${arch}.tar.gz',
        layer: 'defaultProfileUser',
      },
    });
    deepStrictEqual(
      (scriptsOf(channel).find(isStart) ?? '').includes(
        "'--accept-server-license-terms'",
      ),
      true,
    );
  });

  it('F-0503 7.E2: a download that fails once is tried again and the connect goes on, with one line naming what failed', async () => {
    const {result, seen} = await runSteps(channelOf(), {
      downloads: [{kind: 'failed', detail: 'ECONNRESET'}],
    });
    const lines = seen.sink.lines
      .map(line => line.message)
      .filter(message => message.includes('retrying once'));
    deepStrictEqual(
      [result.kind, seen.downloads.length, lines],
      [
        'started',
        2,
        [
          'the server download failed (https://example.invalid/server-linux-x64.tar.gz, /tmp/vscode-remote-containers/fixture/stable/abc123/fixture-server-linux-x64.tar.gz): ECONNRESET; retrying once',
        ],
      ],
    );
  });

  it('F-0503 7.E2: a download that fails twice is serverFailed, after exactly two tries', async () => {
    const failure: DownloadResult = {
      kind: 'failed',
      detail: 'ECONNRESET',
    };
    const {result, seen} = await runSteps(channelOf(), {
      downloads: [failure, failure],
    });
    deepStrictEqual(
      [failureKind(result), seen.downloads.length],
      ['serverFailed', 2],
    );
  });

  it('F-0503 7.E2: a download the user cancels ends the connect as cancelled, without a second try', async () => {
    const {result, seen} = await runSteps(channelOf(), {
      downloads: [{kind: 'cancelled'}],
    });
    deepStrictEqual(
      [failureKind(result), seen.downloads.length],
      ['cancelled', 1],
    );
  });

  it('F-0503 3.5: an archive of a quality other than stable has the quality in its name', async () => {
    const insiders: ProductProfile = {...PROFILE, quality: 'insider'};
    const {seen} = await runSteps(channelOf(), {profile: insiders});
    deepStrictEqual(
      seen.renames.map(([, destination]) => destination.split('/').at(-1)),
      ['fixture-server-linux-x64-insider.tar.gz'],
    );
  });

  it('contracts §2: a probe whose channel fails some other way than a cancel is serverFailed', async () => {
    const channel = new RecordingChannel({
      identity: 'c1',
      platformHint: 'linux',
      scripts: [
        {
          interpreter: 'posixShell',
          matches: isProbe,
          lines: [],
          ending: {
            kind: 'fail',
            failure: {kind: 'channelClosed', detail: 'container stopped'},
          },
        },
      ],
    });
    const {result} = await runSteps(channel);
    deepStrictEqual(failureKind(result), 'serverFailed');
  });

  it('F-0503 7.E2: a copy that fails is not tried again', async () => {
    const channel = channelOf({
      extra: [answer(isDiscard, blockOf('Ok'))],
      copies: [
        {
          matches: () => true,
          ending: {
            kind: 'fail',
            failure: {kind: 'copyFailed', detail: 'disk full'},
          },
        },
      ],
    });
    const {result, seen} = await runSteps(channel);
    deepStrictEqual(
      [failureKind(result), seen.downloads.length],
      ['serverFailed', 1],
    );
  });

  it('F-0503 7.E2: a channel that closes during the install is serverFailed and is not tried again', async () => {
    const closing = new RecordingChannel({
      identity: 'c1',
      platformHint: 'linux',
      scripts: [
        answer(isFirstProbe, blockOf('Ok', ...hostFacts('glibc', undefined))),
        answer(isRelay, []),
        answer(isStart, STARTED),
        {
          interpreter: 'posixShell',
          matches: isInstall,
          lines: [],
          ending: {
            kind: 'fail',
            failure: {kind: 'channelClosed', detail: 'container stopped'},
          },
        },
        answer(isDiscard, blockOf('Ok')),
      ],
      copies: [COPIED],
    });
    const {result, seen} = await runSteps(closing);
    deepStrictEqual(
      [failureKind(result), seen.downloads.length],
      ['serverFailed', 1],
    );
  });

  it('contracts §2 cancel: a cancellation during the probe is cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const {result} = await runSteps(channelOf(), {
      cancellation: controller.signal,
    });
    deepStrictEqual(failureKind(result), 'cancelled');
  });

  it('contracts §1: a relay script that cannot be installed is serverFailed', async () => {
    const channel = new RecordingChannel({
      identity: 'c1',
      platformHint: 'linux',
      scripts: [
        answer(isProbe, blockOf('Ok', ...hostFacts('glibc', undefined))),
        answer(isRelay, [], 1),
      ],
    });
    const {result} = await runSteps(channel);
    deepStrictEqual(failureKind(result), 'serverFailed');
  });

  it('contracts §2: a probe that fails in some other way is serverFailed', async () => {
    const channel = new RecordingChannel({
      identity: 'c1',
      platformHint: 'linux',
      scripts: [answer(isProbe, blockOf('SomethingElse'))],
    });
    const {result} = await runSteps(channel);
    deepStrictEqual(failureKind(result), 'serverFailed');
  });
});

describe("the server steps with the volume's root step (card containers-25)", () => {
  it('contracts §5.2: with the volume, the root step runs after the first probe and before the second', async () => {
    const channel = channelOf({volume: true});
    const userCallsAtRoot: number[] = [];
    const root = rootChannelOf(undefined, undefined, () => {
      userCallsAtRoot.push(channel.calls.length);
    });
    const {result} = await runSteps(channel, {volume: true, root});
    const [call] = root.calls;
    deepStrictEqual(
      [
        result.kind,
        userCallsAtRoot,
        root.calls.length,
        call?.operation === 'runScript' ? call.request.environment : undefined,
      ],
      [
        'started',
        [1],
        1,
        {
          SHARED_FOLDER_1: '/vscode/fixture-server',
          SHARED_FOLDER_2: '/vscode/fixture-server/bin',
          SHARED_FOLDER_3: '/vscode/fixture-server/bin/linux-x64',
        },
      ],
    );
  });

  it('contracts §5.2: the second probe waits until the root step has ended', async () => {
    const channel = channelOf({volume: true});
    let release: (() => void) | undefined;
    const late = new RecordingChannel({
      identity: 'c1',
      platformHint: 'linux',
      scripts: [],
    });
    const root: RecordingChannel = Object.assign(late, {
      runScript: async () => {
        await new Promise<void>(resolve => {
          release = resolve;
        });
        return {kind: 'exited' as const, status: 0};
      },
    });
    const running = runSteps(channel, {volume: true, root});
    await new Promise(resolve => {
      setImmediate(resolve);
    });
    const callsWhileHeld = channel.calls.length;
    release?.();
    const {result} = await running;
    deepStrictEqual([callsWhileHeld, result.kind], [1, 'started']);
  });

  it('contracts §5.2: without the volume, the root channel is never used', async () => {
    const root = rootChannelOf();
    await runSteps(channelOf(), {root});
    deepStrictEqual(root.calls, []);
  });

  it("contracts §5.2: a root step that fails doesn't fail the connect", async () => {
    const root = rootChannelOf([], {
      kind: 'fail',
      failure: {kind: 'spawnFailed', detail: 'no root'},
    });
    const {result, seen} = await runSteps(channelOf({volume: true}), {
      volume: true,
      root,
    });
    deepStrictEqual(
      [
        result.kind,
        seen.sink.lines.some(
          line =>
            line.message ===
            "the volume's shared folders were not prepared: spawnFailed: no root",
        ),
      ],
      ['started', true],
    );
  });

  it('F-0419 5.0 step 6: the install’s failure logs its status and what it could not write', async () => {
    const channel = channelOf({
      install: blockOf(
        'CreateInstallDirFailed',
        'server.writeFailedPath=/vscode/fixture-server',
        "server.writeFailedError=mkdir: can't create directory '/vscode/fixture-server': Permission denied",
      ),
      extra: [answer(isDiscard, blockOf('Ok'))],
    });
    const {result, seen} = await runSteps(channel);
    deepStrictEqual(
      [
        failureKind(result),
        seen.sink.lines
          .map(line => line.message)
          .filter(message =>
            message.startsWith('the server was not installed'),
          ),
      ],
      [
        'serverFailed',
        [
          "the server was not installed: scriptFailed (CreateInstallDirFailed): cannot write /vscode/fixture-server: mkdir: can't create directory '/vscode/fixture-server': Permission denied",
        ],
      ],
    );
  });

  it('contracts §5.2: each other transfer failure logs what it carries', () => {
    const channelFailure = {kind: 'channelClosed' as const, detail: 'gone'};
    deepStrictEqual(
      [
        transferredDetail({kind: 'scriptFailed', status: 'UnpackFailed'}),
        transferredDetail({kind: 'serverDownload', cause: 'downloadFailed'}),
        transferredDetail({
          kind: 'serverDownload',
          cause: 'downloadFailed',
          status: 404,
        }),
        transferredDetail({
          kind: 'localDownload',
          cause: 'network',
          detail: 'ECONNRESET',
        }),
        transferredDetail({kind: 'downloadTimeout', reason: 'stalled'}),
        transferredDetail({kind: 'verification', mismatch: 'checksum'}),
        transferredDetail({kind: 'copy', failure: channelFailure}),
        transferredDetail({kind: 'channelFailed', failure: channelFailure}),
        transferredDetail({kind: 'retriesExhausted', attempts: 30}),
        transferredDetail({
          kind: 'retriesExhausted',
          attempts: 30,
          lockPath: '/tmp/lock',
        }),
        transferredDetail({kind: 'unpack'}),
        transferredDetail({kind: 'noResultBlock'}),
        transferredDetail({kind: 'cancelled'}),
      ],
      [
        'scriptFailed (UnpackFailed)',
        'serverDownload (downloadFailed)',
        'serverDownload (downloadFailed, HTTP 404)',
        'localDownload (network): ECONNRESET',
        'downloadTimeout (stalled)',
        'verification (checksum)',
        'copy (channelClosed): gone',
        'channelFailed (channelClosed): gone',
        'retriesExhausted (30 attempts)',
        'retriesExhausted (30 attempts): lock /tmp/lock',
        'unpack',
        'noResultBlock',
        'cancelled',
      ],
    );
  });
});
