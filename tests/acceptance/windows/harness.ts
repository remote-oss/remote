/**
 * @fileoverview The Node side of the multi-window launch: the helpers with which a test drives the windows of a plainly
 * started editor through the window agent, and observes them from the agent's events, the record and the host. It
 * also writes the script the launch's scripted adapters answer from, so a test may append entries, hold one
 * behind a signal, and read back what was held and what the host accepted.
 */

import {execFile} from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {processIdsOf} from '../../../tools/process-ids.ts';
import {
  appendScriptTo,
  signalFile,
  type AppendedEntry,
} from '../../../tools/script-file.ts';

const execFileAsync = promisify(execFile);

/** How long a wait for a window lasts, in milliseconds. */
const WAIT_MILLISECONDS = 60_000;

/** What a window's agent reports: an event with the time it happened, and the command it concerns. */
export interface AgentEvent {
  event:
    | 'activated'
    | 'deactivated'
    | 'accepted'
    | 'done'
    | 'failed'
    | 'state'
    | 'setting'
    | 'forwarded'
    | 'commands'
    | 'extension';
  time: number;
  id?: string;
  message?: string;
  remoteName?: string | null;
  remoteAuthority?: string | null;
  folders?: string[];
  /** Whether the window's workspace is trusted, as `state` reports it. */
  trusted?: boolean;
  /** The setting a `setting` event reports, and its value. */
  settingId?: string;
  value?: unknown;
  /** Where a forwarded port is reachable on this machine, as the editor gave it. */
  localAddress?: string | {host: string; port: number};
  remotePort?: number;
  /** The prefix a `commands` event was asked for, and the registered command ids that start with it, sorted. */
  prefix?: string;
  commandIds?: string[];
  /** The extension an `extension` event was asked about, and whether the window's editor has it. */
  extensionId?: string;
  present?: boolean;
  /** The output channel a `state` event saw shown in the window, or null. */
  visibleOutputChannel?: string | null;
}

/** One line of the record the extensions append to. */
export interface RecordLine {
  surface: string;
  question: string;
  /** The answer given: `'held'` on the waiting line of a held entry, `'withdrawn'` when its question ended while it waited. */
  answer: string;
  matched: boolean;
  /** The waiting line of a held entry: the answer or withdrawal line that follows it counts for the cursor, not this one. */
  held?: boolean;
  window: string;
  /** The labels a failure dialog or a notice was shown with, in order. */
  buttons?: string[];
  /** The labels the pick was shown with, in order; only the lines of a `hostPick` or a `filePick` surface have it. */
  items?: string[];
  time: number;
}

/** A question the scripted adapters of the launch's windows answer from the script, in the order the windows ask them. */
export interface WindowScriptEntry {
  surface: 'hostPick' | 'filePick';
  match: string;
  answer: {label: string} | {typed: string} | 'dismiss';
  /** The window that answers; an entry without one is answered by every window. */
  window?: string;
}

/** A harness variable of the run; throws when the tests run outside the harness. */
export function variable(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(
      `${name} is not set; run the tests with pnpm test:acceptance:vscodium`,
    );
  }
  return value;
}

/** The lines of a JSON-lines file; a file not written yet is empty. */
function linesOf<Line>(file: string): Line[] {
  return existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter(line => line !== '')
        .map(line => JSON.parse(line) as Line)
    : [];
}

/** The launch's agent folder: the one the launch's variable points its pid files to. */
function agentFolder(): string {
  return path.dirname(variable('REMOTE_OSS_ACCEPTANCE_WINDOWS'));
}

/** A file of a window's agent in the launch's folder: its `events` or its `commands`. */
function agentFile(name: string, kind: 'events' | 'commands'): string {
  return path.join(agentFolder(), `${name}.${kind}.jsonl`);
}

