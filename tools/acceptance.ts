/**
 * @fileoverview acceptance: runs the acceptance tests in the editor under test against an SSH host in a container.
 *
 *     node tools/acceptance.ts
 *
 * It builds the host image of tests/acceptance/host, makes a key pair for this run, starts the host with the public
 * key, writes an ssh_config whose `Host harness` reaches it, bundles the tests of tests/acceptance/suite, and starts
 * `@vscode/test-cli` with tests/acceptance/vscode-test.mjs. The editor gets a fresh user-data and extensions folder,
 * the packaged VSIX files of the extensions under test, and the harness variables. The container and the run's
 * folder are removed at the end, whatever the outcome. Run `pnpm package` first; `pnpm test:acceptance` does both.
 */

import {spawnSync} from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';
import {
  downloadAndUnzipVSCode,
  resolveCliPathFromVSCodeExecutablePath,
} from '@vscode/test-electron';
import {build} from 'esbuild';
import {
  isMainModule,
  messageOf,
  REPOSITORY_ROOT,
  resolveBinary,
  sortedEntries,
} from './repository.ts';

/** The editor version the tests run on: the floor of ADR-0007. */
const EDITOR_VERSION = '1.139.1';

/** The image tag of the SSH host. */
const HOST_IMAGE = 'remote-oss-acceptance-host';

/** The packages whose VSIX files are installed into the editor under test, by their extension id. */
const EXTENSIONS_UNDER_TEST = new Map([
  ['remote-oss.remote-ssh', 'remote-ssh'],
  ['remote-oss.remote-ssh-edit', 'remote-ssh-edit'],
]);

/** The extensions under test that use proposed API, enabled for them on the command line. */
const PROPOSED_API_EXTENSIONS: readonly string[] = ['remote-oss.remote-ssh'];

/**
 * The variables the harness passes to the extension host. `REMOTE_OSS_ACCEPTANCE` is the one switch with which a
 * package installs its harness adapters (dialogs answered from a script, the log readable by the tests); a user's
 * editor never sets it.
 */
export interface HarnessVariables {
  REMOTE_OSS_ACCEPTANCE: '1';
  /** The ssh_config whose `Host harness` reaches the container. */
  HARNESS_SSH_CONFIG: string;
  /** The container id, for `docker exec` checks on the host. */
  HARNESS_CONTAINER: string;
  /** The run's folder: user data, extensions, keys. */
  HARNESS_RUN_FOLDER: string;
  /** The VSIX files to install, separated by the path delimiter; empty when none is packaged yet. */
  HARNESS_VSIX_FILES: string;
}

/** The result of one command: its exit status and its standard output and error. */
export interface CommandResult {
  status: number;
  stdout: string;
  stderr: string;
}

/** Runs a program with its arguments and waits for it. */
type CommandRunner = (
  program: string,
  programArguments: readonly string[],
) => CommandResult;

/** Waits the given number of milliseconds. */
type Sleeper = (milliseconds: number) => Promise<void>;

/** The steps of a run that touch more than the run's folder: what a test replaces. */
export interface HarnessDependencies {
  command: CommandRunner;
  sleep: Sleeper;
  bundleSuite: (root: string) => Promise<void>;
  /** The command line of the editor's CLI at the version under test, downloading the editor when it is missing. */
  editorCli: () => Promise<string>;
  /** Starts test-cli with the harness variables and returns its exit code and its output. */
  runTests: (
    root: string,
    variables: HarnessVariables,
  ) => Promise<AttemptResult>;
}

/** How long the run waits for sshd to accept the first connection, in attempts half a second apart. */
const READY_ATTEMPTS = 40;

const READY_INTERVAL = 500;

function checked(
  command: CommandRunner,
  program: string,
  programArguments: readonly string[],
): string {
  const result = command(program, programArguments);
  if (result.status !== 0) {
    throw new Error(
      `${program} ${programArguments.join(' ')} failed (${String(result.status)}): ${result.stderr.trim()}`,
    );
  }
  return result.stdout;
}

/** The host port Docker maps to the container's port 22, from `docker port` output such as `127.0.0.1:49153`. */
export function mappedPort(dockerPortOutput: string): number {
  const match = /:(\d+)\s*$/m.exec(dockerPortOutput);
  if (match?.[1] === undefined) {
    throw new Error(`no mapped port in '${dockerPortOutput.trim()}'`);
  }
  return Number(match[1]);
}

/** The ssh_config of the run: `Host harness` with the run's key, its own known-hosts file and no agent. */
export function harnessSshConfig(port: number, runFolder: string): string {
  return [
    'Host harness',
    '  HostName 127.0.0.1',
    `  Port ${String(port)}`,
    '  User harness',
    `  IdentityFile ${path.join(runFolder, 'id_ed25519')}`,
    '  IdentitiesOnly yes',
    '  IdentityAgent none',
    '  StrictHostKeyChecking accept-new',
    '  BatchMode yes',
    '  ConnectTimeout 10',
    `  UserKnownHostsFile ${path.join(runFolder, 'known_hosts')}`,
    '',
  ].join('\n');
}

