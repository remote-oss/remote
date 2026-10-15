/**
 * @fileoverview A fake host for the bootstrap script tests: a folder of stand-in tools on the script's PATH, a home
 * folder, and a server archive, so a script runs for real under `sh` without touching the network or the machine.
 * Every folder a host makes is removed after each test.
 */

import {spawnSync} from 'node:child_process';
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
import {
  type BootstrapRequest,
  type ScriptParameters,
  parseResult,
  type ResultBlock,
  scriptFor,
} from '../../src/index.ts';

/** The real tools a script may use; everything else on the fake PATH is a stand-in. */
const REAL_TOOLS = [
  'basename',
  'cat',
  'chmod',
  'cp',
  'cut',
  'date',
  'dirname',
  'grep',
  'gzip',
  'head',
  'id',
  'ln',
  'ls',
  'readlink',
  'mkdir',
  'mv',
  'nohup',
  'ps',
  'rm',
  'rmdir',
  'sed',
  'sh',
  'sleep',
  'tail',
  'tar',
  'touch',
  'tr',
  'wc',
];

const SEARCH_FOLDERS = [
  '/usr/bin',
  '/bin',
  '/usr/local/bin',
  '/opt/homebrew/bin',
];

/** The path of a real tool, or undefined when the machine has none. */
function realTool(name: string): string | undefined {
  return SEARCH_FOLDERS.map(folder => path.join(folder, name)).find(file =>
    existsSync(file),
  );
}

/** The stand-in `uname`: its answers come from the environment. */
const UNAME = [
  '#!/bin/sh',
  'case "$1" in',
  '  -s) echo "${STUB_UNAME_S:-Linux}" ;;',
  '  -m) echo "${STUB_UNAME_M:-x86_64}" ;;',
  '  -r) echo 6.1.0 ;;',
  'esac',
].join('\n');

/** A stand-in downloader: it records its call and copies the archive to the output path. */
function downloader(name: string, outputFlag: string): string {
  return [
    '#!/bin/sh',
    'if [ "$1" = --help ]; then echo "${STUB_WGET_HELP:-GNU Wget}"; exit 0; fi',
    `echo "${name} $*" >>"$STUB_LOG"`,
    'echo "proxy=${http_proxy:-}" >>"$STUB_LOG"',
    'cat >/dev/null',
    'while [ $# -gt 0 ]; do',
    `  if [ "$1" = ${outputFlag} ]; then OUT=$2; fi`,
    '  shift',
    'done',
    '[ -z "$STUB_FETCH_SLEEP" ] || sleep "$STUB_FETCH_SLEEP"',
    '[ "${STUB_FETCH_FAILS:-no}" = yes ] && exit 1',
    '[ -z "${STUB_FETCH_ERROR:-}" ] || { printf "%s\\n" "$STUB_FETCH_ERROR" >&2; exit 1; }',
    'cp "$STUB_ARCHIVE" "$OUT"',
  ].join('\n');
}

/** A stand-in `flock`: busy when STUB_FLOCK_BUSY is yes. */
const FLOCK = [
  '#!/bin/sh',
  'echo "flock $*" >>"$STUB_LOG"',
  '[ "${STUB_FLOCK_BUSY:-no}" = yes ] && exit 1',
  'exit 0',
].join('\n');

/**
 * The stand-in server launcher: it records its arguments, writes `SERVER_LOG_BEFORE`, the ready line and
 * `SERVER_LOG_AFTER` to its log, then stays up a while.
 */
