import {deepStrictEqual} from 'node:assert';
import {createHash} from 'node:crypto';
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
  type ScriptAnswer,
} from 'lib-host/testing/recording-channel';
import {CONTAINERS_CLI_FOLDER} from 'lib-identifiers';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {RESULT_BEGIN, RESULT_END} from 'lib-server';
import {FakeClock} from 'lib-server/testing/fake-clock';
import type {ServerStepDependencies} from '../../src/connect/server-steps.ts';
import {
  packagedHashesOf,
  placeCli,
  placeCliFiles,
  type PlaceRequest,
} from '../../src/cli/placed-cli.ts';
import {localHostChannel} from './local-host-channel.fixture.ts';
import {answer, PROFILE} from './server-profile.fixture.ts';

const NEVER = new AbortController().signal;

/** The sha256 of `text` as hexadecimal. */
function sha256Of(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

const CLI_FILES = [
  'devcontainer.js',
  'dist/spec-node/devContainersSpecCLI.js',
  'scripts/updateUID.Dockerfile',
];

/** What the client's files hold: the text each file has, which the packaged hashes are those of. */
function contentOf(name: string): string {
  return `content of ${name}`;
}

/** The hashes the extension was packaged with: each CLI file and the preload. */
const HASHES: Readonly<Record<string, string>> = Object.fromEntries(
  [...CLI_FILES, 'cli-preload.js'].map(name => [
    name,
    sha256Of(contentOf(name)),
  ]),
);

const CLIENT = {
  cliFolder: '/client/dist/devcontainers-cli',
  preload: '/client/dist/cli-preload.js',
  hashes: HASHES,
};

const SERVER = '/home/dev/.fixture-server/bin/abc123';
const CLI_FOLDER = `/home/dev/.fixture-server/${CONTAINERS_CLI_FOLDER}`;

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

const BROKEN = {
  kind: 'fail',
  failure: {kind: 'channelClosed', detail: 'the connection closed'},
} as const;

/** What the host's hash script prints for each file when its copy is `form`: as packaged, another file, or none. */
function hashLines(
  form: 'good' | 'bad' | 'missing',
  names: readonly string[] = Object.keys(HASHES),
): string[] {
  return names.map((name, index) => {
    const hash = form === 'missing' && index === 0 ? '' : HASHES[name];
    return `sum=${form === 'bad' && index === 0 ? sha256Of('tampered') : (hash ?? '')}\t${name}`;
  });
}

/** How a run of the placement goes on the host: what each script answers, in the order the placement asks. */
interface Scenario {
  /** Whether the folder of the version is whole when the placement looks, at each look. */
  looks?: Array<'whole' | 'missing'>;
  /** What the host's copy hashes as, at each time the placement hashes. */
  hashes?: Array<'good' | 'bad' | 'missing' | 'fail' | 'status'>;
  installed?: boolean;
  failing?: 'check' | 'prepare' | 'publish' | 'copy' | 'probe' | 'remove';
}

/** The channel of a host with its server installed, answering the scripts of the placement as `scenario` says. */
function channelOf(scenario: Scenario = {}): RecordingChannel {
  const {failing} = scenario;
  const looks = scenario.looks ?? ['missing'];
  const hashes = scenario.hashes ?? ['good'];
  function sequence(
    matches: (script: string) => boolean,
    entries: readonly ScriptAnswer[],
  ): ScriptAnswer[] {
    return entries.map(entry => ({...entry, matches}));
  }
  function isHash(script: string): boolean {
    return script.includes('sha256sum');
  }
  return new RecordingChannel({
    identity: 'host',
    platformHint: 'linux',
    scripts: [
      failing === 'probe'
        ? {
            interpreter: 'posixShell',
            matches: script => script.includes('fact host.os'),
            lines: [],
            ending: BROKEN,
          }
        : answer(
            script => script.includes('fact host.os'),
            probeBlock(scenario.installed ?? true),
          ),
      ...sequence(
        script => script.includes('echo whole'),
        failing === 'check'
          ? [
              {
                interpreter: 'posixShell',
                matches: () => true,
                lines: [],
                ending: BROKEN,
              },
            ]
          : looks.map(look => answer(() => true, [look])),
      ),
      ...[1, 2].flatMap(() => [
        answer(
          script => script.includes('$PART_FOLDER/$directory'),
          [],
          failing === 'prepare' ? 3 : 0,
        ),
        failing === 'publish'
          ? {
              interpreter: 'posixShell' as const,
              matches: (script: string) => script.includes('mv --'),
              lines: [],
              ending: BROKEN,
            }
          : answer(script => script.includes('mv --'), []),
      ]),
      ...sequence(
        isHash,
        hashes.map(form =>
          form === 'fail'
            ? {
                interpreter: 'posixShell',
                matches: () => true,
                lines: [],
                ending: BROKEN,
              }
            : answer(
                () => true,
                form === 'status' ? [] : hashLines(form),
                form === 'status' ? 4 : 0,
              ),
        ),
      ),
      failing === 'remove'
        ? {
            interpreter: 'posixShell',
            matches: script => script.includes('rm -rf -- "$VERSION_FOLDER"'),
            lines: [],
            ending: BROKEN,
          }
        : answer(script => script.includes('rm -rf -- "$VERSION_FOLDER"'), []),
    ],
    copies:
      failing === 'copy'
        ? [COPIED, {matches: () => true, ending: BROKEN}]
        : Array.from({length: 12}, () => COPIED),
  });
}

/** The request of a placement of version 2.0.0. */
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
              : call.request.script.includes('sha256sum')
                ? 'hash'
                : call.request.script.includes('rm -rf')
                  ? 'remove'
                  : 'other',
  );
}

