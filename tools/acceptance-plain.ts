/**
 * @fileoverview acceptance-plain: the launches that start the editor plainly, as a user does, with no test run in it.
 * One editor process, the launch's own user-data folder and the run's extensions folder, which holds our VSIX files and
 * the window agent's. The agent opens, reloads and closes the windows; a Node mocha run makes the assertions, from the record, the
 * agent's events and the host's state.
 */

import {spawn, spawnSync} from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {build} from 'esbuild';
import {
  needsDevContainerImage,
  withHarnessBases,
  withRunTokens,
  type Launch,
} from './acceptance-launches.ts';
import {resolveBinary} from './repository.ts';
import {windowNameOf} from '../tests/acceptance/window-agent/src/window-name.ts';

/** The extensions under test that use proposed API, enabled for them on the command line. */
const PROPOSED_API_EXTENSIONS: readonly string[] = [
  'remote-oss.remote-ssh',
  'remote-oss.acceptance-window-agent',
];

/** The extensions folder of a launch: its own when it installs extensions of its own or starts VS Code, the run's otherwise. */
export function extensionsFolderOf(runFolder: string, launch?: Launch): string {
  return launch?.kind === 'plain' &&
    (launch.withExtensions !== undefined || launch.client !== undefined)
    ? path.join(runFolder, `extensions-${launch.label}`)
    : path.join(runFolder, 'extensions');
}

/**
 * The user-data folder of a launch: its own for a launch with no runner, so nothing one launch stores reaches the next;
 * the run's for the runner launches and the installs.
 */
export function userDataFolderOf(runFolder: string, launch?: Launch): string {
  return launch?.kind === 'plain'
    ? path.join(runFolder, `user-data-${launch.label}`)
    : path.join(runFolder, 'user-data');
}

/**
 * The state folder of the editor of a launch, which the editor reads from `XDG_STATE_HOME` and writes its logs under:
 * the launch's own in the run's folder, so no two runs share one.
 */
export function stateFolderOf(runFolder: string, label: string): string {
  return path.join(runFolder, label, 'state');
}

/**
 * The variables that put the logs of an editor in a folder of the run: `XDG_STATE_HOME`, the launch's own state folder
 * unless the launch's `environment` names one, and `HARNESS_EDITOR_LOGS`, the one in effect, which the rows read.
 */
export function editorLogsEnvironment(
  stateFolder: string,
  launchEnvironment: Readonly<Record<string, string | undefined>> | undefined,
): {XDG_STATE_HOME: string; HARNESS_EDITOR_LOGS: string} {
  const state = launchEnvironment?.XDG_STATE_HOME ?? stateFolder;
  return {XDG_STATE_HOME: state, HARNESS_EDITOR_LOGS: state};
}

/** An entry of an extensions folder's `extensions.json`, as far as a stand-in's copy reads it. */
interface ExtensionEntry {
  identifier: {id: string};
  version: string;
  location: Record<string, unknown>;
  relativeLocation: string;
}

/** The version every stand-in has. */
const STAND_IN_VERSION = '0.0.0';

/**
 * Puts the stand-ins of a launch into its own extensions folder, after the run's installs: for each id, a folder with a
 * manifest only (no code, no contribution, nothing from the extension it stands for) and an entry in the folder's
 * `extensions.json`, copied from the first entry the editor's own install wrote, with the stand-in's identifier,
 * version and location. `engines` is the manifest's `engines.vscode`. The run's clean-up removes the run's folder, so
 * the stand-ins go with it.
 */
export function writeStandIns(
  runFolder: string,
  launch: Launch,
  engines: string,
): void {
  if (launch.kind !== 'plain' || launch.standIns === undefined) {
    return;
  }
  const folder = extensionsFolderOf(runFolder, launch);
  const listFile = path.join(folder, 'extensions.json');
  const entries = JSON.parse(
    readFileSync(listFile, 'utf8'),
  ) as ExtensionEntry[];
  const template = entries[0];
  if (template === undefined) {
    throw new Error(
      `${listFile} lists no extension to copy a stand-in's entry from`,
    );
  }
  for (const extensionId of launch.standIns) {
    const [publisher = '', name = ''] = extensionId.split('.');
    const relativeLocation = `${extensionId}-${STAND_IN_VERSION}`;
    const location = path.join(folder, relativeLocation);
    mkdirSync(location, {recursive: true});
    writeFileSync(
      path.join(location, 'package.json'),
      `${JSON.stringify(
        {
          publisher,
          name,
          version: STAND_IN_VERSION,
          engines: {vscode: engines},
          displayName: 'Acceptance stand-in (not the reference)',
        },
        null,
        2,
      )}\n`,
    );
    entries.push({
      ...template,
      identifier: {id: extensionId},
      version: STAND_IN_VERSION,
      // The editor's own fields of a file URI; its cached `fsPath` and `external` would name the copied entry's folder.
      location: {
        $mid: template.location.$mid,
        path: location,
        scheme: template.location.scheme,
      },
      relativeLocation,
    });
  }
  writeFileSync(listFile, JSON.stringify(entries));
}

