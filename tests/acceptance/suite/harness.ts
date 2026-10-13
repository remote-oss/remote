/**
 * @fileoverview What the acceptance tests share: the harness variables and commands on the SSH host.
 */

import {execFile} from 'node:child_process';
import {appendFileSync, existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {readRecord, type RecordLine} from '../suite-local/script.ts';

const execFileAsync = promisify(execFile);

/** A harness variable the runner sets; throws when the tests run outside the harness. */
function harnessVariable(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(
      `${name} is not set; run the tests with pnpm test:acceptance`,
    );
  }
  return value;
}

/** The standard output of `command` run on the host through the harness's SSH configuration. */
export async function overSsh(command: string): Promise<string> {
  const {stdout} = await execFileAsync('ssh', [
    '-F',
    harnessVariable('HARNESS_SSH_CONFIG'),
    'harness',
    command,
  ]);
  return stdout;
}

/** The standard output of `command` run in the host container as the user harness, outside SSH. */
export async function onHost(...command: string[]): Promise<string> {
  const {stdout} = await execFileAsync('docker', [
    'exec',
    '--user',
    'harness',
    harnessVariable('HARNESS_CONTAINER'),
    ...command,
  ]);
  return stdout;
}

/** The lines of the log the harness reads, `REMOTE_OSS_ACCEPTANCE_LOG`, without their time stamps. */
export function connectionLog(): string[] {
  return readFileSync(harnessVariable('REMOTE_OSS_ACCEPTANCE_LOG'), 'utf8')
    .split('\n')
    .filter(line => line !== '')
    .map(line => line.slice(line.indexOf('] ') + 2));
}

/** The lines of the record the windows' adapters wrote, optionally of one surface and one window. */
export function recordLines(surface?: string, window?: string): RecordLine[] {
  return readRecord(harnessVariable('REMOTE_OSS_ACCEPTANCE_RECORD')).filter(
    line =>
      (surface === undefined || line.surface === surface) &&
      (window === undefined || line.window === window),
  );
}

/** How long a wait for a window lasts, in milliseconds. */
const WINDOW_WAIT_MILLISECONDS = 60_000;

/** What a window's agent reports: an event with the time it happened, and the command it concerns. */
export interface AgentEvent {
  event: 'activated' | 'deactivated' | 'accepted' | 'done' | 'failed';
  time: number;
  id?: string;
  message?: string;
}

/** A file of a window's agent in the run's folder: its `events` or its `commands`. */
function agentFile(name: string, kind: 'events' | 'commands'): string {
  return path.join(
    harnessVariable('HARNESS_RUN_FOLDER'),
    'agent',
    `${name}.${kind}.jsonl`,
  );
}

/** The events the agent of window `name` has reported, in order. */
export function windowEvents(name: string): AgentEvent[] {
  const file = agentFile(name, 'events');
  return existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter(line => line !== '')
        .map(line => JSON.parse(line) as AgentEvent)
    : [];
}

/** Polls until `ready` holds, for up to a minute; it fails naming what it waited for. */
export async function waitUntil(
  description: string,
  ready: () => boolean,
): Promise<void> {
  const deadline = Date.now() + WINDOW_WAIT_MILLISECONDS;
  while (!ready()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${description}`);
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}

/**
 * Opens window `folder` (a folder of the user harness's home) on `alias` and waits for its agent to activate. The
 * window is opened by a second start of the editor, which hands it to the running one: a window opened from a test
 * would inherit the launch's test run, and the end of that run, also by a reload of the window, ends the editor.
 */
export async function openWindow(alias: string, folder: string): Promise<void> {
  const home = `/home/harness/${folder}`;
  await onHost('mkdir', '-p', home);
  const runFolder = harnessVariable('HARNESS_RUN_FOLDER');
  // The extension host runs the editor's own program as a plain Node.js; a second start must be the editor itself.
  await execFileAsync(
    harnessVariable('HARNESS_VSCODIUM_EXECUTABLE'),
    [
      `--user-data-dir=${path.join(runFolder, 'user-data')}`,
      `--extensions-dir=${path.join(runFolder, 'extensions')}`,
      '--enable-proposed-api=remote-oss.remote-ssh',
      '--disable-workspace-trust',
      `--extensionDevelopmentPath=${harnessVariable('HARNESS_WINDOW_AGENT')}`,
      '--new-window',
      '--folder-uri',
      `vscode-remote://ssh-remote+${alias}${home}`,
    ],
    {env: {...process.env, ELECTRON_RUN_AS_NODE: undefined}},
  );
  await waitUntil(`window ${folder} to activate its agent`, () =>
    windowEvents(folder).some(each => each.event === 'activated'),
  );
}

/** Has window `name` run a command and resolves once its agent accepted it; a reload or close may never finish. */
export async function inWindow(
  name: string,
  command: string,
  ...args: unknown[]
): Promise<string> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  appendFileSync(
    agentFile(name, 'commands'),
    `${JSON.stringify({id, command, args})}\n`,
  );
  await waitUntil(`window ${name} to accept ${command}`, () =>
    windowEvents(name).some(
      each => each.id === id && each.event === 'accepted',
    ),
  );
  return id;
}

/** Counts the events of one kind window `name` has reported. */
function eventsOfKind(name: string, event: AgentEvent['event']): number {
  return windowEvents(name).filter(each => each.event === event).length;
}

/** Reloads window `name` and resolves once its agent has activated again. */
export async function reloadWindow(name: string): Promise<void> {
  const before = eventsOfKind(name, 'activated');
  await inWindow(name, 'workbench.action.reloadWindow');
  await waitUntil(
    `window ${name} to activate again`,
    () => eventsOfKind(name, 'activated') > before,
  );
}

/** Closes window `name` and resolves once its agent has deactivated. */
export async function closeWindow(name: string): Promise<void> {
  const before = eventsOfKind(name, 'deactivated');
  await inWindow(name, 'workbench.action.closeWindow');
  await waitUntil(
    `window ${name} to deactivate`,
    () => eventsOfKind(name, 'deactivated') > before,
  );
}
