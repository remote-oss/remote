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
import {
  cutNetwork,
  cutRoute as cutRouteOf,
  restoreNetwork,
  restoreRoute as restoreRouteOf,
  type RouteCut,
} from '../../../tools/acceptance-network.ts';
import {runCommand} from '../../../tools/command-runner.ts';
import {processIdsOf} from '../../../tools/process-ids.ts';
import {
  descendantRootOf,
  processStatOf,
  processTreeOf,
  refusedTargets,
  treeOf,
} from '../../../tools/process-tree.ts';
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
    | 'extension'
    | 'terminalBuffer'
    | 'recentlyOpened'
    | 'taskEnded'
    | 'terminalNames'
    | 'untitledDocuments'
    | 'tunnels';
  time: number;
  id?: string;
  message?: string;
  remoteName?: string | null;
  remoteAuthority?: string | null;
  folders?: string[];
  /** The window's workspace file, `untitled:` for an unsaved one, or null for a folder window, as `state` reports it. */
  workspaceFile?: string | null;
  /** Whether the window's workspace is trusted, as `state` reports it. */
  trusted?: boolean;
  /** Whether the remote-ssh extension has activated in the window, as `state` reports it. */
  remoteSshActive?: boolean;
  /** The setting a `setting` event reports, its value, and its default in the window. */
  settingId?: string;
  value?: unknown;
  defaultValue?: unknown;
  /** Whether the user's settings hold a value for the setting, as `setting` reports it: a key holding `null` reads as no value, as an absent one does. */
  inUserScope?: boolean;
  /** Where a forwarded port is reachable on this machine, as the editor gave it. */
  localAddress?: string | {host: string; port: number};
  remotePort?: number;
  /** The prefix a `commands` event was asked for, and the registered command ids that start with it, sorted. */
  prefix?: string;
  commandIds?: string[];
  /** The extension an `extension` event was asked about, whether the window's editor has it, and whether it is active there. */
  extensionId?: string;
  present?: boolean;
  extensionActive?: boolean;
  /** The version of the editor an `extension` event came from. */
  editorVersion?: string;
  /** The output channel a `state` event saw shown in the window, or null. */
  visibleOutputChannel?: string | null;
  /** The names of the window's terminals, hidden ones included, as a `state` event saw them. */
  terminals?: string[];
  /** The file of the window's active text editor, or null, as a `state` event saw it. */
  activeEditor?: string | null;
  /** The active tab when it holds a text file: its URI and whether it is a preview; null for any other tab, as a `state` event saw it. */
  activeTab?: {uri: string; preview: boolean} | null;
  /** The uris of the window's documents with unsaved changes, untitled ones included, as a `state` event saw them. */
  dirtyDocuments?: string[];
  /** The whole buffer of the window's active terminal, scrollback included, as a `terminalBuffer` event copied it. */
  text?: string | null;
  /** The name of the window's active terminal, or null for none, as a `terminalBuffer` event saw it. */
  active?: string | null;
  /** The editor command or read of a `terminalBuffer` event that did not finish in 10 s, when one did not; its `text` is then null. */
  stuck?: string;
  /** The folders and workspaces of the editor's Open Recent list, as a `recentlyOpened` event read them. */
  recent?: RecentEntry[];
  /** The exit code a `taskEnded` event reports, or null when the process gave none. */
  exitCode?: number | null;
  /** The names of the window's terminals, in order, as a `terminalNames` event listed them. */
  names?: string[];
  /** The window's untitled documents, as an `untitledDocuments` event read them. */
  documents?: UntitledDocument[];
  /** The window's forwarded ports, as a `tunnels` event listed them: environment tunnels are not among them. */
  tunnels?: ForwardedTunnel[];
}

/** One untitled document of a window: its address, its language, its whole text and whether it has unsaved changes. */
export interface UntitledDocument {
  uri: string;
  language: string;
  text: string;
  dirty: boolean;
}

/** One folder or workspace of the Open Recent list: its address, and the label and remote authority stored with it. */
export interface RecentEntry {
  uri: string;
  label: string | null;
  remoteAuthority: string | null;
}

