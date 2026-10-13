/**
 * @fileoverview The Node side of the multi-window launch: the helpers with which a test drives the windows of a plainly
 * started editor through the window agent, and observes them from the agent's events, the record and the host.
 */

import {execFile} from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);

/** How long a wait for a window lasts, in milliseconds. */
const WAIT_MILLISECONDS = 60_000;

/** What a window's agent reports: an event with the time it happened, and the command it concerns. */
export interface AgentEvent {
  event: 'activated' | 'deactivated' | 'accepted' | 'done' | 'failed' | 'state';
  time: number;
  id?: string;
  message?: string;
  remoteName?: string | null;
  folders?: string[];
}

/** One line of the record the extensions append to. */
export interface RecordLine {
  surface: string;
  question: string;
  answer: string;
  matched: boolean;
  window: string;
  /** The labels the pick was shown with, in order; only the lines of a `hostPick` or a `filePick` surface have it. */
  items?: string[];
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
function variable(name: string): string {
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

/** A file of a window's agent in the run's folder: its `events` or its `commands`. */
function agentFile(name: string, kind: 'events' | 'commands'): string {
  return path.join(
    variable('HARNESS_RUN_FOLDER'),
    'agent',
    `${name}.${kind}.jsonl`,
  );
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

/** The output of a command run in the host container as the user harness. */
export async function onHost(...command: string[]): Promise<string> {
  const {stdout} = await execFileAsync('docker', [
    'exec',
    '--user',
    'harness',
    variable('HARNESS_CONTAINER'),
    ...command,
  ]);
  return stdout;
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

/** What window `name` reports of itself: the remote it is on and its folders. */
export async function windowState(
  name: string,
): Promise<{remoteName: string | null; folders: string[]}> {
  const before = countOf(name, 'state');
  await inWindow(name, 'acceptance.agent.state');
  await waitUntil(
    `window ${name} to report its state`,
    () => countOf(name, 'state') > before,
  );
  const last = windowEvents(name)
    .filter(each => each.event === 'state')
    .at(-1);
  return {remoteName: last?.remoteName ?? null, folders: last?.folders ?? []};
}
