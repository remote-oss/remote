import {deepStrictEqual} from 'node:assert';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  RecordingChannel,
  type CopyAnswer,
} from 'lib-host/testing/recording-channel';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {RESULT_BEGIN, RESULT_END} from 'lib-server';
import {FakeClock} from 'lib-server/testing/fake-clock';
import type {ServerStepDependencies} from '../../src/connect/server-steps.ts';
import {
  placeCli,
  placeCliFiles,
  type PlacePorts,
  type PlaceRequest,
} from '../../src/cli/placed-cli.ts';
import {localHostChannel} from './local-host-channel.fixture.ts';
import {answer, PROFILE} from './server-profile.fixture.ts';

const NEVER = new AbortController().signal;

const CLIENT = {
  cliFolder: '/client/dist/devcontainers-cli',
  preload: '/client/dist/cli-preload.js',
};

const CLI_FILES = [
  'devcontainer.js',
  'dist/spec-node/devContainersSpecCLI.js',
  'scripts/updateUID.Dockerfile',
];

const PORTS: PlacePorts = {listFiles: () => Promise.resolve([...CLI_FILES])};

const SERVER = '/home/dev/.fixture-server/bin/abc123';
const CLI_FOLDER = '/home/dev/.fixture-server/remote-oss-containers-cli';

/** What a run saw of the client's side. */
interface Seen {
  sink: MemorySink;
  phases: string[];
}

/** The dependencies of a connect that has no download: nothing of the client's is used by a server that is found. */
function dependenciesOf(seen: Seen): ServerStepDependencies {
  function unused(): never {
    throw new Error('this row has no use for it');
  }
  return {
    profile: PROFILE,
    override: undefined,
    downloadFolder: undefined,
    temporaryFolder: '/tmp',
    store: {isAccepted: () => false, accept: () => Promise.resolve()},
    modal: {askUser: () => Promise.resolve('accept')},
    download: {download: unused},
    credentials: {readNetrc: () => Promise.resolve(undefined)},
    files: {
      remove: () => Promise.resolve(),
      exists: () => Promise.resolve(false),
      entryExists: () => Promise.resolve(false),
      size: unused,
      sha256: unused,
      stage: unused,
      rename: unused,
    },
    clock: new FakeClock(),
    newTemporaryToken: () => 'token',
    queryGallery: () => Promise.resolve(undefined),
    readText: () => Promise.resolve(undefined),
    logger: createLogger(seen.sink, {minimumLevel: () => 'info'}),
    translate: template => template,
  };
}

/** The facts the probe reports of a host: a Linux with the server installed or not. */
function probeBlock(installed: boolean): string[] {
  return [
    RESULT_BEGIN,
    'status=Ok',
    'host.os=linux',
    'host.arch=x64',
    'host.libc=glibc',
    'host.release=debian',
    'host.home=/home/dev',
    'host.tmp=/tmp',
    'host.shell=/bin/sh',
    'host.tool.tar=yes',
    'host.tool.wget=yes',
    'host.tool.curl=no',
    'host.tool.unzip=no',
    'host.tool.flock=no',
    'host.wgetBusybox=no',
    'host.sshAuthSock=',
    'host.display=',
    `server.installDir=${SERVER}`,
    `server.installed=${installed ? 'yes' : 'no'}`,
    RESULT_END,
  ];
}

const COPIED: CopyAnswer = {matches: () => true, ending: {kind: 'copied'}};

