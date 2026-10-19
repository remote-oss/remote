import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  RecordingChannel,
  type ScriptEnding,
} from 'lib-host/testing/recording-channel';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import type {ProductProfile} from 'lib-product';
import {cacheFolders, parseResult, RESULT_BEGIN, RESULT_END} from 'lib-server';
import {
  prepareVolumeFolders,
  sharedFoldersOf,
  VOLUME_FOLDERS_SCRIPT,
} from '../../src/connect/volume-folders.ts';

const execFileAsync = promisify(execFile);
const NEVER = new AbortController().signal;

const PROFILE: ProductProfile = {
  applicationName: 'codium',
  commit: 'abc123',
  version: '1.2.3',
  release: '',
  quality: 'stable',
  serverApplicationName: 'codium-server',
  serverDataFolderName: '.vscodium-server',
  serverDownloadRedirectHosts: [],
  serverDownloadUrlTemplate: '',
  serverLicense: [],
  serverLicenseUrl: '',
  dataFolderName: '.vscode-oss',
  tunnelApplicationName: 'codium-tunnel',
  urlProtocol: 'vscodium',
  cliDownloadUrlTemplate: '',
  updateUrl: '',
  downloadUrl: '',
};

/** A folder's mode bits, as `stat` gives them in octal. */
function modeOf(folder: string): string {
  return (statSync(folder).mode & 0o777).toString(8);
}

/** The script's three folders under `root`. */
function foldersUnder(root: string): string[] {
  return [
    path.join(root, 's'),
    path.join(root, 's', 'bin'),
    path.join(root, 's', 'bin', 'p'),
  ];
}

/** Runs the script in `/bin/sh` on the folders and gives its result block's status and facts. */
async function runScriptOn(
  folders: readonly string[],
): Promise<{status: string; facts: Record<string, string>}> {
  const {stdout} = await execFileAsync(
    '/bin/sh',
    ['-c', VOLUME_FOLDERS_SCRIPT],
    {
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        SHARED_FOLDER_1: folders[0] ?? '',
        SHARED_FOLDER_2: folders[1] ?? '',
        SHARED_FOLDER_3: folders[2] ?? '',
      },
    },
  );
  const parsed = parseResult(stdout.split('\n'));
  if ('failure' in parsed) {
    throw new Error(`no result block in: ${stdout}`);
  }
  return {status: parsed.block.status, facts: parsed.block.serverFacts};
}

/** A channel whose one script prints `lines` and ends as `ending` says. */
function rootChannelOf(
  lines: readonly string[],
  ending: ScriptEnding = {kind: 'exit', status: 0},
): RecordingChannel {
  return new RecordingChannel({
    identity: 'c1',
    platformHint: 'linux',
    scripts: [{interpreter: 'posixShell', matches: () => true, lines, ending}],
  });
}

/** Runs the step over `channel` for `platform` and gives the lines it logged. */
async function loggedBy(
  channel: RecordingChannel,
  platform = 'linux-x64',
): Promise<string[]> {
  const sink = new MemorySink();
  await prepareVolumeFolders(
    channel,
    PROFILE,
    platform,
    createLogger(sink, {minimumLevel: () => 'info'}),
    NEVER,
  );
  return sink.lines.map(line => line.message);
}