/**
 * What every run's editor is started with: the launch's user-data and extensions folders and the run's shared-data
 * folder, the proposed API of the extensions unless a launch turns it off, workspace trust off unless a plain launch
 * turns it on, and no crash reports. A launch's own extensions bring their proposed API.
 */
export function editorArguments(
  runFolder: string,
  proposedApi = true,
  launch?: Launch,
): string[] {
  const ownExtensions =
    launch?.kind === 'plain' ? (launch.withExtensions ?? []) : [];
  return [
    `--user-data-dir=${userDataFolderOf(runFolder, launch)}`,
    // Core keeps trust decisions and the recent list in a folder of the user's home that every run would share.
    `--shared-data-dir=${path.join(runFolder, 'shared-data')}`,
    `--extensions-dir=${extensionsFolderOf(runFolder, launch)}`,
    ...(proposedApi
      ? [...PROPOSED_API_EXTENSIONS, ...ownExtensions].map(
          extensionId => `--enable-proposed-api=${extensionId}`,
        )
      : []),
    ...(launch?.kind === 'plain' && launch.workspaceTrust === true
      ? []
      : ['--disable-workspace-trust']),
    // VS Code reports crashes to its publisher when ~/.vscode/argv.json enables it, as its first run writes; the switch
    // wins over the file, which stays the user's own. VSCodium's build has no reporter and accepts the switch.
    '--disable-crash-reporter',
  ];
}

/** The file in which the editor of a launch, started with a debugging port of 0, writes the port it chose. */
export function debuggingPortFile(runFolder: string, launch: Launch): string {
  return path.join(userDataFolderOf(runFolder, launch), 'DevToolsActivePort');
}

/**
 * The script, record and log files of a launch: the run's own, or a failing connect's. `containersLogFile` is the log
 * of Dev Containers, for the launches that install it.
 */
export function launchFiles(
  runFolder: string,
  label: string,
): {
  script: string;
  record: string;
  logFile: string;
  containersLogFile: string;
} {
  return {
    script: path.join(runFolder, `${label}-script.json`),
    record: path.join(runFolder, `${label}-record.jsonl`),
    logFile: path.join(runFolder, `${label}-log.txt`),
    containersLogFile: path.join(runFolder, `${label}-containers-log.txt`),
  };
}

/**
 * Packages the window agent into a VSIX in the run's folder: its bundle and its manifest, with the repository and
 * licence fields `vsce` asks for. Returns the VSIX file.
 */