/** The channel of a host whose server is installed, whose folder of this version is `whole` or missing. */
function channelOf(
  options: {
    present?: boolean;
    installed?: boolean;
    failing?: 'check' | 'prepare' | 'publish' | 'copy' | 'probe';
  } = {},
): RecordingChannel {
  const failing = options.failing;
  const broken = {
    kind: 'fail',
    failure: {kind: 'channelClosed', detail: 'the connection closed'},
  } as const;
  return new RecordingChannel({
    identity: 'host',
    platformHint: 'linux',
    scripts: [
      failing === 'probe'
        ? {
            interpreter: 'posixShell',
            matches: script => script.includes('fact host.os'),
            lines: [],
            ending: broken,
          }
        : answer(
            script => script.includes('fact host.os'),
            probeBlock(options.installed ?? true),
          ),
      failing === 'check'
        ? {
            interpreter: 'posixShell',
            matches: script => script.includes('echo whole'),
            lines: [],
            ending: broken,
          }
        : answer(
            script => script.includes('echo whole'),
            [options.present === true ? 'whole' : 'missing'],
          ),
      failing === 'prepare'
        ? answer(script => script.includes('$PART_FOLDER/$directory'), [], 3)
        : answer(script => script.includes('$PART_FOLDER/$directory'), []),
      failing === 'publish'
        ? {
            interpreter: 'posixShell',
            matches: script => script.includes('mv --'),
            lines: [],
            ending: broken,
          }
        : answer(script => script.includes('mv --'), []),
    ],
    copies:
      failing === 'copy'
        ? [COPIED, {matches: () => true, ending: broken}]
        : [COPIED, COPIED, COPIED, COPIED],
  });
}

/** The request of a placement of version 1.2.3. */
function requestOf(channel: RecordingChannel, seen: Seen): PlaceRequest {
  return {
    channel,
    remoteUser: 'dev',
    version: '2.0.0',
    client: CLIENT,
    newToken: () => 'tok',
    onPhase: phase => seen.phases.push(phase),
    onDownloadPercent: () => undefined,
    cancellation: NEVER,
  };
}

function seenOf(): Seen {
  return {sink: new MemorySink(), phases: []};
}

/** What a channel was asked to run or copy, in order, as short labels. */
function callsOf(channel: RecordingChannel): string[] {
  return channel.calls.map(call =>
    call.operation === 'copyToHost'
      ? `copy ${call.request.remotePath}`
      : call.request.script.includes('fact host.os')
        ? 'probe'
        : call.request.script.includes('echo whole')
          ? 'check'
          : call.request.script.includes('$PART_FOLDER/$directory')
            ? 'prepare'
            : call.request.script.includes('mv --')
              ? 'publish'
              : 'other',
  );
}