/** The packaged VSIX files of the extensions under test that exist under `<root>/dist`. */
export function packagedExtensions(root: string): string[] {
  const folder = path.join(root, 'dist');
  if (!existsSync(folder)) {
    return [];
  }
  const packageNames = new Set(EXTENSIONS_UNDER_TEST.values());
  return sortedEntries(folder)
    .filter(entry => {
      const packageName = /^(.+)-\d+\.\d+\.\d+\.vsix$/.exec(entry.name)?.[1];
      return packageName !== undefined && packageNames.has(packageName);
    })
    .map(entry => path.join(folder, entry.name));
}

/** The editor's user settings of the run: the extensions under test read the harness's ssh_config. */
export function writeUserSettings(runFolder: string, configFile: string): void {
  const folder = path.join(runFolder, 'user-data', 'User');
  mkdirSync(folder, {recursive: true});
  writeFileSync(
    path.join(folder, 'settings.json'),
    `${JSON.stringify({'remote.SSH.configFile': configFile}, null, 2)}\n`,
  );
}

async function waitForHost(
  dependencies: HarnessDependencies,
  configFile: string,
): Promise<void> {
  for (let attempt = 1; attempt <= READY_ATTEMPTS; attempt++) {
    const result = dependencies.command('ssh', [
      '-F',
      configFile,
      'harness',
      'true',
    ]);
    if (result.status === 0) {
      return;
    }
    if (attempt === READY_ATTEMPTS) {
      throw new Error(`the host did not accept SSH: ${result.stderr.trim()}`);
    }
    await dependencies.sleep(READY_INTERVAL);
  }
}

/**
 * Prepares the host and the run's folder and returns the harness variables. The caller removes the container and
 * the folder through `tearDown`, also when this throws after the container started.
 */
async function prepare(
  root: string,
  dependencies: HarnessDependencies,
  runFolder: string,
  started: string[],
): Promise<HarnessVariables> {
  const {command} = dependencies;
  checked(command, 'docker', [
    'build',
    '--load',
    '--quiet',
    '--tag',
    HOST_IMAGE,
    path.join(root, 'tests', 'acceptance', 'host'),
  ]);
  const keyFile = path.join(runFolder, 'id_ed25519');
  checked(command, 'ssh-keygen', [
    '-q',
    '-t',
    'ed25519',
    '-N',
    '',
    '-C',
    'acceptance',
    '-f',
    keyFile,
  ]);
  const publicKey = readFileSync(`${keyFile}.pub`, 'utf8').trim();
  const container = checked(command, 'docker', [
    'run',
    '--detach',
    '--rm',
    '--env',
    `AUTHORIZED_KEY=${publicKey}`,
    '--publish',
    '127.0.0.1::22',
    HOST_IMAGE,
  ]).trim();
  started.push(container);
  const port = mappedPort(
    checked(command, 'docker', ['port', container, '22']),
  );
  const configFile = path.join(runFolder, 'ssh_config');
  writeFileSync(configFile, harnessSshConfig(port, runFolder));
  writeUserSettings(runFolder, configFile);
  await waitForHost(dependencies, configFile);
  await dependencies.bundleSuite(root);
  const vsixFiles = packagedExtensions(root);
  if (vsixFiles.length > 0) {
    checked(command, await dependencies.editorCli(), [
      `--extensions-dir=${path.join(runFolder, 'extensions')}`,
      `--user-data-dir=${path.join(runFolder, 'user-data')}`,
      ...vsixFiles.flatMap(file => ['--install-extension', file]),
    ]);
  }
  return {
    REMOTE_OSS_ACCEPTANCE: '1',
    HARNESS_SSH_CONFIG: configFile,
    HARNESS_CONTAINER: container,
    HARNESS_RUN_FOLDER: runFolder,
    HARNESS_VSIX_FILES: vsixFiles.join(path.delimiter),
  };
}

/**
 * Runs the acceptance tests and returns the exit code for the process: test-cli's, or 1 when the harness could not
 * be prepared.
 */
export async function runAcceptance(
  root: string,
  dependencies: HarnessDependencies,
): Promise<number> {
  const runFolder = mkdtempSync(path.join(tmpdir(), 'acceptance-'));
  const started: string[] = [];
  try {
    const variables = await prepare(root, dependencies, runFolder, started);
    return await runWithRetry(
      () => dependencies.runTests(root, variables),
      line => {
        console.log(line);
      },
    );
  } catch (error) {
    console.error(`acceptance: ${messageOf(error)}`);
    return 1;
  } finally {
    for (const container of started) {
      dependencies.command('docker', ['rm', '--force', container]);
    }
    rmSync(runFolder, {recursive: true, force: true});
  }
}