/** The names of the windows whose agent has reported anything, in no particular order. */
export function windowNames(): string[] {
  const folder = agentFolder();
  return (existsSync(folder) ? readdirSync(folder) : [])
    .filter(file => file.endsWith('.events.jsonl'))
    .map(file => file.slice(0, -'.events.jsonl'.length));
}

/** The events the agent of window `name` has reported, in order. */
export function windowEvents(name: string): AgentEvent[] {
  return linesOf<AgentEvent>(agentFile(name, 'events'));
}

/**
 * Writes the launch's script with `entries`, which the extensions read when they activate: a window that opens after
 * the write answers its questions from it. A window that activated before the write keeps the entries it read, so an
 * entry names the window it prepares for.
 */
export function scriptEntries(entries: readonly WindowScriptEntry[]): void {
  writeFileSync(
    variable('REMOTE_OSS_ACCEPTANCE_SCRIPT'),
    JSON.stringify({entries}),
  );
}

/** The lines of the record, optionally of one surface and one window. */
export function recordLines(surface?: string, window?: string): RecordLine[] {
  return linesOf<RecordLine>(variable('REMOTE_OSS_ACCEPTANCE_RECORD')).filter(
    line =>
      (surface === undefined || line.surface === surface) &&
      (window === undefined || line.window === window),
  );
}

/** The lines of the log the launch's extensions write, without their time stamps. */
export function connectionLog(): string[] {
  return readFileSync(variable('REMOTE_OSS_ACCEPTANCE_LOG'), 'utf8')
    .split('\n')
    .filter(line => line !== '')
    .map(line => line.slice(line.indexOf('] ') + 2));
}

/** The waiting lines of the record, optionally of one window: a held entry's line while it waits for its signal. */
export function heldLines(window?: string): RecordLine[] {
  return recordLines(undefined, window).filter(line => line.held === true);
}

/** The output of a command run in the host container as `user`. */
export async function onHostAs(
  user: string,
  ...command: string[]
): Promise<string> {
  const {stdout} = await execFileAsync('docker', [
    'exec',
    '--user',
    user,
    variable('HARNESS_CONTAINER'),
    ...command,
  ]);
  return stdout;
}

/** The output of a command run in the host container as the user harness. */
export function onHost(...command: string[]): Promise<string> {
  return onHostAs('harness', ...command);
}

/** The bare password of the host's user `harness-pw`, from the run's file. */
export function hostPassword(): string {
  return readFileSync(variable('HARNESS_PASSWORD_FILE'), 'utf8');
}

/**
 * Creates the run's signal file `<signals>/<name>`: a held entry that names it answers from then on. The name is
 * letters, digits and hyphens, never the reserved one.
 */
export function signal(name: string): void {
  signalFile(variable('REMOTE_OSS_ACCEPTANCE_SIGNALS'), name);
}

/**
 * Adds `entries` to the launch's script, atomically: the adapters read it at every question, so they count from the
 * next question on.
 */
export function appendScript(entries: readonly AppendedEntry[]): void {
  appendScriptTo(variable('REMOTE_OSS_ACCEPTANCE_SCRIPT'), entries);
}

/**
 * The number of the container's log lines that contain `line`: sshd runs with `-e`, so its log is the container's
 * stderr, and both streams are read.
 */
async function acceptedLogins(line: string): Promise<number> {
  const {stdout, stderr} = await execFileAsync(
    'docker',
    ['logs', variable('HARNESS_CONTAINER')],
    {encoding: 'utf8'},
  );
  return `${stdout}\n${stderr}`.split('\n').filter(each => each.includes(line))
    .length;
}

/** The number of logins the host's sshd counted for the password account. */
export function acceptedPasswords(): Promise<number> {
  return acceptedLogins('Accepted password for harness-pw');
}

