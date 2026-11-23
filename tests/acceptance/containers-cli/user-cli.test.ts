import {deepStrictEqual} from 'node:assert';
import {execFile, spawnSync} from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {refreshCliBin} from '../../../packages/remote-containers/src/cli-bin/cli-bin.ts';
import {nodeCliBinFs} from '../../../packages/remote-containers/src/cli-bin/node-cli-bin-fs.ts';

const execFileAsync = promisify(execFile);
const PACKAGE = path.join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'packages',
  'remote-containers',
);

/** Without the terminal's colour codes. */
function plain(text: string): string {
  // eslint-disable-next-line no-control-regex -- the codes start with the escape character
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

/** What a run of the launcher came to. */
interface Ran {
  status: number;
  stdout: string;
  stderr: string;
}

describe('the devcontainer launcher from a shell (card containers-211)', function () {
  this.timeout(300_000);
  let root = '';
  let launcher = '';
  let record = '';
  function environment(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      C211_NODE: process.execPath,
      C211_RECORD: record,
    };
  }

  before(async function () {
    if (!existsSync(path.join(PACKAGE, 'dist', 'cli-launcher.js'))) {
      this.skip();
    }
    root = mkdtempSync(path.join(tmpdir(), 'c211-'));
    record = path.join(root, 'record');
    // The editor's program: a Node for the launcher program, and a recorder when the launcher starts it as the editor.
    const stub = path.join(root, 'editor-stub');
    writeFileSync(
      stub,
      '#!/bin/sh\nif [ -n "$ELECTRON_RUN_AS_NODE" ]; then exec "$C211_NODE" "$@"; fi\nprintf "%s\\n" "$@" >> "$C211_RECORD"\n',
    );
    chmodSync(stub, 0o755);
    await refreshCliBin(
      root,
      {
        extensionPath: PACKAGE,
        appRoot: '/nowhere',
        editorPath: stub,
        quality: 'stable',
      },
      nodeCliBinFs,
    );
    launcher = path.join(root, 'cli-bin', 'devcontainer');
  });

  after(() => {
    rmSync(root, {recursive: true, force: true});
  });

  beforeEach(() => {
    rmSync(record, {force: true});
  });

  /** Runs the launcher on `argv` in `cwd`. */
  async function devcontainer(
    argv: readonly string[],
    cwd: string = root,
  ): Promise<Ran> {
    try {
      const done = await execFileAsync(launcher, argv, {
        cwd,
        env: environment(),
      });
      return {status: 0, stdout: done.stdout, stderr: done.stderr};
    } catch (failure) {
      const failed = failure as {
        code: number;
        stdout: string;
        stderr: string;
      };
      return {
        status: failed.code,
        stdout: failed.stdout,
        stderr: failed.stderr,
      };
    }
  }

  /** The lines the editor's stand-in recorded, once it has recorded `count` of them or `milliseconds` went by. */
  async function recorded(
    count: number,
    milliseconds: number,
  ): Promise<string[]> {
    const deadline = Date.now() + milliseconds;
    let lines: string[] = [];
    while (lines.length < count && Date.now() < deadline) {
      lines = existsSync(record)
        ? readFileSync(record, 'utf8')
            .split('\n')
            .filter(line => line !== '')
        : [];
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return lines;
  }

  /** The addresses the editor was started on: each start records its two arguments. */
  async function launched(): Promise<string[]> {
    return (await recorded(2, 10_000)).filter(line => line !== '--folder-uri');
  }

  /** What the editor was started with after a start would have had time to happen: none. */
  function notLaunched(): Promise<string[]> {
    return new Promise(resolve => {
      setTimeout(() => {
        resolve(recorded(0, 0));
      }, 1_500);
    });
  }

  /** The folder and the path an address carries: the authority’s hex decoded, and the path. */
  function decoded(address: string): {payload: string; path: string} {
    const match = /^vscode-remote:\/\/dev-container%2B([0-9a-f]+)(\/.*)$/.exec(
      address,
    );
    return {
      payload: Buffer.from(match?.[1] ?? '', 'hex').toString('utf8'),
      path: decodeURIComponent(match?.[2] ?? ''),
    };
  }

  /** A folder named `name` in the run's folder, with `configuration` as its default file. */
  function project(
    name: string,
    configuration: string | false = '{"image": "alpine:3.22"}',
    file: string[] = ['.devcontainer', 'devcontainer.json'],
  ): string {
    const folder = path.join(root, name);
    mkdirSync(folder, {recursive: true});
    if (configuration !== false) {
      mkdirSync(path.dirname(path.join(folder, ...file)), {recursive: true});
      writeFileSync(path.join(folder, ...file), configuration);
    }
    return folder;
  }

  it('F-1201 AC-32, AC-42, AC-43 (c211-open): open prints one banner line, exits 0 and starts the editor on the folder’s dev container address, with /workspaces/<name>, with / for Compose, with the workspaceFolder of a file with comments and trailing commas', async () => {
    const plainFolder = project('c211-plain');
    const rooted = project('c211-rooted', '{"image": "x"}', [
      '.devcontainer.json',
    ]);
    project(
      'c211-folder',
      '// c\n{ /* c */ "workspaceFolder": "/w/${localWorkspaceFolderBasename}", }',
    );
    project('c211-compose', '{"dockerComposeFile": "c.yml", "service": "app"}');
    const results: unknown[] = [];
    for (const name of [
      'c211-plain',
      'c211-rooted',
      'c211-folder',
      'c211-compose',
    ]) {
      rmSync(record, {force: true});
      const outcome = await devcontainer(['open', name]);
      const [address = ''] = await launched();
      results.push([
        outcome.status,
        plain(outcome.stderr)
          .split('\n')
          .filter(line => line !== '').length,
        /^\[\d+ ms\] @devcontainers\/cli \d+\.\d+\.\d+\. Node\.js v\S+\. \S+ \S+ \S+\.$/.test(
          plain(outcome.stderr).trim(),
        ),
        decoded(address).path,
        decoded(address).payload,
      ]);
    }
    deepStrictEqual(results, [
      [0, 1, true, '/workspaces/c211-plain', plainFolder],
      [0, 1, true, '/workspaces/c211-rooted', rooted],
      [0, 1, true, '/w/c211-folder', path.join(root, 'c211-folder')],
      [0, 1, true, '/', path.join(root, 'c211-compose')],
    ]);
  });

  it('F-1201 AC-45 (c211-paths): relative paths are resolved against the physical current folder, .. is resolved and one trailing slash dropped; a link argument keeps the link’s path', async () => {
    const real = project('c211-real');
    mkdirSync(path.join(root, 'c211-dotdot', 'sub'), {recursive: true});
    symlinkSync(real, path.join(root, 'c211-link'));
    const results: string[] = [];
    for (const [argument, cwd] of [
      ['c211-dotdot/sub/../../c211-real', root],
      ['c211-real/', root],
      ['.', path.join(root, 'c211-link')],
      ['c211-link', root],
      [`${root}/c211-dotdot/../c211-real/.`, root],
    ] as const) {
      rmSync(record, {force: true});
      await devcontainer(['open', argument], cwd);
      const [address = ''] = await launched();
      results.push(decoded(address).payload);
    }
    deepStrictEqual(results, [
      real,
      real,
      real,
      path.join(root, 'c211-link'),
      `${root}/c211-dotdot/../c211-real/.`,
    ]);
  });

  it('F-1201 AC-33, AC-34 (c211-config): --config puts the compact JSON of the folder and the file in the authority and takes the workspaceFolder from that file; a missing file is refused; a folder with no default file opens with the given one', async () => {
    const folder = project('c211-with');
    const other = path.join(folder, 'other.json');
    writeFileSync(other, '{"image": "y", "workspaceFolder": "/custom"}');
    const bare = project('c211-bare', false);
    const given = path.join(root, 'given.json');
    writeFileSync(given, '{"image": "z"}');
    const results: unknown[] = [];
    await devcontainer(['open', 'c211-with', '--config', other]);
    const [address = ''] = await launched();
    results.push([decoded(address).payload, decoded(address).path]);
    rmSync(record, {force: true});
    const missing = await devcontainer([
      'open',
      'c211-with',
      '--config',
      'nowhere.json',
    ]);
    results.push([missing.status, await notLaunched()]);
    await devcontainer(['open', 'c211-bare', '--config', given]);
    results.push(decoded((await launched())[0] ?? '').payload);
    deepStrictEqual(results, [
      [
        `{"hostPath":"${folder}","configFile":{"$mid":1,"path":"${other}","scheme":"file"}}`,
        '/custom',
      ],
      [1, []],
      `{"hostPath":"${bare}","configFile":{"$mid":1,"path":"${given}","scheme":"file"}}`,
    ]);
  });

  it('F-1201 AC-35, AC-44 (c211-refused): a folder with no configuration, an empty one, a path that does not exist, a file that is no workspace file and an invalid configuration each exit non-zero with the file or folder named, and start no editor', async () => {
    project('c211-none', false);
    project('c211-empty', '');
    project('c211-invalid', '{"workspaceFolder": "/x"');
    writeFileSync(path.join(root, 'c211-notes.txt'), 'x');
    const results: unknown[] = [];
    for (const argument of [
      'c211-none',
      'c211-empty',
      'c211-gone',
      'c211-notes.txt',
      'c211-invalid',
    ]) {
      const outcome = await devcontainer(['open', argument]);
      results.push([
        outcome.status !== 0,
        outcome.stderr.includes(argument),
        outcome.stdout,
      ]);
    }
    deepStrictEqual(
      [results, await notLaunched()],
      [
        [
          [true, true, ''],
          [true, true, ''],
          [true, true, ''],
          [true, true, ''],
          [true, true, ''],
        ],
        [],
      ],
    );
  });

  it('F-1201 AC-46, AC-47 (c211-characters): a space, a $ and quotes in the folder name are kept in the authority, and the path is percent-encoded', async () => {
    const results: unknown[] = [];
    for (const name of ['c211 sp ace', 'c211 d$lar', `c211 q'uote"d`]) {
      const folder = project(name);
      rmSync(record, {force: true});
      const outcome = await devcontainer(['open', name]);
      const [address = ''] = await launched();
      results.push([
        outcome.status,
        decoded(address).payload === folder,
        decoded(address).path === `/workspaces/${name}`,
        address.includes(' '),
      ]);
    }
    deepStrictEqual(results, [
      [0, true, true, false],
      [0, true, true, false],
      [0, true, true, false],
    ]);
  });

  it('F-1201 AC-48 (c211-workspace-file): a .code-workspace file opens the folder it is in, and another file opens nothing', async () => {
    const folder = project('c211-ws');
    writeFileSync(path.join(folder, 'ws.code-workspace'), '{}');
    const opened = await devcontainer(['open', 'c211-ws/ws.code-workspace']);
    const [address = ''] = await launched();
    rmSync(record, {force: true});
    const other = await devcontainer([
      'open',
      'c211-ws/.devcontainer/devcontainer.json',
    ]);
    deepStrictEqual(
      [
        opened.status,
        decoded(address),
        other.status !== 0,
        await notLaunched(),
      ],
      [0, {payload: folder, path: '/workspaces/c211-ws'}, true, []],
    );
  });

  it('F-1201 AC-49 (c211-two-arguments): two positional arguments print Unknown argument and the help of open, exit 1 and start nothing', async () => {
    project('c211-two');
    const outcome = await devcontainer(['open', 'c211-two', 'trail']);
    deepStrictEqual(
      [
        outcome.status,
        outcome.stderr.includes('Unknown argument: trail'),
        outcome.stderr.startsWith('devcontainer open [path]'),
        await notLaunched(),
      ],
      [1, true, true, []],
    );
  });

  it('F-1201 AC-31 (c211-help): the overview help lists open first and ends with the CLI’s version and the install folder; the help of open names its positional and options', async () => {
    const overview = await devcontainer(['--help']);
    const open = await devcontainer(['open', '--help']);
    const commands = overview.stdout.split('\n');
    deepStrictEqual(
      [
        overview.status,
        commands[commands.indexOf('Commands:') + 1]
          ?.trim()
          .startsWith('devcontainer open [path]'),
        overview.stdout.trimEnd().endsWith(` ${PACKAGE}`),
        open.status,
        ['path to project folder', '--disable-telemetry', '--config'].map(
          text => open.stdout.includes(text),
        ),
      ],
      [0, true, true, 0, [true, true, true]],
    );
  });

  it('F-1201 AC-38, AC-39 (c211-build): build with a positional folder and --verbose builds the image, and an option of the newer build is Unknown argument with the help, exit 1 and no image', async function () {
    if (spawnSync('docker', ['version']).status !== 0) {
      this.skip();
    }
    const folder = project(
      'c211-build',
      '{"build": {"dockerfile": "Dockerfile"}}',
    );
    writeFileSync(
      path.join(folder, '.devcontainer', 'Dockerfile'),
      'FROM alpine:3.22\nLABEL c211=1\n',
    );
    const image = `c211-built:${path.basename(root).toLowerCase()}`;
    const built = await devcontainer([
      'build',
      'c211-build',
      '--verbose',
      '--disable-telemetry',
      '--image-name',
      image,
    ]);
    const present =
      spawnSync('docker', ['image', 'inspect', image]).status === 0;
    spawnSync('docker', ['rmi', '--force', image]);
    const refused = await devcontainer([
      'build',
      'c211-build',
      '--label',
      'a=b',
      '--image-name',
      image,
    ]);
    deepStrictEqual(
      [
        built.status,
        present,
        refused.status,
        refused.stderr.includes('Unknown argument: label'),
        refused.stderr.startsWith('devcontainer build [path]'),
        spawnSync('docker', ['image', 'inspect', image]).status !== 0,
      ],
      [0, true, 1, true, true, true],
    );
  });
});