/** One forwarded port of a window: its port on the host, and where it is reachable on this machine. */
export interface ForwardedTunnel {
  remotePort: number;
  localAddress: string;
}

/** One line of the record the extensions append to. */
export interface RecordLine {
  /** A question's surface, or `progress`, `downloadProgress` or `progressEnd` for a display-only line. */
  surface: string;
  question: string;
  /** The answer given: `'held'` on the waiting line of a held entry, `'withdrawn'` when its question ended while it waited. */
  answer: string;
  matched: boolean;
  /** The waiting line of a held entry: the answer or withdrawal line that follows it counts for the cursor, not this one. */
  held?: boolean;
  window: string;
  /** The labels a failure dialog, a notice or the pre-connection dialog was shown with, in order. */
  buttons?: string[];
  /** The detail text a modal was shown with; only the lines of a `licenceModal` or a `preconnectDialog` surface have it. */
  detail?: string;
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

/** The engine CLI the launch's extension uses: `HARNESS_ENGINE`, or `docker`. */
export function engineCli(): string {
  const engine = process.env.HARNESS_ENGINE;
  return engine === undefined || engine === '' ? 'docker' : engine;
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

/** The lines of the log file named by `variableName`, without their time stamps; none before the first is written. */
function logLinesOf(variableName: string): string[] {
  const file = variable(variableName);
  if (!existsSync(file)) {
    return [];
  }
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(line => line !== '')
    .map(line => line.slice(line.indexOf('] ') + 2));
}

/** The lines of the log the launch's extensions write, without their time stamps; none before the first is written. */
export function connectionLog(): string[] {
  return logLinesOf('REMOTE_OSS_ACCEPTANCE_LOG');
}

/** The lines of the Dev Containers log, without their time stamps; none before the first is written. */
export function containersLog(): string[] {
  return logLinesOf('REMOTE_OSS_ACCEPTANCE_CONTAINERS_LOG');
}

/** The lines of the Dev Containers log after the first `mark` of them, `mark` being a count taken earlier. */
export function containersLogSince(mark: number): string[] {
  return containersLog().slice(mark);
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

/** The number of key logins the host's sshd counted for the user harness. */
export function logins(): Promise<number> {
  return acceptedLogins('Accepted publickey for harness');
}

/** The number of logins the host's sshd counted for the password account. */
export function acceptedPasswords(): Promise<number> {
  return acceptedLogins('Accepted password for harness-pw');
}

/** The lower-case hex of the JSON of a target, the form of an authority's payload that F-2501 BR-1 defines. */
export function hexOf(target: Readonly<Record<string, unknown>>): string {
  return Buffer.from(JSON.stringify(target)).toString('hex');
}

/** The port the host container publishes for its sshd, as the run's `Host harness` block names it. */
export function hostPort(): number {
  const text = readFileSync(variable('HARNESS_SSH_CONFIG'), 'utf8');
  const match = /^Host harness\n(?:.*\n)*?\s+Port (\d+)$/m.exec(text);
  if (match?.[1] === undefined) {
    throw new Error('the ssh_config of the run has no port for Host harness');
  }
  return Number(match[1]);
}

/** The lines of the host container's log since `since` (an RFC 3339 time), from both of its streams. */
export async function sshdLog(since: string): Promise<string[]> {
  const {stdout, stderr} = await execFileAsync(
    'docker',
    ['logs', '--since', since, variable('HARNESS_CONTAINER')],
    {encoding: 'utf8'},
  );
  return `${stdout}\n${stderr}`.split('\n').filter(line => line !== '');
}

/** The times, in milliseconds, of the key logins of the user harness that the host's sshd logged since `since`. */
export async function acceptedKeyLoginTimes(since: string): Promise<number[]> {
  const {stdout, stderr} = await execFileAsync(
    'docker',
    ['logs', '--timestamps', '--since', since, variable('HARNESS_CONTAINER')],
    {encoding: 'utf8'},
  );
  return `${stdout}\n${stderr}`
    .split('\n')
    .filter(line => line.includes('Accepted publickey for harness'))
    .map(line => Date.parse(line.slice(0, line.indexOf(' '))));
}

/** The number of logins by key the host's sshd counted for the user harness since `since`. */
export async function acceptedKeyLogins(since: string): Promise<number> {
  return (await sshdLog(since)).filter(line =>
    line.includes('Accepted publickey for harness'),
  ).length;
}

/**
 * The established TCP connections of this machine whose peer is the host container's published address, each with
 * the name of the program that holds it, from `ss -tnpH state established`.
 */
export async function hostConnections(): Promise<Array<{program: string}>> {
  const {stdout} = await execFileAsync('ss', ['-tnpH', 'state', 'established']);
  const peer = `127.0.0.1:${String(hostPort())}`;
  return stdout
    .split('\n')
    .map(line => /^\s*\d+\s+\d+\s+\S+\s+(\S+)\s+users:\(\("([^"]+)"/.exec(line))
    .filter(match => match?.[1] === peer)
    .map(match => ({program: match?.[2] ?? ''}));
}

/** Cuts the host container's network, as a lost network is cut; a row that cuts restores it in a `finally`. */
export function cutHostNetwork(): void {
  cutNetwork(runCommand, variable('HARNESS_CONTAINER'));
}

/** Brings the host container's network back. */
export function restoreHostNetwork(): void {
  restoreNetwork(runCommand, variable('HARNESS_CONTAINER'));
}

/** Cuts the route to the host's own address (the `routed` alias); the published port keeps working. */
export function cutRoute(kind: RouteCut): void {
  cutRouteOf(
    runCommand,
    variable('HARNESS_CONTAINER'),
    variable('HARNESS_ROUTED_ADDRESS'),
    kind,
  );
}

/** Brings the route back; harmless when nothing was cut. */
export function restoreRoute(): void {
  restoreRouteOf(
    runCommand,
    variable('HARNESS_CONTAINER'),
    variable('HARNESS_ROUTED_ADDRESS'),
  );
}

/** The uris of window `name`'s documents with unsaved changes, as it reports them now. */
export async function dirtyDocumentsOf(name: string): Promise<string[]> {
  await inWindow(name, 'acceptance.agent.state');
  return (
    windowEvents(name)
      .filter(each => each.event === 'state')
      .at(-1)?.dirtyDocuments ?? []
  );
}

/** The names of window `name`'s terminals, as it reports them now. */
export async function terminalsOf(name: string): Promise<string[] | undefined> {
  await inWindow(name, 'acceptance.agent.state');
  return windowEvents(name)
    .filter(each => each.event === 'state')
    .at(-1)?.terminals;
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

/**
 * Writes a command for window `name` as one append, and returns its id. A `concurrent` command doesn't wait for the
 * commands before it, and the ones after it don't wait for it.
 */
function send(
  name: string,
  command: string,
  parameters: unknown[],
  concurrent = false,
): string {
  const commandId = `${String(Date.now())}-${Math.random().toString(36).slice(2)}`;
  mkdirSync(path.dirname(agentFile(name, 'commands')), {recursive: true});
  appendFileSync(
    agentFile(name, 'commands'),
    `${JSON.stringify({id: commandId, command, parameters, ...(concurrent ? {concurrent: true} : {})})}\n`,
  );
  return commandId;
}

/**
 * Has window `name` start a command while others may still run, and resolves once the window has accepted it, not
 * when it ends: two of them are in flight at once, as two quick invocations by the user are.
 */
export async function startInWindow(
  name: string,
  command: string,
  ...parameters: unknown[]
): Promise<void> {
  await waitUntil(`window ${name} to activate its agent`, () =>
    windowEvents(name).some(each => each.event === 'activated'),
  );
  const commandId = send(name, command, parameters, true);
  await waitUntil(`window ${name} to accept ${command}`, () =>
    windowEvents(name).some(
      each => each.id === commandId && each.event === 'accepted',
    ),
  );
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

/** The exit code of the process task window `name` ran, or null when the process gave none. */
export async function runProcessTask(
  name: string,
  command: string,
  programArguments: string[],
): Promise<number | null> {
  return (
    (
      await reported(
        name,
        'taskEnded',
        'acceptance.agent.runProcessTask',
        command,
        programArguments,
      )
    )?.exitCode ?? null
  );
}

/** The names of window `name`'s terminals, in order, as a `terminalNames` event listed them. */
export async function terminalNames(name: string): Promise<string[]> {
  return (
    (await reported(name, 'terminalNames', 'acceptance.agent.terminalNames'))
      ?.names ?? []
  );
}

/** The untitled documents of window `name`, in the order the editor lists them, as an `untitledDocuments` event read them. */
export async function untitledDocuments(
  name: string,
): Promise<UntitledDocument[]> {
  return (
    (
      await reported(
        name,
        'untitledDocuments',
        'acceptance.agent.untitledDocuments',
      )
    )?.documents ?? []
  );
}

/**
 * Polls window `name`'s terminals for a name containing `wanted`, for up to 10 s: a new terminal's name can settle after
 * it opens, and gives whether one holds it.
 */
export async function terminalNamed(
  name: string,
  wanted: string,
): Promise<boolean> {
  const deadline = Date.now() + 10_000;
  let named = (await terminalNames(name)).some(each => each.includes(wanted));
  while (!named && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 500));
    named = (await terminalNames(name)).some(each => each.includes(wanted));
  }
  return named;
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

/**
 * Runs Reopen in Container in window `name` and resolves on the window's next `activated`, which comes with the
 * reload, before the connect is done. The command isn't awaited: the reload ends the extension host before it can
 * answer, as with `reloadWindow`. A row whose window never reaches its folder (a dialog instead) waits from here.
 */
export async function reopenStarted(name: string): Promise<void> {
  await reloadingCommand(name, 'remote-containers.reopenInContainer');
}

/**
 * Runs `command` in window `name`, a command that reloads the window, and resolves on the window's next `activated`.
 * The command isn't awaited: the reload ends the extension host before it can answer.
 */
export async function reloadingCommand(
  name: string,
  command: string,
  ...parameters: unknown[]
): Promise<void> {
  const before = countOf(name, 'activated');
  send(name, command, parameters);
  await waitUntil(
    `window ${name} to activate again after ${command}`,
    () => countOf(name, 'activated') > before,
  );
}

/**
 * Runs the command in window `name`, Reopen in Container unless `command` says another, and resolves once the window
 * is connected to its container: the window reads its workspace folder through the container's file system, which it
 * can't before the connect is done.
 */
export async function reopenInContainer(
  name: string,
  milliseconds = 300_000,
  command = 'remote-containers.reopenInContainer',
): Promise<void> {
  await reloadingCommand(name, command);
  await connectedToContainer(name, milliseconds);
}

/** Resolves once window `name` is connected to its container: it reads its workspace folder through the container's file system. */
export async function connectedToContainer(
  name: string,
  milliseconds = 300_000,
): Promise<void> {
  await waitFor(
    `window ${name} to connect to its container`,
    async () => {
      try {
        await inWindow(name, 'acceptance.agent.statFolder');
        return (await windowState(name)).remoteName === 'dev-container';
      } catch {
        return false;
      }
    },
    milliseconds,
  );
}

/** `base` scoped to this run, so that a container name never clashes with another run's or a leftover's. */
export function runScopedName(base: string): string {
  return `${base}-${variable('HARNESS_RUN_ID')}`;
}

/** The `docker run` arguments that label a dev container of the run, so that the run's clean-up removes it. */
export function runLabelArguments(): string[] {
  return [
    '--label',
    `remote-oss.acceptance.run=${variable('HARNESS_RUN_ID')}`,
    '--label',
    'remote-oss.acceptance.devcontainer=1',
  ];
}

/**
 * Writes the folder `<run>/<name>` with a dev container configuration on the run's image, labelled so the run's
 * clean-up removes its container, and returns the folder's path. `configuration` is merged over the defaults.
 */
export function devContainerFolder(
  name: string,
  configuration: Readonly<Record<string, unknown>> = {},
): string {
  const folder = path.join(variable('HARNESS_RUN_FOLDER'), name);
  mkdirSync(path.join(folder, '.devcontainer'), {recursive: true});
  writeFileSync(
    path.join(folder, '.devcontainer', 'devcontainer.json'),
    JSON.stringify({
      image: variable('HARNESS_DEVCONTAINER_IMAGE'),
      runArgs: runLabelArguments(),
      ...configuration,
    }),
  );
  return folder;
}

/**
 * Starts a listener on `port` in container `containerId`, which echoes what it is sent, waits until the container
 * lists the port, and gives the function that ends it.
 */
export async function listenIn(
  containerId: string,
  port: number,
): Promise<() => Promise<void>> {
  await execFileAsync('docker', [
    'exec',
    '-d',
    containerId,
    'nc',
    '-lk',
    '-p',
    String(port),
    '-e',
    'cat',
  ]);
  await waitFor(
    `the container to listen on ${String(port)}`,
    async () =>
      (
        await execFileAsync('docker', ['exec', containerId, 'netstat', '-ltn'])
      ).stdout.includes(`:${String(port)} `),
    10_000,
  );
  return async () => {
    // The bracket keeps pkill's pattern from matching its own shell's command line.
    await execFileAsync('docker', [
      'exec',
      containerId,
      'sh',
      '-c',
      `pkill -f '[n]c -lk -p ${String(port)} ' || true`,
    ]);
  };
}

/** The ids of the run's containers made for `folder`, by the label the dev container CLI gives them. */
export async function devContainersOf(folder: string): Promise<string[]> {
  const {stdout} = await execFileAsync('docker', [
    'ps',
    '--all',
    '--quiet',
    '--filter',
    `label=devcontainer.local_folder=${folder}`,
    '--filter',
    `label=remote-oss.acceptance.run=${variable('HARNESS_RUN_ID')}`,
  ]);
  return stdout.split('\n').filter(line => line !== '');
}

/** `ubuntu:18.04`, whose glibc 2.27 is below the server's 2.28, pinned by digest as the Alpine base is. */
export const OLD_GLIBC_IMAGE =
  'ubuntu:18.04@sha256:152dc042452c496007f07ca9127571cb9c29697f42acbfad72324b2bb2e43c98';

/** `ubuntu:26.04`, whose coreutils are uutils, pinned by its index digest as the Alpine base is (`docker buildx imagetools inspect ubuntu:26.04`, Docker Hub, 2026-10-31); `tests/acceptance/host-ubuntu/Dockerfile` pins the same digest, so a bump moves both. */
export const UBUNTU_IMAGE =
  'ubuntu:26.04@sha256:6a06111c3b0a8600feadb270aec771dc239bf407b25625f93f44ab00e11f4d3c';

/** `debian:bookworm-slim`, whose glibc 2.36 is above the server's 2.28, pinned by digest as the Alpine base is. */
export const GLIBC_IMAGE =
  'debian:bookworm-slim@sha256:7c7b2c966bc9ee8cedfeef67e0e279108992c77681fa595db4a9d65c06ccc587';

/** The facts of the launch's editor that the server's names, paths and licence come from. */
export interface EditorProduct {
  applicationName: string;
  commit: string;
  nameLong: string;
  quality: string;
  serverApplicationName: string;
  serverDataFolderName: string;
  serverLicenseUrl: string;
}

/** The facts of the launch's editor, read from its product.json. */
export function editorProduct(): EditorProduct {
  return JSON.parse(
    readFileSync(
      path.join(
        path.dirname(variable('HARNESS_EDITOR_EXECUTABLE')),
        'resources',
        'app',
        'product.json',
      ),
      'utf8',
    ),
  ) as EditorProduct;
}

/** The names of the engine's volumes, sorted. */
export async function dockerVolumes(): Promise<string[]> {
  const {stdout} = await execFileAsync('docker', ['volume', 'ls', '--quiet']);
  return stdout
    .split('\n')
    .filter(line => line !== '')
    .sort();
}

/** The ids of the engine's images, sorted. */
export async function dockerImages(): Promise<string[]> {
  const {stdout} = await execFileAsync('docker', [
    'image',
    'ls',
    '--all',
    '--quiet',
  ]);
  return [...new Set(stdout.split('\n').filter(line => line !== ''))].sort();
}

/** The ids of the engine's containers, running or not, sorted. */
export async function dockerContainers(): Promise<string[]> {
  const {stdout} = await execFileAsync('docker', ['ps', '--all', '--quiet']);
  return stdout
    .split('\n')
    .filter(line => line !== '')
    .sort();
}

/**
 * The window's process id: the one its live pid file is named by (the file's text is the window's name).
 * A window that is reopened leaves the pid file of the process that ran in it before, so a file of a
 * process that has ended is not the window's process.
 */
function windowProcessId(name: string): number {
  const pids = variable('REMOTE_OSS_ACCEPTANCE_WINDOWS');
  for (const file of readdirSync(pids)) {
    if (readFileSync(path.join(pids, file), 'utf8') !== name) {
      continue;
    }
    const processId = Number(file);
    if (
      Number.isInteger(processId) &&
      processId > 0 &&
      !processIsGone(processId)
    ) {
      return processId;
    }
  }
  throw new Error(`window ${name} has no live pid file`);
}

/** Has the process `processId` ended: its /proc folder is gone. */
function processIsGone(processId: number): boolean {
  try {
    statSync(`/proc/${String(processId)}`);
    return false;
  } catch {
    return true;
  }
}

/**
 * Kills window `name`'s processes at once (SIGKILL): its process group, its main process, or its whole
 * tree. The main process is the editor process the run started: the run is this test's own parent, so the
 * parent-field walk up from the window stops at the process it started. The tree is that process's whole
 * tree, read from /proc before any of it is killed. A target that is the harness's own group, process or an
 * ancestor of it is refused without killing anything (tooling-67). Afterwards it waits, at most 5 s, until
 * none of the killed processes is left.
 */
export async function killWindow(
  name: string,
  reach: 'processGroup' | 'mainProcess' | 'tree',
): Promise<void> {
  const processId = windowProcessId(name);
  const tree = processTreeOf('/proc');
  const own = {
    processId: process.pid,
    group: processStatOf(process.pid, readFileSync('/proc/self/stat', 'utf8'))
      .group,
  };
  function refuse(
    target:
      | {kind: 'group'; group: number}
      | {kind: 'processes'; processIds: readonly number[]},
  ): void {
    const refused = refusedTargets(tree, own, target);
    if (refused.length > 0) {
      throw new Error(`killWindow(${name}) refused: ${refused.join('; ')}`);
    }
  }
  let killed: number[];
  if (reach === 'processGroup') {
    const line = readFileSync(`/proc/${String(processId)}/stat`, 'utf8');
    const group = processStatOf(processId, line).group;
    refuse({kind: 'group', group});
    process.kill(-group, 'SIGKILL');
    killed = [processId];
  } else {
    const main = descendantRootOf(tree, processId, process.ppid);
    const victims = reach === 'mainProcess' ? [main] : treeOf(tree, main);
    refuse({kind: 'processes', processIds: victims});
    for (const victim of victims) {
      try {
        process.kill(victim, 'SIGKILL');
      } catch {
        // The process ended between the read and the kill; nothing is left of it to kill.
      }
    }
    killed = victims;
  }
  const deadline = Date.now() + 5_000;
  for (;;) {
    const remaining = killed.filter(victim => !processIsGone(victim));
    if (remaining.length === 0) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `the killed processes of window ${name} were still there after 5 s: ${remaining.join(', ')}`,
      );
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
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
  return (await extensionReport(name, extensionId))?.present === true;
}

/** Whether the extension `extensionId` has activated in window `name`'s local extension host. */
export async function extensionActive(
  name: string,
  extensionId: string,
): Promise<boolean> {
  return (await extensionReport(name, extensionId))?.extensionActive === true;
}

/** The version of the editor of window `name`, as its agent reports it with its answer about an extension. */
export async function editorVersionOf(name: string): Promise<string> {
  return (
    (await extensionReport(name, 'remote-oss.remote-ssh'))?.editorVersion ?? ''
  );
}

/** What window `name` reports of the extension `extensionId`: whether its editor has it, and whether it is active. */
function extensionReport(
  name: string,
  extensionId: string,
): Promise<AgentEvent | undefined> {
  return reported(
    name,
    'extension',
    'acceptance.agent.extensionPresent',
    extensionId,
  );
}

/**
 * What window `name` reports of itself: the remote it is on, the authority it is on and its folders. An SSH window's
 * authority is written by remote-ssh when it resolves, which may lag the window's agent, so an SSH window's state is
 * re-asked until the authority is there. Any other window reports once: no other extension writes an authority, so a
 * dev container window's is always null.
 */
export async function windowState(name: string): Promise<{
  remoteName: string | null;
  remoteAuthority: string | null;
  folders: string[];
  workspaceFile: string | null;
  remoteSshActive: boolean;
  activeTab: {uri: string; preview: boolean} | null;
}> {
  const deadline = Date.now() + WAIT_MILLISECONDS;
  for (;;) {
    const last = await reportedState(name);
    const state = {
      remoteName: last?.remoteName ?? null,
      remoteAuthority: last?.remoteAuthority ?? null,
      folders: last?.folders ?? [],
      workspaceFile: last?.workspaceFile ?? null,
      remoteSshActive: last?.remoteSshActive ?? false,
      activeTab: last?.activeTab ?? null,
    };
    if (
      state.remoteName !== 'ssh-remote' ||
      state.remoteAuthority !== null ||
      Date.now() > deadline
    ) {
      return state;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}

/** Whether window `name`'s Remote - SSH extension is active, as its `state` reports it now. */
export async function remoteSshActive(name: string): Promise<boolean> {
  return (await reportedState(name))?.remoteSshActive ?? false;
}

/**
 * A window's state without `remoteSshActive`, which changes when the extension activates; for rows that compare what
 * a window shows of itself before and after something that may activate it.
 */
export function withoutActivity(state: {
  remoteName: string | null;
  remoteAuthority: string | null;
  folders: string[];
}): {
  remoteName: string | null;
  remoteAuthority: string | null;
  folders: string[];
} {
  return {
    remoteName: state.remoteName,
    remoteAuthority: state.remoteAuthority,
    folders: state.folders,
  };
}

/** The file of window `name`'s active text editor as it reports now, or `null` when it has none. */
export async function activeEditorOf(name: string): Promise<string | null> {
  return (await reportedState(name))?.activeEditor ?? null;
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

/**
 * The argv of each `ssh` process whose parent is one of the run's connection helpers, as lists of strings, read from
 * `/proc/<pid>/cmdline`. Call it while a connect runs and repeat it, since each process is as brief as its connect:
 * a caller that notes the distinct lists it sees over the connect sees what `ssh` was started with. The argv holds
 * no secret, by the register rule.
 */
export async function sshArguments(): Promise<string[][]> {
  const commands: string[][] = [];
  for (const helperId of await connectionHelpers()) {
    for (const processId of await sshChildren(helperId)) {
      let bytes: string;
      try {
        bytes = readFileSync(`/proc/${String(processId)}/cmdline`, 'utf8');
      } catch {
        // The process ended between the listing and the read.
        continue;
      }
      const argv = bytes.split('\0').filter(part => part !== '');
      if (argv[0] === 'ssh') {
        commands.push(argv);
      }
    }
  }
  return commands;
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

/** The launch's user settings file, the one the editor reads. */
export function userSettingsFile(): string {
  return path.join(variable('HARNESS_USER_DATA'), 'User/settings.json');
}

/** The bytes of the launch's user settings file, or nothing when it has none. */
export function readUserSettings(): string | undefined {
  const file = userSettingsFile();
  return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
}

/** Puts the launch's user settings file back to the bytes `readUserSettings` gave, or removes it when it had none. */
export function restoreUserSettings(bytes: string | undefined): void {
  if (bytes === undefined) {
    rmSync(userSettingsFile(), {force: true});
  } else {
    writeFileSync(userSettingsFile(), bytes);
  }
}

/** Rewrites the launch's user settings with `change` applied to them, which the editor picks up; then waits 1 s. */
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

/** What window `name` found of its terminals when asked for the active one's buffer. */
export interface TerminalFacts {
  /** The buffer of the active terminal; empty for none, and null when a step did not finish. */
  text: string | null;
  /** The names of the window's terminals. */
  terminals: string[];
  /** The name of the active terminal, or null for none. */
  active: string | null;
  /** The step that did not finish in 10 s, when one did not. */
  stuck: string | undefined;
}

/**
 * The names of window `name`'s terminals and the active one's, and the active one's whole buffer, scrollback included:
 * the agent focuses the terminal, selects all of it and copies it, and reports the clipboard's text. A window with no
 * active terminal answers at once with no text, and a step that does not finish in 10 s is named.
 */
export async function terminalFacts(name: string): Promise<TerminalFacts> {
  const event = await reported(
    name,
    'terminalBuffer',
    'acceptance.agent.terminalBuffer',
  );
  return {
    text: event?.text ?? null,
    terminals: event?.terminals ?? [],
    active: event?.active ?? null,
    stuck: event?.stuck,
  };
}

/** The whole buffer of window `name`'s active terminal, scrollback included; empty when it has none. */
export async function terminalBuffer(name: string): Promise<string> {
  return (await terminalFacts(name)).text ?? '';
}

/** The folders and workspaces of the editor's Open Recent list, as window `name` reads them from the main process. */
export async function recentlyOpenedIn(name: string): Promise<RecentEntry[]> {
  return (
    (await reported(name, 'recentlyOpened', 'acceptance.agent.recentlyOpened'))
      ?.recent ?? []
  );
}

/** The value window `name` reads for the setting `settingId`, or null when it reads none. */
export async function settingIn(
  name: string,
  settingId: string,
): Promise<unknown> {
  return (
    await reported(name, 'setting', 'acceptance.agent.setting', settingId)
  )?.value;
}

/** Whether the user's settings, as window `name` reads them, hold a value for the setting `settingId`; a key holding `null` reads as none, so the settings file is what tells it from a removed key. */
export async function userScopeHolds(
  name: string,
  settingId: string,
): Promise<boolean> {
  return (
    (await reported(name, 'setting', 'acceptance.agent.setting', settingId))
      ?.inUserScope === true
  );
}

/**
 * Sets the user setting from the local window, or removes it for `undefined`, and waits until `window` reads the
 * result: `undefined` would reach the agent as `null`, which the editor writes as a key with `null`, not as no key.
 */
export async function writeUserSetting(
  settingId: string,
  value: unknown,
  window: string,
  milliseconds: number,
): Promise<void> {
  if (value === undefined) {
    await inWindow('local', 'acceptance.agent.removeSetting', settingId);
    await waitFor(
      `${window} to read ${settingId} removed`,
      async () => !(await userScopeHolds(window, settingId)),
      milliseconds,
    );
    return;
  }
  await inWindow('local', 'acceptance.agent.updateSetting', settingId, value);
  await waitFor(
    `${window} to read ${settingId} as ${JSON.stringify(value)}`,
    async () =>
      JSON.stringify(await settingIn(window, settingId)) ===
        JSON.stringify(value) &&
      (value === null || (await userScopeHolds(window, settingId))),
    milliseconds,
  );
}

/** The default window `name` has for the setting `settingId`, the one its Settings editor shows, or null for none. */
export async function settingDefaultIn(
  name: string,
  settingId: string,
): Promise<unknown> {
  return (
    await reported(name, 'setting', 'acceptance.agent.setting', settingId)
  )?.defaultValue;
}

/** The ports window `name` forwards, as the editor lists them; a forward of the SSH configuration is not among them. */
export async function tunnelsOf(name: string): Promise<ForwardedTunnel[]> {
  return (
    (await reported(name, 'tunnels', 'acceptance.agent.tunnels'))?.tunnels ?? []
  );
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