/** The `@vscode/test-cli` configuration of a run, from the harness variables in `environment`. */
export function acceptanceConfiguration(
  root: string,
  environment: Readonly<Record<string, string | undefined>>,
): {
  label: string;
  version: string;
  extensionDevelopmentPath: string;
  files: string;
  launchArgs: string[];
  env: Record<string, string | undefined>;
  mocha: {ui: 'bdd'; timeout: number};
} {
  const runFolder = environment.HARNESS_RUN_FOLDER ?? '';
  return {
    label: 'acceptance',
    version: EDITOR_VERSION,
    extensionDevelopmentPath: path.join(root, 'tests', 'acceptance', 'runner'),
    // test-cli expands a glob relative to its configuration file, tests/acceptance/vscode-test.mjs.
    files: 'dist/**/*.test.cjs',
    launchArgs: [
      `--user-data-dir=${path.join(runFolder, 'user-data')}`,
      `--extensions-dir=${path.join(runFolder, 'extensions')}`,
      ...PROPOSED_API_EXTENSIONS.map(
        extensionId => `--enable-proposed-api=${extensionId}`,
      ),
      '--disable-workspace-trust',
    ],
    env: {...environment},
    mocha: {ui: 'bdd', timeout: 60_000},
  };
}

/** Bundles every `*.test.ts` of tests/acceptance/suite into tests/acceptance/dist, one `.cjs` file each. */
export async function bundleSuite(root: string): Promise<void> {
  const suite = path.join(root, 'tests', 'acceptance', 'suite');
  await build({
    entryPoints: sortedEntries(suite)
      .filter(entry => entry.name.endsWith('.test.ts'))
      .map(entry => path.join(suite, entry.name)),
    outdir: path.join(root, 'tests', 'acceptance', 'dist'),
    bundle: true,
    platform: 'node',
    // The repository's package.json says "type": "module", so a CommonJS bundle needs the .cjs extension.
    format: 'cjs',
    outExtension: {'.js': '.cjs'},
    external: ['vscode'],
    logLevel: 'warning',
  });
}

/**
 * The editor's CLI at the version under test. The harness installs the VSIX files with it into the run's own
 * extensions folder, the one the editor is started with; test-cli's own install would use its default folder.
 */
async function editorCli(): Promise<string> {
  const executable = await downloadAndUnzipVSCode(EDITOR_VERSION);
  return resolveCliPathFromVSCodeExecutablePath(executable);
}

/** Runs a program and collects its exit status and output. */
export function runCommand(
  program: string,
  programArguments: readonly string[],
): CommandResult {
  const result = spawnSync(program, programArguments, {encoding: 'utf8'});
  return {
    status: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

/** The lines in the editor's output that report a hung window; the run is retried once on them. */
export const HANG_MARKERS: readonly string[] = Object.freeze([
  'CodeWindow: detected unresponsive',
]);

/** The result of one attempt of the acceptance run: the process's exit code and its output. */
export interface AttemptResult {
  exitCode: number;
  output: string;
}

/** Whether an attempt is retried: only a failing attempt below the limit whose output names a hung window. */
export function shouldRetry(
  attempt: number,
  exitCode: number,
  output: string,
  maxAttempts = 2,
): boolean {
  return (
    attempt < maxAttempts &&
    exitCode !== 0 &&
    HANG_MARKERS.some(marker => output.includes(marker))
  );
}

/** Runs the attempt; on a retriable result it logs the retry and runs once more; it returns the last exit code. */
export async function runWithRetry(
  // eslint-disable-next-line id-length -- the contract's parameter names
  run: () => Promise<AttemptResult>,
  // eslint-disable-next-line id-length -- the contract's parameter names
  log: (line: string) => void,
  maxAttempts = 2,
): Promise<number> {
  const first = await run();
  if (!shouldRetry(1, first.exitCode, first.output, maxAttempts)) {
    return first.exitCode;
  }
  log('acceptance: editor window unresponsive on attempt 1; retrying once');
  const second = await run();
  return second.exitCode;
}

/**
 * Starts test-cli with the acceptance configuration and the harness variables, and returns its result: the
 * editor's output is captured for the retry decision, and echoed to the job's log, so both attempts show there.
 */
export function runTestCli(
  root: string,
  variables: HarnessVariables,
): Promise<AttemptResult> {
  const result = spawnSync(
    process.execPath,
    [
      path.join(path.dirname(resolveBinary('@vscode/test-cli')), 'bin.mjs'),
      '--config',
      path.join(root, 'tests', 'acceptance', 'vscode-test.mjs'),
    ],
    {
      cwd: root,
      env: {...process.env, ...variables},
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    },
  );
  const output = `${result.stdout}${result.stderr}`;
  if (output.length > 0) {
    console.log(output.replace(/\n$/, ''));
  }
  return Promise.resolve({exitCode: result.status ?? 1, output});
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await runAcceptance(REPOSITORY_ROOT, {
    command: runCommand,
    sleep: delay,
    bundleSuite,
    editorCli,
    runTests: runTestCli,
  });
}