describe('the dev container CLI placed on the SSH host (card #3244)', () => {
  it('F-1302 AC-25: with the server installed, the CLI files and the preload are copied into a folder of the version that a rename then names, and the paths are the host’s', async () => {
    const seen = seenOf();
    const channel = channelOf();
    const result = await placeCli(
      dependenciesOf(seen),
      PORTS,
      requestOf(channel, seen),
    );
    const part = `${CLI_FOLDER}/2.0.0.part-tok`;
    deepStrictEqual(
      [result, callsOf(channel), seen.phases],
      [
        {
          kind: 'placed',
          placed: {
            node: `${SERVER}/node`,
            entry: `${CLI_FOLDER}/2.0.0/devcontainer.js`,
            preload: `${CLI_FOLDER}/2.0.0/cli-preload.js`,
            editorModules: `${SERVER}/node_modules`,
          },
        },
        [
          'probe',
          'check',
          'prepare',
          ...CLI_FILES.map(file => `copy ${part}/${file}`),
          `copy ${part}/cli-preload.js`,
          'publish',
        ],
        [],
      ],
    );
  });

  it('F-1302 AC-25: a second run with the same version finds its folder and copies nothing, writes nothing', async () => {
    const seen = seenOf();
    const channel = channelOf({present: true});
    const result = await placeCli(
      dependenciesOf(seen),
      PORTS,
      requestOf(channel, seen),
    );
    deepStrictEqual(
      [result.kind, callsOf(channel)],
      ['placed', ['probe', 'check']],
    );
  });

  it('the names of the folders and files, and the version, reach the scripts as variables, never in their text', async () => {
    const seen = seenOf();
    const channel = channelOf();
    await placeCli(dependenciesOf(seen), PORTS, requestOf(channel, seen));
    const scripts = channel.calls.flatMap(call =>
      call.operation === 'runScript' && !call.request.script.includes('fact')
        ? [[call.request.script.includes('2.0.0'), call.request.environment]]
        : [],
    );
    deepStrictEqual(scripts, [
      [false, {CLI_FOLDER, VERSION_FOLDER: `${CLI_FOLDER}/2.0.0`}],
      [
        false,
        {
          CLI_FOLDER,
          VERSION_FOLDER: `${CLI_FOLDER}/2.0.0`,
          PART_FOLDER: `${CLI_FOLDER}/2.0.0.part-tok`,
          DIRECTORIES: '.\ndist/spec-node\nscripts',
        },
      ],
      [
        false,
        {
          CLI_FOLDER,
          VERSION_FOLDER: `${CLI_FOLDER}/2.0.0`,
          PART_FOLDER: `${CLI_FOLDER}/2.0.0.part-tok`,
        },
      ],
    ]);
  });

  it('a host with no server and no source for one fails, a probe the channel can’t run fails, each with its own failure and the CLI is not copied', async () => {
    const seen = seenOf();
    const noServer = channelOf({installed: false});
    const unreadable = channelOf({failing: 'probe'});
    const results = [
      await placeCli(dependenciesOf(seen), PORTS, requestOf(noServer, seen)),
      await placeCli(dependenciesOf(seen), PORTS, requestOf(unreadable, seen)),
    ];
    deepStrictEqual(
      [
        results.map(each =>
          each.kind === 'failed' ? each.failure.kind : each.kind,
        ),
        callsOf(noServer).filter(call => call.startsWith('copy')),
        callsOf(unreadable).filter(call => call.startsWith('copy')),
      ],
      [['noServerSource', 'serverFailed'], [], []],
    );
  });

  it('a check, a folder, a copy and a rename that fail end the placement with the CLI not placed, say why in the log, and later steps do not run', async () => {
    const outcomes = [];
    for (const failing of ['check', 'prepare', 'copy', 'publish'] as const) {
      const seen = seenOf();
      const channel = channelOf({failing});
      const result = await placeCli(
        dependenciesOf(seen),
        PORTS,
        requestOf(channel, seen),
      );
      outcomes.push([
        result.kind === 'failed' ? result.failure.kind : result.kind,
        callsOf(channel)
          .slice(2)
          .map(call => call.split('/').pop()),
        seen.sink.lines.map(line => line.message),
      ]);
    }
    deepStrictEqual(outcomes, [
      [
        'cliNotPlaced',
        [],
        ["the CLI's folder on the host was not checked: the connection closed"],
      ],
      [
        'cliNotPlaced',
        ['prepare'],
        [
          "the CLI's folder on the host was not made: the script on the host ended with status 3",
        ],
      ],
      [
        'cliNotPlaced',
        ['prepare', 'devcontainer.js', 'devContainersSpecCLI.js'],
        [
          "the CLI's file dist/spec-node/devContainersSpecCLI.js was not copied to the host: the connection closed",
        ],
      ],
      [
        'cliNotPlaced',
        [
          'prepare',
          'devcontainer.js',
          'devContainersSpecCLI.js',
          'updateUID.Dockerfile',
          'cli-preload.js',
          'publish',
        ],
        [
          "the CLI's folder on the host was not completed: the connection closed",
        ],
      ],
    ]);
  });
});