describe("C10's root step for the vscode volume (card containers-25)", () => {
  let root = '';

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'volume-folders-'));
  });

  afterEach(() => {
    rmSync(root, {recursive: true, force: true});
  });

  it('F-0419 5.0 step 6: a fresh volume gets the three folders, each 0777', async () => {
    const folders = foldersUnder(root);
    const result = await runScriptOn(folders);
    deepStrictEqual(
      [result, folders.map(modeOf)],
      [
        {status: 'Ok', facts: {created: folders.join(' ')}},
        ['777', '777', '777'],
      ],
    );
  });

  it('F-0419 7.E4: an existing folder keeps its mode', async () => {
    const folders = foldersUnder(root);
    mkdirSync(folders[0] ?? '', {mode: 0o700});
    const result = await runScriptOn(folders);
    deepStrictEqual(
      [result, folders.map(modeOf)],
      [
        {status: 'Ok', facts: {created: folders.slice(1).join(' ')}},
        ['700', '777', '777'],
      ],
    );
  });

  it('F-0419 7.E5: an existing tree is left as found', async () => {
    const folders = foldersUnder(root);
    mkdirSync(folders[2] ?? '', {recursive: true, mode: 0o755});
    const stray = path.join(folders[2] ?? '', 'stray');
    writeFileSync(stray, 'x');
    const before = folders.map(modeOf);
    const result = await runScriptOn(folders);
    deepStrictEqual(
      [result, folders.map(modeOf), readdirSync(folders[2] ?? '')],
      [{status: 'Ok', facts: {created: ''}}, before, ['stray']],
    );
  });

  it("contracts §5.2: an existing file in a folder's place is left alone", async () => {
    const folders = foldersUnder(root);
    mkdirSync(folders[1] ?? '', {recursive: true});
    writeFileSync(folders[2] ?? '', 'kept');
    const result = await runScriptOn(folders);
    deepStrictEqual(
      [result, readFileSync(folders[2] ?? '', 'utf8')],
      [{status: 'Ok', facts: {created: ''}}, 'kept'],
    );
  });

  it('contracts §5.2: a folder that cannot be made is reported, and the first failure is the one kept', async () => {
    const folders = foldersUnder(root);
    writeFileSync(folders[0] ?? '', 'not a folder');
    const result = await runScriptOn(folders);
    deepStrictEqual(
      [
        result.status,
        result.facts.created,
        result.facts.writeFailedPath,
        result.facts.writeFailedError?.includes(folders[1] ?? ''),
        result.facts.writeFailedError?.includes('\n'),
      ],
      ['CreateInstallDirFailed', '', folders[1], true, false],
    );
  });

  it('contracts §5.2: the script is the fixed text and the folders come in the environment', async () => {
    const channel = rootChannelOf([RESULT_BEGIN, 'status=Ok', RESULT_END]);
    await loggedBy(channel);
    const [call] = channel.calls;
    deepStrictEqual(
      call?.operation === 'runScript'
        ? [
            call.request.script === VOLUME_FOLDERS_SCRIPT,
            call.request.interpreter,
            call.request.environment,
            call.request.input,
          ]
        : [],
      [
        true,
        'posixShell',
        {
          SHARED_FOLDER_1: '/vscode/codium-server',
          SHARED_FOLDER_2: '/vscode/codium-server/bin',
          SHARED_FOLDER_3: '/vscode/codium-server/bin/linux-x64',
        },
        {kind: 'text', text: ''},
      ],
    );
  });

  it('contracts §5.2: folders made log "the volume\'s shared folders were created"', async () => {
    deepStrictEqual(
      await loggedBy(
        rootChannelOf([
          RESULT_BEGIN,
          'status=Ok',
          'server.created=/vscode/a/bin /vscode/a/bin/linux-x64',
          RESULT_END,
        ]),
      ),
      [
        "the volume's shared folders were created: /vscode/a/bin, /vscode/a/bin/linux-x64",
      ],
    );
  });

  it('contracts §5.2: nothing made logs "the volume\'s shared folders all exist"', async () => {
    deepStrictEqual(
      await loggedBy(
        rootChannelOf([
          RESULT_BEGIN,
          'status=Ok',
          'server.created=',
          RESULT_END,
        ]),
      ),
      ["the volume's shared folders all exist"],
    );
  });

  it('contracts §5.2: a folder that could not be made logs "the volume\'s shared folder … could not be made"', async () => {
    deepStrictEqual(
      await loggedBy(
        rootChannelOf([
          RESULT_BEGIN,
          'status=CreateInstallDirFailed',
          'server.created=',
          'server.writeFailedPath=/vscode/a',
          'server.writeFailedError=mkdir: /vscode/a: Read-only file system',
          RESULT_END,
        ]),
      ),
      [
        "the volume's shared folder /vscode/a could not be made: mkdir: /vscode/a: Read-only file system",
      ],
    );
  });

  it('contracts §5.2: a failed block without its facts still logs one line', async () => {
    deepStrictEqual(
      await loggedBy(
        rootChannelOf([
          RESULT_BEGIN,
          'status=CreateInstallDirFailed',
          RESULT_END,
        ]),
      ),
      ["the volume's shared folder  could not be made: "],
    );
  });

  it('contracts §5.2: a block with no created fact logs that all exist', async () => {
    deepStrictEqual(
      await loggedBy(rootChannelOf([RESULT_BEGIN, 'status=Ok', RESULT_END])),
      ["the volume's shared folders all exist"],
    );
  });

  it('contracts §5.2: a channel that failed logs "the volume\'s shared folders were not prepared"', async () => {
    deepStrictEqual(
      await loggedBy(
        rootChannelOf([], {
          kind: 'fail',
          failure: {kind: 'spawnFailed', detail: 'docker: not found'},
        }),
      ),
      [
        "the volume's shared folders were not prepared: spawnFailed: docker: not found",
      ],
    );
  });

  it('contracts §5.2: no result block logs "the root step gave no result"', async () => {
    deepStrictEqual(
      await loggedBy(
        rootChannelOf(['unable to find user root'], {
          kind: 'exit',
          status: 126,
        }),
      ),
      [
        "the volume's shared folders were not prepared: the root step gave no result (exit 126)",
      ],
    );
  });

  it('contracts §5.2: the folders are the product’s server folder, its bin and its platform folder', () => {
    deepStrictEqual(sharedFoldersOf(PROFILE, 'alpine-arm64'), [
      '/vscode/codium-server',
      '/vscode/codium-server/bin',
      '/vscode/codium-server/bin/alpine-arm64',
    ]);
  });

  it('contracts §5.2: the platform folder is the server tree’s parent', () => {
    deepStrictEqual(
      ['linux-x64', 'alpine-arm64'].map(
        platform =>
          sharedFoldersOf(PROFILE, platform)?.[2] ===
          cacheFolders(PROFILE, PROFILE.commit, platform, true)
            .serverTree?.split('/')
            .slice(0, -1)
            .join('/'),
      ),
      [true, true],
    );
  });

  it("contracts §5.2: a platform that isn't a folder name skips the root step", async () => {
    const channel = rootChannelOf([]);
    deepStrictEqual(
      [
        ['linux-x64;rm', 'Linux-x64', ''].map(platform =>
          sharedFoldersOf(PROFILE, platform),
        ),
        await loggedBy(channel, 'linux-x64;rm'),
        channel.calls,
      ],
      [
        [undefined, undefined, undefined],
        [
          'the volume\'s shared folders were not prepared: the platform "linux-x64;rm" is not a folder name',
        ],
        [],
      ],
    );
  });
});