export async function packageWindowAgent(
  root: string,
  runFolder: string,
): Promise<string> {
  const source = path.join(root, 'tests', 'acceptance', 'window-agent');
  const folder = path.join(runFolder, 'window-agent');
  mkdirSync(folder, {recursive: true});
  await build({
    entryPoints: [path.join(source, 'src', 'extension.ts')],
    outfile: path.join(folder, 'extension.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['vscode'],
    logLevel: 'warning',
  });
  const manifest = JSON.parse(
    readFileSync(path.join(source, 'package.json'), 'utf8'),
  ) as Record<string, unknown>;
  delete manifest.private;
  writeFileSync(
    path.join(folder, 'package.json'),
    JSON.stringify(
      {
        ...manifest,
        license: 'MIT',
        repository: {type: 'git', url: 'https://example.invalid/agent.git'},
      },
      null,
      2,
    ),
  );
  writeFileSync(path.join(folder, 'LICENSE'), 'MIT\n');
  const vsix = path.join(runFolder, 'window-agent.vsix');
  const result = spawnSync(
    process.execPath,
    [
      resolveBinary('@vscode/vsce/vsce'),
      'package',
      '--no-dependencies',
      '--skip-license',
      '--allow-missing-repository',
      '--out',
      vsix,
    ],
    {cwd: folder, encoding: 'utf8'},
  );
  if (result.status !== 0) {
    throw new Error(
      `vsce package of the window agent failed: ${result.stderr.trim()}`,
    );
  }
  return vsix;
}

/** A program to start: its file, its arguments and its environment. */
export interface Program {
  file: string;
  programArguments: string[];
  environment: Record<string, string | undefined>;
}

/** The editor of a launch with no runner: the window it opens first, if it has a folder, and the run's folders. */
export function plainEditorOf(
  executable: string,
  runFolder: string,
  launch: Launch,
  environment: Readonly<Record<string, string | undefined>>,
): Program {
  return {
    file: executable,
    programArguments: [
      ...editorArguments(runFolder, launch.proposedApi !== false, launch),
      ...(launch.kind === 'plain' && launch.debuggingPort === true
        ? ['--remote-debugging-port=0']
        : []),
      ...(launch.kind === 'plain' ? (launch.disabledExtensions ?? []) : []).map(
        extensionId => `--disable-extension=${extensionId}`,
      ),
      '--new-window',
      ...(launch.folderUri === undefined
        ? []
        : ['--folder-uri', launch.folderUri]),
    ],
    // The harness may itself run under an extension host, where the editor's program is a plain Node.js.
    environment: {...environment, ELECTRON_RUN_AS_NODE: undefined},
  };
}

/** The Node mocha run of a launch with no runner: the test files of its suite folder, without the repository's config. */
export function plainTestsOf(
  root: string,
  launch: Launch,
  environment: Readonly<Record<string, string | undefined>>,
): Program {
  return {
    file: process.execPath,
    programArguments: [
      resolveBinary('mocha/bin/mocha.js'),
      '--no-config',
      '--extension',
      'ts',
      '--spec',
      path.join(root, 'tests', 'acceptance', launch.suite, '*.test.ts'),
    ],
    environment: {...environment},
  };
}

/** A started program that can be stopped, with everything it started. */
export interface Started {
  /** Ends the program and its group; resolves once none of the group is left, so the next program never meets it. */
  stop(): Promise<void>;
}

/** How long a stopped program has to end, in milliseconds: after SIGTERM, then after SIGKILL, and how often it's looked at. */
export interface StopTiming {
  graceMilliseconds: number;
  afterKillMilliseconds: number;
  pollMilliseconds: number;
  /** Whether any process of a group is left; a zombie its parent never reaped counts. */
  groupAlive(groupId: number): boolean;
}

/**
 * The editor's own shutdown takes seconds on a loaded machine; one still shutting down holds the user-data folder's
 * main socket, and the next editor on that folder would wait on it forever.
 */
const STOP_TIMING: StopTiming = {
  graceMilliseconds: 10_000,
  afterKillMilliseconds: 5000,
  pollMilliseconds: 100,
  groupAlive: groupId => {
    try {
      process.kill(-groupId, 0);
      return true;
    } catch {
      return false;
    }
  },
};

/** Sends `signal` to the process, or with `group` to its whole group, if it is still there. */
function signal(processId: number, name: NodeJS.Signals, group: boolean): void {
  try {
    process.kill(group ? -processId : processId, name);
  } catch {
    // It is already gone.
  }
}

/** Waits until `done` holds or `milliseconds` have passed; whether `done` held. */
async function waitUntil(
  done: () => boolean,
  milliseconds: number,
  pollMilliseconds: number,
): Promise<boolean> {
  const deadline = Date.now() + milliseconds;
  while (!done()) {
    if (Date.now() >= deadline) {
      return false;
    }
    await new Promise(resolve => setTimeout(resolve, pollMilliseconds));
  }
  return true;
}

/** Starts a program detached, in a group of its own, so that stopping it stops the processes it started too. */
export function startDetached(
  program: Program,
  timing: StopTiming = STOP_TIMING,
): Started {
  // The editor's state folder exists before it starts.
  const logsFolder = program.environment.HARNESS_EDITOR_LOGS;
  if (logsFolder !== undefined) {
    mkdirSync(logsFolder, {recursive: true});
  }
  const child = spawn(program.file, program.programArguments, {
    env: program.environment,
    detached: true,
    stdio: 'ignore',
  });
  let exited = false;
  child.on('exit', () => {
    exited = true;
  });
  // A program that cannot start has no process group to stop; the error must not end the harness unhandled.
  child.on('error', () => {
    exited = true;
  });
  child.unref();
  return {
    stop: async () => {
      const groupId = child.pid;
      if (groupId === undefined) {
        return;
      }
      // The program first, alone: an editor whose GPU and zygote processes go down with it aborts instead of quitting,
      // and leaves its main socket behind. Its group follows it when it quits.
      signal(groupId, 'SIGTERM', false);
      const group: number = groupId;
      function ended(): boolean {
        return exited && !timing.groupAlive(group);
      }
      if (
        await waitUntil(
          ended,
          timing.graceMilliseconds,
          timing.pollMilliseconds,
        )
      ) {
        return;
      }
      signal(groupId, 'SIGKILL', true);
      if (
        !(await waitUntil(
          ended,
          timing.afterKillMilliseconds,
          timing.pollMilliseconds,
        ))
      ) {
        // Zombies nobody reaps keep a group alive for ever; a later editor is safe from them, so the run goes on.
        console.error(
          `acceptance: the process group ${String(groupId)} of ${program.file} was still there after SIGKILL`,
        );
      }
    },
  };
}

/** The folder whose files carry a row's request to relaunch the editor and the harness's answer. */
function relaunchFolderOf(runFolder: string, label: string): string {
  return path.join(runFolder, label, 'relaunch');
}

/** A row's request: restart the editor with `environment` added to the launch's own. */
export interface RelaunchRequest {
  id: string;
  /** The variables to set; a `null` removes the launch's own. */
  environment: Record<string, string | null>;
}

/** The harness's answer to a request. */
interface RelaunchAnswer {
  id: string;
  succeeded: boolean;
  /** The name of the launch's own window, which the restarted editor opens first and a row opens its target from. */
  own: string;
  message?: string;
}

/** What restarting the editor needs besides the start: the launch's own window, how many times a window activated, and the wait's bounds. */
export interface RelaunchSteps {
  start: (program: Program) => Started;
  ownWindow: string;
  activations: (name: string) => number;
  activationMilliseconds: number;
  pollMilliseconds: number;
}

/**
 * Answers the request in `folder` when there is a new one: stops the editor in `current`, starts the program the
 * request makes of the launch's, and waits until the window the request names activates again. Whatever happens, the
 * answer is written for the row.
 */
export async function answerRelaunch(
  folder: string,
  current: {editor: Started},
  programOf: (request: RelaunchRequest) => Program,
  steps: RelaunchSteps,
  handled: Set<string>,
): Promise<void> {
  const file = path.join(folder, 'request.json');
  if (!existsSync(file)) {
    return;
  }
  let request: RelaunchRequest;
  try {
    request = JSON.parse(readFileSync(file, 'utf8')) as RelaunchRequest;
  } catch {
    return;
  }
  if (handled.has(request.id)) {
    return;
  }
  handled.add(request.id);
  const answer: RelaunchAnswer = {
    id: request.id,
    succeeded: true,
    own: steps.ownWindow,
  };
  try {
    const before = steps.activations(steps.ownWindow);
    await current.editor.stop();
    current.editor = steps.start(programOf(request));
    const activated = await waitUntil(
      () => steps.activations(steps.ownWindow) > before,
      steps.activationMilliseconds,
      steps.pollMilliseconds,
    );
    if (!activated) {
      answer.succeeded = false;
      answer.message = `window ${steps.ownWindow} did not activate within ${String(steps.activationMilliseconds)} ms`;
    }
  } catch (caught) {
    answer.succeeded = false;
    answer.message = String(caught);
  }
  writeFileSync(path.join(folder, 'response.json'), JSON.stringify(answer));
}

/** How many times the agent of window `name` reported `activated`, from its events file in `agentFolder`. */
export function activationsIn(agentFolder: string, name: string): number {
  const file = path.join(agentFolder, `${name}.events.jsonl`);
  return existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter(line => line.includes('"event":"activated"')).length
    : 0;
}

/** What a plain launch needs of the run: its folder, the editor's program, and the variables its processes share. */
export interface PlainRun {
  runFolder: string;
  executable: string;
  environment: Readonly<Record<string, string | undefined>>;
}

/** What starting the editor and running the tests are, replaced by a test. */
export interface PlainSteps {
  start: (program: Program) => Started;
  runTests: (program: Program) => Promise<{exitCode: number; output: string}>;
  /** How many times window `name` of the launch activated its agent; the files of its agent folder by default. */
  activations?: (name: string) => number;
}

/** The name the window agent gives the window the launch's own arguments open first: its folder's name, or `local` for none. */
function ownWindowOf(launch: Launch): string {
  return windowNameOf(
    launch.folderUri === undefined
      ? undefined
      : new URL(launch.folderUri).pathname,
  );
}

/** How long a relaunched editor has to activate its window again, in milliseconds. */
const RELAUNCH_ACTIVATION_MILLISECONDS = 120_000;

/**
 * Runs a launch with no runner: starts the editor, runs the Node tests against it, and stops the editor whatever the
 * tests' outcome. The launch has a script, record and log of its own.
 */
export async function runPlainLaunch(
  root: string,
  session: PlainRun,
  launch: Launch,
  steps: PlainSteps,
): Promise<{exitCode: number; output: string}> {
  const files = launchFiles(session.runFolder, launch.label);
  const launchEnvironment = withRunTokens(
    withHarnessBases(launch.environment, session.environment),
    session.runFolder,
    session.environment.PATH ?? '',
  );
  const logs = editorLogsEnvironment(
    stateFolderOf(session.runFolder, launch.label),
    launchEnvironment,
  );
  const environment = {
    ...session.environment,
    ...logs,
    REMOTE_OSS_ACCEPTANCE_SCRIPT: files.script,
    REMOTE_OSS_ACCEPTANCE_RECORD: files.record,
    REMOTE_OSS_ACCEPTANCE_LOG: files.logFile,
    ...(needsDevContainerImage(launch)
      ? {REMOTE_OSS_ACCEPTANCE_CONTAINERS_LOG: files.containersLogFile}
      : {}),
    REMOTE_OSS_ACCEPTANCE_WINDOWS: path.join(
      session.runFolder,
      launch.label,
      'agent',
      'pids',
    ),
    REMOTE_OSS_ACCEPTANCE_SIGNALS: path.join(session.runFolder, 'signals'),
    HARNESS_EDITOR_EXECUTABLE: session.executable,
    ...(launch.kind === 'plain' &&
    launch.client === 'vscode' &&
    session.environment.HARNESS_GENUINE_VERSION !== undefined
      ? {HARNESS_EDITOR_VERSION: session.environment.HARNESS_GENUINE_VERSION}
      : {}),
    HARNESS_USER_DATA: userDataFolderOf(session.runFolder, launch),
    REMOTE_OSS_ACCEPTANCE_RELAUNCH: relaunchFolderOf(
      session.runFolder,
      launch.label,
    ),
    ...launchEnvironment,
  };
  // A port file an earlier attempt left would name a port nobody listens on.
  rmSync(debuggingPortFile(session.runFolder, launch), {force: true});
  const relaunchFolder = relaunchFolderOf(session.runFolder, launch.label);
  // A request an earlier attempt left would restart the editor for a row that is gone; the row makes the folder.
  rmSync(relaunchFolder, {recursive: true, force: true});
  const current = {
    editor: steps.start(
      plainEditorOf(session.executable, session.runFolder, launch, environment),
    ),
  };
  const agentFolder = path.join(session.runFolder, launch.label, 'agent');
  const handled = new Set<string>();
  let answering: Promise<void> | undefined;
  const watching = setInterval(() => {
    if (answering !== undefined) {
      return;
    }
    answering = answerRelaunch(
      relaunchFolder,
      current,
      request => {
        rmSync(debuggingPortFile(session.runFolder, launch), {force: true});
        // The names the stopped editor's windows claimed are free again: its empty window is `local` once more.
        rmSync(path.join(agentFolder, 'claims'), {
          recursive: true,
          force: true,
        });
        return plainEditorOf(session.executable, session.runFolder, launch, {
          ...environment,
          ...Object.fromEntries(
            Object.entries(request.environment).map(([key, value]) => [
              key,
              value ?? undefined,
            ]),
          ),
        });
      },
      {
        start: steps.start,
        ownWindow: ownWindowOf(launch),
        activations:
          steps.activations ?? (name => activationsIn(agentFolder, name)),
        activationMilliseconds: RELAUNCH_ACTIVATION_MILLISECONDS,
        pollMilliseconds: 200,
      },
      handled,
    ).finally(() => {
      answering = undefined;
    });
  }, 200);
  try {
    return await steps.runTests(plainTestsOf(root, launch, environment));
  } finally {
    clearInterval(watching);
    // A relaunch still being answered owns the editor until it has started the next one.
    await answering;
    await current.editor.stop();
  }
}