const LAUNCHER = [
  '#!/bin/sh',
  'if [ "$1" = --install-extension ]; then',
  '  echo "$2" >>"$EXTENSION_CALLS"',
  '  case " ${EXTENSION_FAILS:-} " in',
  '    *" $2 "*) echo "Extension \'$2\' not found."; exit 1 ;;',
  '  esac',
  '  echo "Extension \'$2\' was successfully installed."',
  '  exit 0',
  'fi',
  'echo "$*" >"$SERVER_ARGUMENTS"',
  'printf \'%s\\n\' "$@" >"$SERVER_ARGUMENTS.lines"',
  'echo started >>"$SERVER_STARTS"',
  '[ -z "$SERVER_LOG_BEFORE" ] || printf \'%s\\n\' "$SERVER_LOG_BEFORE"',
  '[ -z "$SERVER_EXIT" ] || exit "$SERVER_EXIT"',
  '[ -z "$SERVER_READY_AFTER" ] || sleep "$SERVER_READY_AFTER"',
  'ENDPOINT=4321',
  'while [ $# -gt 0 ]; do [ "$1" = --socket-path ] && ENDPOINT=$2; shift; done',
  '[ "$SERVER_SILENT" = yes ] || echo "Extension host agent listening on ${SERVER_READY_TEXT:-$ENDPOINT}"',
  '[ -z "$SERVER_LOG_AFTER" ] || printf \'%s\\n\' "$SERVER_LOG_AFTER"',
  'sleep 20',
].join('\n');

/** A stand-in tool that can be put on the fake PATH. */
export type Stub = 'wget' | 'curl' | 'flock' | 'getconf' | 'unzip';

const STUB_SCRIPTS: Readonly<Record<Stub, string>> = {
  wget: downloader('wget', '-O'),
  curl: downloader('curl', '-o'),
  flock: FLOCK,
  getconf: '#!/bin/sh\necho "glibc 2.36"',
  unzip: '#!/bin/sh\nexit 1',
};

/** One fake host. */
export interface FakeHost {
  /** The user's home folder. */
  home: string;
  /** The folder of stand-in tools, first on the PATH. */
  tools: string;
  /** The server archive the stand-in downloaders hand out. */
  archive: string;
  /** The file the stand-ins write their calls to. */
  callsFile: string;
  /** The environment a script starts with. */
  environment: Record<string, string>;
}

function writeExecutable(file: string, text: string): void {
  writeFileSync(file, `${text}\n`);
  chmodSync(file, 0o755);
}

/** The folders the fake hosts made since the last cleanup. */
const madeSinceCleanup: string[] = [];

/**
 * Removes every folder a fake host made since the last cleanup, so no `fake-host-*` folder survives a suite; a folder
 * that is already gone is not an error.
 */
export function removeFakeHosts(): void {
  for (const folder of madeSinceCleanup) {
    rmSync(folder, {recursive: true, force: true});
  }
  madeSinceCleanup.length = 0;
}

afterEach(removeFakeHosts);

/** Builds the server archive: one top folder holding the launcher under `bin/`. */
function buildArchive(folder: string): string {
  const source = path.join(folder, 'source', 'server-1.0');
  mkdirSync(path.join(source, 'bin'), {recursive: true});
  writeExecutable(path.join(source, 'bin', 'launcher'), LAUNCHER);
  writeFileSync(path.join(source, 'product.json'), '{}\n');
  mkdirSync(path.join(source, 'files'));
  for (let index = 0; index < 60; index++) {
    writeFileSync(path.join(source, 'files', `file-${String(index)}`), '');
  }
  const archive = path.join(folder, 'server.tar.gz');
  spawnSync('tar', [
    '-czf',
    archive,
    '-C',
    path.join(folder, 'source'),
    'server-1.0',
  ]);
  return archive;
}

/** A fake host with the given stand-in tools; the real tools it needs are linked in. */
export function fakeHost(stubs: readonly Stub[] = ['wget']): FakeHost {
  const root = mkdtempSync(path.join(tmpdir(), 'fake-host-'));
  madeSinceCleanup.push(root);
  const tools = path.join(root, 'tools');
  const home = path.join(root, 'home');
  mkdirSync(tools);
  mkdirSync(home);
  for (const name of REAL_TOOLS) {
    const file = realTool(name);
    if (file !== undefined) {
      symlinkSync(file, path.join(tools, name));
    }
  }
  writeExecutable(path.join(tools, 'uname'), UNAME);
  for (const name of stubs) {
    writeExecutable(path.join(tools, name), STUB_SCRIPTS[name]);
  }
  const callsFile = path.join(root, 'calls.log');
  writeFileSync(callsFile, '');
  return {
    home,
    tools,
    archive: buildArchive(root),
    callsFile,
    environment: {
      PATH: tools,
      HOME: home,
      SHELL: '/bin/sh',
      STUB_LOG: callsFile,
      STUB_ARCHIVE: path.join(root, 'server.tar.gz'),
      SERVER_ARGUMENTS: path.join(root, 'arguments.txt'),
      SERVER_STARTS: path.join(root, 'starts.txt'),
      EXTENSION_CALLS: path.join(root, 'extensions.txt'),
    },
  };
}