/** The lines the placement logged. */
function loggedOf(seen: Seen): string[] {
  return seen.sink.lines.map(line => line.message);
}

describe('the dev container CLI placed on the SSH host (card #3244)', () => {
  it('F-1302 AC-25: with the server installed, the packaged files and the preload are copied into a folder of the version that a rename then names, hashed on the host before the run, and the paths are the host’s', async () => {
    const seen = seenOf();
    const channel = channelOf();
    const result = await placeCli(
      dependenciesOf(seen),
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
          ...Object.keys(HASHES).map(file => `copy ${part}/${file}`),
          'publish',
          'hash',
        ],
        [],
      ],
    );
  });

  it('F-1302 AC-25: a second run with the same version finds its folder and copies nothing, writes nothing, and hashes what is there', async () => {
    const seen = seenOf();
    const channel = channelOf({looks: ['whole']});
    const result = await placeCli(
      dependenciesOf(seen),
      requestOf(channel, seen),
    );
    deepStrictEqual(
      [result.kind, callsOf(channel)],
      ['placed', ['probe', 'check', 'hash']],
    );
  });

  it('the folder is the one constant of the identifiers under the data folder of the product’s server, so two products have two folders', async () => {
    const entries = [];
    for (const dataFolder of ['.fixture-server', '.other-server']) {
      const seen = seenOf();
      const channel = new RecordingChannel({
        identity: 'host',
        platformHint: 'linux',
        scripts: [
          answer(script => script.includes('fact host.os'), probeBlock(true)),
          answer(script => script.includes('echo whole'), ['whole']),
          answer(script => script.includes('sha256sum'), hashLines('good')),
        ],
      });
      const result = await placeCli(
        {
          ...dependenciesOf(seen),
          profile: {...PROFILE, serverDataFolderName: dataFolder},
        },
        requestOf(channel, seen),
      );
      entries.push(
        result.kind === 'placed' ? result.placed.entry : result.kind,
      );
    }
    deepStrictEqual(entries, [
      `/home/dev/.fixture-server/${CONTAINERS_CLI_FOLDER}/2.0.0/devcontainer.js`,
      `/home/dev/.other-server/${CONTAINERS_CLI_FOLDER}/2.0.0/devcontainer.js`,
    ]);
  });

  it('known limitation: the probe is told no install root, so a host with a server in a folder of the SSH setting gets its own under the default data folder', async () => {
    const seen = seenOf();
    const channel = channelOf();
    const result = await placeCli(
      dependenciesOf(seen),
      requestOf(channel, seen),
    );
    const [probed] = channel.calls;
    deepStrictEqual(
      [
        probed?.operation === 'runScript' &&
          probed.request.script.includes("INSTALL_ROOT=''"),
        result.kind === 'placed' ? result.placed.node : result.kind,
      ],
      [true, '/home/dev/.fixture-server/bin/abc123/node'],
    );
  });

  it('the names of the folders and files, and the version, reach the scripts as variables, never in their text', async () => {
    const seen = seenOf();
    const channel = channelOf();
    await placeCli(dependenciesOf(seen), requestOf(channel, seen));
    const scripts = channel.calls.flatMap(call =>
      call.operation === 'runScript' && !call.request.script.includes('fact')
        ? [[call.request.script.includes('2.0.0'), call.request.environment]]
        : [],
    );
    const folders = {CLI_FOLDER, VERSION_FOLDER: `${CLI_FOLDER}/2.0.0`};
    const part = {PART_FOLDER: `${CLI_FOLDER}/2.0.0.part-tok`};
    deepStrictEqual(scripts, [
      [false, folders],
      [
        false,
        {
          ...folders,
          ...part,
          DIRECTORIES: '.\ndist/spec-node\nscripts',
        },
      ],
      [false, {...folders, ...part}],
      [false, {...folders, FILES: Object.keys(HASHES).join('\n')}],
    ]);
  });

  it('a host with no server and no source for one fails, a probe the channel can’t run fails, each with its own failure and the CLI is not copied', async () => {
    const seen = seenOf();
    const noServer = channelOf({installed: false});
    const unreadable = channelOf({failing: 'probe'});
    const results = [
      await placeCli(dependenciesOf(seen), requestOf(noServer, seen)),
      await placeCli(dependenciesOf(seen), requestOf(unreadable, seen)),
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
        requestOf(channel, seen),
      );
      outcomes.push([
        result.kind === 'failed' ? result.failure.kind : result.kind,
        callsOf(channel)
          .slice(2)
          .map(call => call.split('/').pop()),
        loggedOf(seen),
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

describe('the placed files against the packaged hashes (card #3244, #2156’s rules)', () => {
  it('a file whose hash on the host is not the packaged one places the folder again, and the second look finds it as packaged', async () => {
    const seen = seenOf();
    const channel = channelOf({
      looks: ['whole', 'missing'],
      hashes: ['bad', 'good'],
    });
    const result = await placeCli(
      dependenciesOf(seen),
      requestOf(channel, seen),
    );
    deepStrictEqual(
      [
        result.kind,
        callsOf(channel).filter(call => !call.startsWith('copy')),
        loggedOf(seen),
      ],
      [
        'placed',
        [
          'probe',
          'check',
          'hash',
          'remove',
          'check',
          'prepare',
          'publish',
          'hash',
        ],
        [
          'the CLI on the host differs from the packaged one: devcontainer.js is not the file the extension was packaged with',
        ],
      ],
    );
  });

  it('a second difference fails the run with the CLI not placed, and the log names the file and why', async () => {
    const seen = seenOf();
    const channel = channelOf({
      looks: ['whole', 'missing'],
      hashes: ['bad', 'bad'],
    });
    const result = await placeCli(
      dependenciesOf(seen),
      requestOf(channel, seen),
    );
    deepStrictEqual(
      [
        result.kind === 'failed' ? result.failure.kind : result.kind,
        loggedOf(seen),
        callsOf(channel).filter(call => call === 'remove').length,
      ],
      [
        'cliNotPlaced',
        [
          'the CLI on the host differs from the packaged one: devcontainer.js is not the file the extension was packaged with',
          'the CLI on the host differs from the packaged one: devcontainer.js is not the file the extension was packaged with',
        ],
        1,
      ],
    );
  });

  it('a file that is not there, or that no tool of the host can hash, is a difference that says so', async () => {
    const seen = seenOf();
    const channel = channelOf({
      looks: ['whole', 'missing'],
      hashes: ['missing', 'good'],
    });
    await placeCli(dependenciesOf(seen), requestOf(channel, seen));
    deepStrictEqual(loggedOf(seen), [
      'the CLI on the host differs from the packaged one: devcontainer.js is missing on the host or cannot be hashed there',
    ]);
  });

  it('a hash script the channel can’t run, or that ends with a status, fails the run, and a folder that can’t be removed fails it too', async () => {
    const outcomes = [];
    const scenarios: Scenario[] = [
      {looks: ['missing', 'missing'], hashes: ['fail', 'fail']},
      {looks: ['missing', 'missing'], hashes: ['status', 'status']},
      {looks: ['whole'], hashes: ['bad'], failing: 'remove'},
    ];
    for (const scenario of scenarios) {
      const seen = seenOf();
      const result = await placeCli(
        dependenciesOf(seen),
        requestOf(channelOf(scenario), seen),
      );
      outcomes.push([
        result.kind === 'failed' ? result.failure.kind : result.kind,
        loggedOf(seen),
      ]);
    }
    deepStrictEqual(outcomes, [
      [
        'cliNotPlaced',
        [
          'the CLI on the host differs from the packaged one: the files could not be hashed on the host: the connection closed',
          'the CLI on the host differs from the packaged one: the files could not be hashed on the host: the connection closed',
        ],
      ],
      [
        'cliNotPlaced',
        [
          'the CLI on the host differs from the packaged one: the files could not be hashed on the host: the script on the host ended with status 4',
          'the CLI on the host differs from the packaged one: the files could not be hashed on the host: the script on the host ended with status 4',
        ],
      ],
      [
        'cliNotPlaced',
        [
          'the CLI on the host differs from the packaged one: devcontainer.js is not the file the extension was packaged with',
          "the CLI's folder on the host was not removed: the connection closed",
        ],
      ],
    ]);
  });
});

describe('the list of hashes the extension was packaged with (card #3244)', () => {
  it('a list of names under the version’s folder and sha256 texts is read, and anything else is none', () => {
    const good = JSON.stringify(HASHES);
    const hash = sha256Of('x');
    deepStrictEqual(
      [
        packagedHashesOf(good),
        packagedHashesOf('{broken'),
        packagedHashesOf('[]'),
        packagedHashesOf('null'),
        packagedHashesOf('{}'),
        packagedHashesOf(JSON.stringify({'../escape': hash})),
        packagedHashesOf(JSON.stringify({'/absolute': hash})),
        packagedHashesOf(JSON.stringify({'a//b': hash})),
        packagedHashesOf(JSON.stringify({'a\nb': hash})),
        packagedHashesOf(JSON.stringify({'a.js': hash.toUpperCase()})),
        packagedHashesOf(JSON.stringify({'a.js': 3})),
      ],
      [HASHES, ...Array.from({length: 10}, () => undefined)],
    );
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
      writeFileSync(path.join(client, file), contentOf(file));
    }
    writeFileSync(
      path.join(root, 'cli-preload.js'),
      contentOf('cli-preload.js'),
    );
  });

  afterEach(() => {
    rmSync(root, {recursive: true, force: true});
  });

  /**
   * A run of the placement of `version` on this machine's shell, with the folder `host` standing for the host's, and
   * `corrupt` as the copies the host makes of the files named in it.
   */
  async function placedOn(
    version: string,
    token = 'tok',
    corrupt: readonly string[] = [],
  ) {
    const seen = seenOf();
    const copies: string[] = [];
    const channel = localHostChannel({
      PATH: process.env.PATH ?? '/usr/bin:/bin',
    });
    const counting = {
      ...channel,
      copyToHost: async (request: Parameters<typeof channel.copyToHost>[0]) => {
        copies.push(path.relative(root, request.remotePath));
        const copied = await channel.copyToHost(request);
        if (corrupt.includes(path.basename(request.remotePath))) {
          writeFileSync(request.remotePath, 'changed on the host');
        }
        return copied;
      },
    };
    const failure = await placeCliFiles(
      createLogger(seen.sink, {minimumLevel: () => 'info'}),
      {
        channel: counting,
        remoteUser: 'dev',
        version,
        client: {
          cliFolder: client,
          preload: path.join(root, 'cli-preload.js'),
          hashes: HASHES,
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
    return {failure, copies, logged: loggedOf(seen)};
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
        contentOf('dist/spec-node/devContainersSpecCLI.js'),
        contentOf('cli-preload.js'),
        true,
      ],
    );
  });

  it('a file of the host’s copy that is changed after it was placed is placed again by the next run, and the run after finds it as packaged', async () => {
    await placedOn('1.0.0');
    writeFileSync(
      path.join(root, 'host', '1.0.0', 'devcontainer.js'),
      'changed by anyone with the account',
    );
    const again = await placedOn('1.0.0', 'second');
    const after = await placedOn('1.0.0', 'third');
    deepStrictEqual(
      [
        again.failure,
        again.copies.length,
        again.logged,
        readFileSync(
          path.join(root, 'host', '1.0.0', 'devcontainer.js'),
          'utf8',
        ),
        after.copies,
      ],
      [
        undefined,
        4,
        [
          'the CLI on the host differs from the packaged one: devcontainer.js is not the file the extension was packaged with',
        ],
        contentOf('devcontainer.js'),
        [],
      ],
    );
  });

  it('a copy that comes out different a second time fails the run, naming the file, and a file that is gone is placed again', async () => {
    const failing = await placedOn('1.0.0', 'tok', ['devcontainer.js']);
    rmSync(path.join(root, 'host', '2.0.0'), {recursive: true, force: true});
    await placedOn('2.0.0');
    rmSync(path.join(root, 'host', '2.0.0', 'scripts', 'updateUID.Dockerfile'));
    const gone = await placedOn('2.0.0', 'second');
    deepStrictEqual(
      [failing.failure?.kind, failing.logged.length, gone.failure, gone.logged],
      [
        'cliNotPlaced',
        2,
        undefined,
        [
          'the CLI on the host differs from the packaged one: scripts/updateUID.Dockerfile is missing on the host or cannot be hashed there',
        ],
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
        for (const file of Object.keys(HASHES)) {
          mkdirSync(path.dirname(path.join(host, '3.0.0', file)), {
            recursive: true,
          });
          writeFileSync(path.join(host, '3.0.0', file), contentOf(file));
        }
        writeFileSync(path.join(host, '3.0.0', '.whole'), '');
        return copied;
      },
    };
    const seen = seenOf();
    const failure = await placeCliFiles(
      createLogger(seen.sink, {minimumLevel: () => 'info'}),
      {
        channel: racing,
        remoteUser: 'dev',
        version: '3.0.0',
        client: {
          cliFolder: client,
          preload: path.join(root, 'cli-preload.js'),
          hashes: HASHES,
        },
        newToken: () => 'tok',
        onPhase: () => undefined,
        onDownloadPercent: () => undefined,
        cancellation: NEVER,
      },
      {cliFolder: host, versionFolder: path.join(host, '3.0.0')},
    );
    deepStrictEqual(
      [
        failure,
        readdirSync(host),
        readdirSync(path.join(host, '3.0.0')).sort(),
      ],
      [
        undefined,
        ['3.0.0'],
        ['.whole', 'cli-preload.js', 'devcontainer.js', 'dist', 'scripts'],
      ],
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

describe('the version folder placeCliFiles works in (card #3316)', () => {
  const cliFolder = '/home/dev/.remote-containers/cli';
  const refusedFolders = [
    `${cliFolder}/`,
    `${cliFolder}/.`,
    `${cliFolder}/..`,
    `${cliFolder}/a/b`,
    `${cliFolder}/a\\b`,
    `${cliFolder}/a\nb`,
    `${cliFolder}/1.0\0`,
    `${cliFolder}/1.0/`,
    `${cliFolder}/-1.0`,
    `${cliFolder}/1.0 `,
    '/elsewhere/0.80.0',
  ];

  /** What `placeCliFiles` did for `versionFolder`, on a channel that records every call it gets. */
  async function inFolder(versionFolder: string) {
    const seen = seenOf();
    const channel = new RecordingChannel({
      identity: 'c1',
      platformHint: 'linux',
    });
    const failure = await placeCliFiles(
      createLogger(seen.sink, {minimumLevel: () => 'info'}),
      {
        channel,
        remoteUser: 'dev',
        version: path.posix.basename(versionFolder),
        client: {
          cliFolder,
          preload: `${cliFolder}/cli-preload.js`,
          hashes: {},
        },
        newToken: () => 'tok',
        onPhase: () => undefined,
        onDownloadPercent: () => undefined,
        cancellation: NEVER,
      },
      {cliFolder, versionFolder},
    );
    return {
      kind: failure?.kind ?? 'none',
      calls: callsOf(channel),
      logged: loggedOf(seen),
    };
  }

  it('a version folder that is not of its own under the CLI folder is refused, with nothing run on the channel', async () => {
    const refused = await Promise.all(
      refusedFolders.map(async folder => inFolder(folder)),
    );
    deepStrictEqual(
      refused.map(each => [each.kind, each.calls]),
      refusedFolders.map(() => ['cliNotPlaced', []]),
    );
  });

  it('the refused folder is named in the log, word for word', async () => {
    const refused = await inFolder(`${cliFolder}/`);
    deepStrictEqual(refused.logged, [
      `the CLI's version folder ${cliFolder}/ is not a folder of its own under ${cliFolder}: nothing is placed`,
    ]);
  });
});