/** Polls until `ready` holds, for up to a minute; it fails naming what it waited for. */
async function waitUntil(
  description: string | (() => string),
  ready: () => boolean,
): Promise<void> {
  const deadline = Date.now() + WAIT_MILLISECONDS;
  while (!ready()) {
    if (Date.now() > deadline) {
      throw new Error(
        `timed out waiting for ${typeof description === 'string' ? description : description()}`,
      );
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}

/** The number of events of one kind window `name` has reported. */
function countOf(name: string, event: AgentEvent['event']): number {
  return windowEvents(name).filter(each => each.event === event).length;
}

/** Writes a command for window `name` as one append, and returns its id. */
function send(name: string, command: string, parameters: unknown[]): string {
  const commandId = `${String(Date.now())}-${Math.random().toString(36).slice(2)}`;
  mkdirSync(path.dirname(agentFile(name, 'commands')), {recursive: true});
  appendFileSync(
    agentFile(name, 'commands'),
    `${JSON.stringify({id: commandId, command, parameters})}\n`,
  );
  return commandId;
}

/** Has window `name` run a command; resolves on `done` and fails, naming the window and the command, on `failed`. */
export async function inWindow(
  name: string,
  command: string,
  ...parameters: unknown[]
): Promise<void> {
  // The agent skips the commands written before it activated, so a command waits for the window's agent.
  await waitUntil(`window ${name} to activate its agent`, () =>
    windowEvents(name).some(each => each.event === 'activated'),
  );
  const commandId = send(name, command, parameters);
  function concerning(): AgentEvent[] {
    return windowEvents(name).filter(each => each.id === commandId);
  }
  await waitUntil(
    () =>
      `window ${name} to finish ${command} (events: ${JSON.stringify(windowEvents(name))})`,
    () => concerning().some(each => each.event !== 'accepted'),
  );
  const failed = concerning().find(each => each.event === 'failed');
  if (failed !== undefined) {
    throw new Error(
      `window ${name} failed ${command}: ${failed.message ?? 'no message'}`,
    );
  }
}

/** Opens window `folder` (a folder of the user harness's home, made first) on `alias`, from the local window. */
export async function openWindow(alias: string, folder: string): Promise<void> {
  const home = `/home/harness/${folder}`;
  await onHost('mkdir', '-p', home);
  await inWindow(
    'local',
    'acceptance.agent.openWindow',
    `vscode-remote://ssh-remote+${alias}${home}`,
  );
  await waitUntil(`window ${folder} to activate its agent`, () =>
    windowEvents(folder).some(each => each.event === 'activated'),
  );
}

/** The names of the empty windows that have an events file, in the order of their numbers. */
export function emptyWindows(): string[] {
  const folder = agentFolder();
  const files = existsSync(folder) ? readdirSync(folder) : [];
  const numbers: number[] = [];
  for (const file of files) {
    const match = /^empty-(\d+)\.events\.jsonl$/.exec(file);
    if (match !== null) {
      const digits = match[1];
      if (digits !== undefined) {
        numbers.push(Number(digits));
      }
    }
  }
  return numbers
    .sort((first, second) => first - second)
    .map(number => `empty-${String(number)}`);
}

/**
 * The name the next empty window will claim: `empty-1` when none is claimed yet, and one more than the highest
 * claimed when some are. A test that must script a window before it exists writes its entries for this name.
 */
export function nextEmptyName(): string {
  const folder = path.join(agentFolder(), 'claims');
  const files = existsSync(folder) ? readdirSync(folder) : [];
  let highest = 0;
  for (const file of files) {
    const match = /^empty-(\d+)$/.exec(file);
    if (match !== null) {
      const digits = match[1];
      if (digits !== undefined && Number(digits) > highest) {
        highest = Number(digits);
      }
    }
  }
  return `empty-${String(highest + 1)}`;
}

/**
 * Runs `action` and resolves with the one empty window it opens, once that window's agent has activated. Fails when
 * the action opens no empty window within the bound, and names the windows when it opens more than one.
 */
export async function nextEmptyWindow(
  action: () => void | Promise<void>,
): Promise<string> {
  const before = new Set(emptyWindows());
  await action();
  function fresh(): string[] {
    return emptyWindows().filter(name => !before.has(name));
  }
  let opened: string | undefined;
  await waitUntil(
    () =>
      `exactly one new empty window (new names: ${JSON.stringify(fresh())})`,
    () => {
      const names = fresh();
      if (names.length > 1) {
        throw new Error(
          `the action opened more than one empty window: ${names.join(', ')}`,
        );
      }
      const name = names.length === 1 ? names[0] : undefined;
      if (
        name !== undefined &&
        windowEvents(name).some(each => each.event === 'activated')
      ) {
        opened = name;
        return true;
      }
      return false;
    },
  );
  if (opened === undefined) {
    throw new Error('the action opened no empty window');
  }
  return opened;
}

/**
 * The order in which the window's name reached its adapters, for the run's record: the milliseconds between the
 * writing of the window's pid file and the window's first record line, negative when the file was already there, so
 * a negative number means the adapters' wait did not fire.
 */
export function windowNameOrder(name: string): string {
  const pids = variable('REMOTE_OSS_ACCEPTANCE_WINDOWS');
  let written: number | undefined;
  for (const file of readdirSync(pids)) {
    const read = readFileSync(path.join(pids, file), 'utf8');
    if (read === name) {
      const mtime = statSync(path.join(pids, file)).mtimeMs;
      written = written === undefined ? mtime : Math.max(written, mtime);
    }
  }
  const first = recordLines(undefined, name)[0];
  if (written === undefined || first === undefined) {
    return `the pid file or the first record line of window ${name} is missing`;
  }
  const delta = written - first.time;
  return delta < 0
    ? `the pid file is ${String(Math.round(-delta))} ms before the window's first record line`
    : `the pid file is ${String(Math.round(delta))} ms after the window's first record line; the adapters waited`;
}

/**
 * Reloads window `name` and resolves on its next `activated`. The reload command's own `failed` is ignored: the
 * extension host may end before it can answer.
 */
export async function reloadWindow(name: string): Promise<void> {
  const before = countOf(name, 'activated');
  send(name, 'workbench.action.reloadWindow', []);
  await waitUntil(
    `window ${name} to activate again`,
    () => countOf(name, 'activated') > before,
  );
}

/** Closes window `name` and resolves once its agent has deactivated. */
export async function closeWindow(name: string): Promise<void> {
  const before = countOf(name, 'deactivated');
  send(name, 'workbench.action.closeWindow', []);
  await waitUntil(
    `window ${name} to deactivate`,
    () => countOf(name, 'deactivated') > before,
  );
}

/** Has window `name` run the agent's `command`, which reports one `event`, and gives that report. */
async function reported(
  name: string,
  event: AgentEvent['event'],
  command: string,
  ...parameters: unknown[]
): Promise<AgentEvent | undefined> {
  const before = countOf(name, event);
  await inWindow(name, command, ...parameters);
  await waitUntil(
    `window ${name} to report its ${event}`,
    () => countOf(name, event) > before,
  );
  return windowEvents(name)
    .filter(each => each.event === event)
    .at(-1);
}

/** Has window `name` report its state once, and gives that report. */
function reportedState(name: string): Promise<AgentEvent | undefined> {
  return reported(name, 'state', 'acceptance.agent.state');
}

/** The commands window `name` has registered whose ids start with `prefix`, sorted. */
export async function commandsOf(
  name: string,
  prefix: string,
): Promise<string[]> {
  return (
    (await reported(name, 'commands', 'acceptance.agent.commands', prefix))
      ?.commandIds ?? []
  );
}

/** Whether window `name`'s editor has the extension `extensionId`, enabled or not. */
export async function extensionPresent(
  name: string,
  extensionId: string,
): Promise<boolean> {
  return (
    (
      await reported(
        name,
        'extension',
        'acceptance.agent.extensionPresent',
        extensionId,
      )
    )?.present === true
  );
}

/**
 * What window `name` reports of itself: the remote it is on, the authority it is on and its folders. A remote
 * window's authority is written by its own extension when it resolves, which may lag the window's agent, so a
 * remote window's state is re-asked until the authority is there; a local window reports once.
 */
export async function windowState(name: string): Promise<{
  remoteName: string | null;
  remoteAuthority: string | null;
  folders: string[];
}> {
  const deadline = Date.now() + WAIT_MILLISECONDS;
  for (;;) {
    const last = await reportedState(name);
    const state = {
      remoteName: last?.remoteName ?? null,
      remoteAuthority: last?.remoteAuthority ?? null,
      folders: last?.folders ?? [],
    };
    if (
      state.remoteName === null ||
      state.remoteAuthority !== null ||
      Date.now() > deadline
    ) {
      return state;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}

/** Whether window `name`'s workspace is trusted, as it reports now; it does not wait for the window's connect. */
export async function isTrusted(name: string): Promise<boolean | undefined> {
  return (await reportedState(name))?.trusted;
}

/** Polls until window `name` reports the trust `wanted`, for up to 10 s, and gives what the window last reported. */
export async function trustSettled(
  name: string,
  wanted: boolean,
): Promise<boolean | undefined> {
  const deadline = Date.now() + 10_000;
  let trusted = await isTrusted(name);
  while (trusted !== wanted && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 500));
    trusted = await isTrusted(name);
  }
  return trusted;
}

/** The output of `program` run with the run's agent, or its exit status when it fails. */
async function withAgent(
  program: string,
  programArguments: readonly string[],
): Promise<{status: number; stdout: string}> {
  try {
    const {stdout} = await execFileAsync(program, [...programArguments], {
      env: {
        ...process.env,
        SSH_AUTH_SOCK: variable('HARNESS_AGENT_SOCKET'),
        SSH_ASKPASS: path.join(
          variable('HARNESS_RUN_FOLDER'),
          'askpass-passphrase',
        ),
        SSH_ASKPASS_REQUIRE: 'force',
        DISPLAY: '',
      },
    });
    return {status: 0, stdout};
  } catch (caught) {
    const failure = caught as {code?: unknown; stdout?: unknown};
    return {
      status: typeof failure.code === 'number' ? failure.code : -1,
      stdout: typeof failure.stdout === 'string' ? failure.stdout : '',
    };
  }
}

/** The SHA256 fingerprint of a key file, as `ssh-keygen -l` and `ssh-add -l` print it. */
export async function fingerprintOf(file: string): Promise<string> {
  const {stdout} = await execFileAsync('ssh-keygen', ['-l', '-f', file]);
  return stdout.split(' ')[1] ?? '';
}

/** Makes a new ed25519 key pair without a passphrase at `file` and `file.pub`. */
export async function newKeyPair(file: string): Promise<void> {
  await execFileAsync('ssh-keygen', [
    '-q',
    '-t',
    'ed25519',
    '-N',
    '',
    '-f',
    file,
  ]);
}

/** The fingerprints of the keys the run's agent holds; none when it holds none. */
export async function agentKeys(): Promise<string[]> {
  const listed = await withAgent('ssh-add', ['-l']);
  return listed.status === 0
    ? listed.stdout
        .split('\n')
        .filter(line => line !== '')
        .map(line => line.split(' ')[1] ?? '')
    : [];
}

/**
 * Adds a key file to the run's agent, with the confirm constraint when asked; a passphrase key's passphrase comes from
 * `HARNESS_PASSPHRASE_FILE` through the run's askpass script. Fails naming the file when ssh-add does.
 */
export async function agentAdd(
  file: string,
  options: {confirm: boolean},
): Promise<void> {
  const added = await withAgent('ssh-add', [
    ...(options.confirm ? ['-c'] : []),
    file,
  ]);
  if (added.status !== 0) {
    throw new Error(
      `ssh-add ${file} failed with status ${String(added.status)}`,
    );
  }
}

/** Removes every key from the run's agent. */
export async function agentClear(): Promise<void> {
  await withAgent('ssh-add', ['-D']);
}

/** The process ids of the connection helpers of this run's extensions folder. */
export async function connectionHelpers(): Promise<number[]> {
  try {
    const {stdout} = await execFileAsync('pgrep', [
      '-f',
      `${variable('HARNESS_RUN_FOLDER')}/extensions/.*connection-helper`,
    ]);
    return processIdsOf(stdout);
  } catch {
    return [];
  }
}

/** The ids of the `ssh` processes whose parent is `helperId`. */
export async function sshChildren(helperId: number): Promise<number[]> {
  try {
    const {stdout} = await execFileAsync('pgrep', [
      '-P',
      String(helperId),
      '-x',
      'ssh',
    ]);
    return processIdsOf(stdout);
  } catch {
    return [];
  }
}

/** Polls `check` every 100 ms until it holds; it fails naming `description` after `milliseconds`. */
export async function waitFor(
  description: string,
  check: () => boolean | Promise<boolean>,
  milliseconds: number,
): Promise<void> {
  const deadline = Date.now() + milliseconds;
  while (!(await check())) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${description}`);
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

/** Has window `name` run Kill Local Connection Server For Host..., whose host pick is already in the script. */
export function kill(name: string): Promise<void> {
  return inWindow(name, 'opensshremotes.cleanLocalServer');
}

/** The run's user settings file. */
function userSettingsFile(): string {
  return path.join(
    variable('HARNESS_RUN_FOLDER'),
    'user-data/User/settings.json',
  );
}

/** The bytes of the run's user settings file, or nothing when it has none. */
export function readUserSettings(): string | undefined {
  const file = userSettingsFile();
  return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
}

/** Puts the run's user settings file back to the bytes `readUserSettings` gave, or removes it when it had none. */
export function restoreUserSettings(bytes: string | undefined): void {
  if (bytes === undefined) {
    rmSync(userSettingsFile(), {force: true});
  } else {
    writeFileSync(userSettingsFile(), bytes);
  }
}

/** Rewrites the run's user settings with `change` applied to them, which the editor picks up; then waits 1 s. */
export async function userSettings(
  change: Readonly<Record<string, unknown>>,
): Promise<void> {
  const file = userSettingsFile();
  const current = existsSync(file)
    ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>)
    : {};
  writeFileSync(file, JSON.stringify({...current, ...change}, null, 2));
  await new Promise(resolve => setTimeout(resolve, 1000));
}

/** The value window `name` reads for the setting `settingId`, or null when it reads none. */
export async function settingIn(
  name: string,
  settingId: string,
): Promise<unknown> {
  const before = countOf(name, 'setting');
  await inWindow(name, 'acceptance.agent.setting', settingId);
  await waitUntil(
    `window ${name} to report ${settingId}`,
    () => countOf(name, 'setting') > before,
  );
  return windowEvents(name)
    .filter(each => each.event === 'setting' && each.settingId === settingId)
    .at(-1)?.value;
}

/** The surfaces of the record that are messages to the user. */
const MESSAGE_SURFACES = ['notice', 'failureDialog', 'pick', 'maskedInput'];

/** The `Host` names of the run's ssh_config with no `*`, `?` or `!`, in file order. */
export function hostAliases(): string[] {
  return readFileSync(variable('HARNESS_SSH_CONFIG'), 'utf8')
    .split('\n')
    .filter(line => /^\s*Host\s/i.test(line))
    .flatMap(line => line.trim().split(/\s+/).slice(1))
    .filter(word => !/[*?!]/.test(word));
}

/** Whether window `name` is open: its agent activated more often than it deactivated. */
export function isOpen(name: string): boolean {
  const events = windowEvents(name).map(each => each.event);
  return (
    events.filter(event => event === 'activated').length >
    events.filter(event => event === 'deactivated').length
  );
}

/** The messages the record gained since `mark` lines: the lines of the surfaces that speak to the user. */
export function messagesSince(mark: number): string[] {
  return recordLines()
    .slice(mark)
    .filter(line => MESSAGE_SURFACES.includes(line.surface))
    .map(line => `${line.window}: ${line.surface}: ${line.question}`);
}

/** Whether window `name` is connected: it is on the remote and a file it writes reaches the host. */
export async function connected(name: string): Promise<boolean> {
  try {
    const state = await windowState(name);
    await inWindow(name, 'acceptance.agent.writeFile', 'probe.txt', name);
    return (
      state.remoteName === 'ssh-remote' &&
      (await onHost('cat', `/home/harness/${name}/probe.txt`)) === name
    );
  } catch {
    return false;
  }
}

/** Waits until window `name` is connected, for up to `milliseconds`. */
export function connectedWithin(
  name: string,
  milliseconds: number,
): Promise<void> {
  return waitFor(
    `${name} to be connected`,
    () => connected(name),
    milliseconds,
  );
}

/** Waits until no connection helper of the run runs, for up to `milliseconds`. */
export function noHelperWithin(milliseconds: number): Promise<void> {
  return waitFor(
    'no connection helper to run',
    async () => (await connectionHelpers()).length === 0,
    milliseconds,
  );
}

/** Whether the process `processId` runs. */
export function runs(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

/** Waits until none of `processIds` runs, for up to `milliseconds`. */
export function goneWithin(
  processIds: readonly number[],
  milliseconds: number,
): Promise<void> {
  return waitFor(
    `${processIds.join(', ')} to end`,
    () => processIds.every(processId => !runs(processId)),
    milliseconds,
  );
}

/** Waits until a connection helper other than those in `known` runs, for up to `milliseconds`. */
export function newHelperWithin(
  known: readonly number[],
  milliseconds: number,
): Promise<void> {
  return waitFor(
    'a new connection helper',
    async () =>
      (await connectionHelpers()).some(processId => !known.includes(processId)),
    milliseconds,
  );
}

/** One scripted answer of the host pick of window `window`. */
export function hostAnswer(
  window: string,
  answer: 'dismiss' | {label: string} | {typed: string},
) {
  return {
    surface: 'hostPick',
    match: 'Select configured SSH host',
    answer,
    window,
  } as const;
}

/** The exit status of the client's `ssh` with the run's ssh_config and `parameters`. */
async function sshStatus(parameters: readonly string[]): Promise<number> {
  try {
    await execFileAsync('ssh', [
      '-F',
      variable('HARNESS_SSH_CONFIG'),
      ...parameters,
    ]);
    return 0;
  } catch (caught) {
    return (caught as {code?: number}).code ?? 1;
  }
}

/**
 * Whether the ControlMaster of `alias` runs and answers `-O check`. The control command is given `ControlMaster=no`:
 * OpenSSH's mux client ignores `-O` for the `yes` and `ask` modes and logs in afresh.
 */
export async function masterCheck(alias: string): Promise<boolean> {
  return (
    (await sshStatus(['-o', 'ControlMaster=no', '-O', 'check', alias])) === 0
  );
}

/** Ends the ControlMaster of `alias`, if one runs. */
export async function masterExit(alias: string): Promise<void> {
  await sshStatus(['-o', 'ControlMaster=no', '-O', 'exit', alias]);
}

/** Whether a login to `alias` with no question succeeds, which it does only through a master that runs. */
export async function batchLogin(alias: string): Promise<boolean> {
  return (await sshStatus(['-o', 'BatchMode=yes', alias, 'true'])) === 0;
}