describe('the CLI folder on a host with a real shell (card #3244)', () => {
  let root = '';
  let client = '';

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'placed-cli-'));
    client = path.join(root, 'client');
    for (const file of CLI_FILES) {
      mkdirSync(path.dirname(path.join(client, file)), {recursive: true});
      writeFileSync(path.join(client, file), `content of ${file}`);
    }
    writeFileSync(path.join(root, 'cli-preload.js'), 'the preload');
  });

  afterEach(() => {
    rmSync(root, {recursive: true, force: true});
  });

  /** A run of the placement of `version` on this machine's shell, with the folder `host` standing for the host's. */
  async function placedOn(version: string, token = 'tok') {
    const seen = seenOf();
    const copies: string[] = [];
    const channel = localHostChannel({
      PATH: process.env.PATH ?? '/usr/bin:/bin',
    });
    const counting = {
      ...channel,
      copyToHost: (request: Parameters<typeof channel.copyToHost>[0]) => {
        copies.push(path.relative(root, request.remotePath));
        return channel.copyToHost(request);
      },
    };
    const failure = await placeCliFiles(
      createLogger(seen.sink, {minimumLevel: () => 'info'}),
      {listFiles: () => Promise.resolve([...CLI_FILES])},
      {
        channel: counting,
        remoteUser: 'dev',
        version,
        client: {
          cliFolder: client,
          preload: path.join(root, 'cli-preload.js'),
        },
        newToken: () => token,
        onPhase: () => undefined,
        onDownloadPercent: () => undefined,
        cancellation: NEVER,
      },
      {
        cliFolder: path.join(root, 'host'),
        versionFolder: path.join(root, 'host', version),
      },
    );
    return {failure, copies};
  }

  it('F-1302 AC-25: the first run makes a whole folder of the version, a second with it copies nothing, and a new version makes a folder of its own', async () => {
    const first = await placedOn('1.0.0');
    const second = await placedOn('1.0.0', 'other');
    const third = await placedOn('1.1.0');
    deepStrictEqual(
      [
        first.failure,
        first.copies.length,
        second.failure,
        second.copies,
        third.failure,
        third.copies.length,
        readdirSync(path.join(root, 'host')).sort(),
        readFileSync(
          path.join(
            root,
            'host',
            '1.0.0',
            'dist/spec-node/devContainersSpecCLI.js',
          ),
          'utf8',
        ),
        readFileSync(
          path.join(root, 'host', '1.0.0', 'cli-preload.js'),
          'utf8',
        ),
        existsSync(path.join(root, 'host', '1.0.0', '.whole')),
      ],
      [
        undefined,
        4,
        undefined,
        [],
        undefined,
        4,
        ['1.0.0', '1.1.0'],
        'content of dist/spec-node/devContainersSpecCLI.js',
        'the preload',
        true,
      ],
    );
  });

  it('a folder of the version that a window put there while this one copied stays, and this copy goes with nothing left inside it', async () => {
    const host = path.join(root, 'host');
    const channel = localHostChannel({
      PATH: process.env.PATH ?? '/usr/bin:/bin',
    });
    const racing = {
      ...channel,
      copyToHost: async (request: Parameters<typeof channel.copyToHost>[0]) => {
        const copied = await channel.copyToHost(request);
        mkdirSync(path.join(host, '3.0.0'), {recursive: true});
        writeFileSync(path.join(host, '3.0.0', '.whole'), '');
        return copied;
      },
    };
    const seen = seenOf();
    const failure = await placeCliFiles(
      createLogger(seen.sink, {minimumLevel: () => 'info'}),
      {listFiles: () => Promise.resolve([...CLI_FILES])},
      {
        channel: racing,
        remoteUser: 'dev',
        version: '3.0.0',
        client: {cliFolder: client, preload: path.join(root, 'cli-preload.js')},
        newToken: () => 'tok',
        onPhase: () => undefined,
        onDownloadPercent: () => undefined,
        cancellation: NEVER,
      },
      {cliFolder: host, versionFolder: path.join(host, '3.0.0')},
    );
    deepStrictEqual(
      [failure, readdirSync(host), readdirSync(path.join(host, '3.0.0'))],
      [undefined, ['3.0.0'], ['.whole']],
    );
  });

  it('a half-copied folder that a window left more than a day ago is removed by the next run, and one that is newer is kept', async () => {
    const host = path.join(root, 'host');
    mkdirSync(path.join(host, '9.9.9.part-old'), {recursive: true});
    mkdirSync(path.join(host, '9.9.9.part-new'), {recursive: true});
    const longAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    utimesSync(path.join(host, '9.9.9.part-old'), longAgo, longAgo);
    await placedOn('1.0.0');
    deepStrictEqual(readdirSync(host).sort(), ['1.0.0', '9.9.9.part-new']);
  });
});