/** The recorded calls of the stand-in tools, one per line. */
export function callsOf(host: FakeHost): string[] {
  return readFileSync(host.callsFile, 'utf8')
    .split('\n')
    .filter(line => line !== '');
}

/** The baseline parameters: a link lock in the install folder, a download of the stand-in archive. */
export function parametersFor(): ScriptParameters {
  return {
    installRoot: '',
    dataFolderName: '.server-data',
    launcher: 'bin/launcher',
    commit: 'abc123',
    archiveUrl: 'https://example.invalid/server.tar.gz',
    archivePath: '',
    removeArchive: false,
    archiveFormat: 'tar.gz',
    epochMilliseconds: 1700000000000,
    installTree: '',
    proxy: {http: '', https: ''},
    downloader: {useConfigurationFiles: false, timeoutSeconds: 30},
    lock: {
      method: 'link',
      inTemporaryFolder: false,
      filePrefix: 'boot-lock.user',
    },
    environmentSetup: '',
    cleanup: {kind: 'keepNewest', count: 5},
    start: {
      bindHost: '127.0.0.1',
      port: '0',
      licenceAccepted: false,
      graceSeconds: 0,
      extensions: [],
      fileWatcherPollingMilliseconds: 0,
      useHostProxy: false,
      requirementsHelper: false,
      readySeconds: 3,
      socketMode: false,
    },
  };
}

/** How a script is run: the shell, the extra environment, and what the script reads on its standard input. */
export interface RunOptions {
  shell?: string;
  environment?: Record<string, string>;
  /** When set, the script is passed as an argument and this is its standard input. */
  input?: Buffer;
  /** Changes the script text before it runs, for a test that points an absolute path into the fake host. */
  rewriteScript?: (script: string) => string;
}

/** Runs a script for a request on the fake host and returns its output lines. */
export function runScript(
  host: FakeHost,
  request: BootstrapRequest,
  parameters: ScriptParameters,
  options: RunOptions = {},
): string[] {
  const script = (options.rewriteScript ?? (text => text))(
    scriptFor(request, 'posixShell', parameters),
  );
  const shell = options.shell ?? '/bin/sh';
  const environment = {...host.environment, ...options.environment};
  const result =
    options.input === undefined
      ? spawnSync(shell, ['-s'], {
          input: script,
          env: environment,
          encoding: 'utf8',
        })
      : spawnSync(shell, ['-c', script], {
          input: options.input,
          env: environment,
        });
  return String(result.stdout).split('\n');
}

/** The result block of a run, or `none` when the output holds no complete block. */
export function blockOf(
  host: FakeHost,
  request: BootstrapRequest,
  parameters: ScriptParameters,
  options: RunOptions = {},
): ResultBlock | 'none' {
  const parsed = parseResult(runScript(host, request, parameters, options));
  return 'block' in parsed ? parsed.block : 'none';
}

/** A request for a single-script step. */
export function single(
  step: Extract<BootstrapRequest, {installMode: 'singleScript'}>['step'],
): BootstrapRequest {
  return {installMode: 'singleScript', step};
}

/** The install folder of the baseline parameters on a host. */
export function installFolder(host: FakeHost): string {
  return path.join(host.home, '.server-data', 'bin', 'abc123');
}

/**
 * Registers the hooks that give each test of the enclosing suite a fake host with the baseline server installed, and
 * stop that host's servers after it. Returns the reader of the current test's host.
 */
export function installedHostPerTest(): () => FakeHost {
  let current: FakeHost | undefined;
  beforeEach(() => {
    current = fakeHost();
    runScript(current, single('install'), parametersFor());
  });
  afterEach(() => {
    if (current !== undefined) {
      runScript(current, single('kill'), parametersFor());
    }
  });
  return () => {
    if (current === undefined) {
      throw new Error('no fake host outside a test');
    }
    return current;
  };
}
