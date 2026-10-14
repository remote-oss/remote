/**
 * @fileoverview What the server maintenance rows share: the scripted answers of the host pick, the host's server
 * processes counted from a baseline, the record read from a mark, and the user settings changed as the Settings editor
 * changes them.
 */

import {mkdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import type {AppendedEntry} from '../../../tools/script-file.ts';
import {
  appendScript,
  closeWindow,
  connectedWithin,
  hostPassword,
  inWindow,
  isOpen,
  noHelperWithin,
  onHost,
  openWindow,
  recordLines,
  type RecordLine,
  settingIn,
  variable,
  waitFor,
  windowNames,
} from './harness.ts';

/** The question of the host pick. */
export const HOST_QUESTION = 'Select configured SSH host or enter user@host';

/** The two fixed rows the host pick ends with. */
export const FIXED_ROWS = [
  '$(plus) Add New SSH Host...',
  'Configure SSH Hosts...',
];

/** The data folder of the host's server in the VSCodium run. */
export const DATA_FOLDER = '/home/harness/.vscodium-server-insiders';

/** How long an open that installs the server may take: the run downloads the server archive. */
export const INSTALL_MILLISECONDS = 180_000;

/** The answer that takes host `label` in the host pick. */
export function pickHost(label: string): AppendedEntry {
  return {
    surface: 'hostPick',
    match: 'Select configured SSH host',
    answer: {label},
  };
}

/** The answer that types `text` into the host pick. */
export function typeHost(text: string): AppendedEntry {
  return {
    surface: 'hostPick',
    match: 'Select configured SSH host',
    answer: {typed: text},
  };
}

/** The answer that types the password account's password. */
export function password(): AppendedEntry {
  return {
    surface: 'maskedInput',
    match: 'Enter password',
    answer: {text: hostPassword()},
  };
}

/** The server processes the host ran when the windows were last all closed, which the rows don't count. */
let leftBefore: number[] = [];

/** The process ids, on the host, of the user harness's processes that run from the server's data folder. */
async function hostServerProcesses(): Promise<number[]> {
  try {
    return (await onHost('pgrep', '-u', 'harness', '-f', `${DATA_FOLDER}/`))
      .split('\n')
      .filter(line => line !== '')
      .map(Number);
  } catch {
    return [];
  }
}

/** The server processes on the host, but those the run's earlier files left. */
export async function serverProcesses(): Promise<number[]> {
  return (await hostServerProcesses()).filter(
    server => !leftBefore.includes(server),
  );
}

/**
 * Waits until none of the server processes `servers` runs on the host any more, for up to `milliseconds`; on a
 * timeout it fails naming the processes that still run, with their command lines.
 */
export async function serversGoneWithin(
  servers: readonly number[],
  milliseconds: number,
): Promise<void> {
  try {
    await waitFor(
      `the server processes ${servers.join(', ')} to end`,
      async () => {
        const running = await serverProcesses();
        return servers.every(server => !running.includes(server));
      },
      milliseconds,
    );
  } catch (caught) {
    const table = await onHost('ps', '-o', 'pid,ppid,args');
    throw new Error(`${String(caught)}; the host's processes:\n${table}`, {
      cause: caught,
    });
  }
}

/** The record lines written since `mark`, of window `window`. */
export function linesSince(mark: number, window: string): RecordLine[] {
  return recordLines()
    .slice(mark)
    .filter(line => line.window === window);
}

/**
 * Runs `command` in window `window` with `answers` scripted for it, and gives the mark of the record it started
 * from.
 */
export async function runWith(
  window: string,
  command: string,
  answers: readonly AppendedEntry[],
): Promise<number> {
  appendScript(answers.map(answer => ({...answer, window})));
  const mark = recordLines().length;
  await inWindow(window, command);
  return mark;
}

/** Changes a user setting from the local window, as the Settings editor does, and waits until `window` reads it. */
export async function setting(
  settingId: string,
  value: unknown,
  window = 'local',
): Promise<void> {
  await inWindow('local', 'acceptance.agent.updateSetting', settingId, value);
  await waitFor(
    `${window} to read ${settingId}`,
    async () =>
      JSON.stringify((await settingIn(window, settingId)) ?? null) ===
      JSON.stringify(value ?? null),
    10_000,
  );
}

/** The bytes of the run's user settings file, as text. */
export function settingsText(): string {
  return readFileSync(
    path.join(variable('HARNESS_RUN_FOLDER'), 'user-data/User/settings.json'),
    'utf8',
  );
}

/** The port the run's `harness` block names. */
export function harnessPort(): string {
  const config = readFileSync(variable('HARNESS_SSH_CONFIG'), 'utf8');
  return (
    /Port (\d+)/.exec(config.slice(config.indexOf('Host harness\n')))?.[1] ?? ''
  );
}

/** The known_hosts file of the `password-ask` alias. */
export function passwordAskHosts(): string {
  return path.join(variable('HARNESS_RUN_FOLDER'), 'known_hosts_password_ask');
}

/** Opens window `name` on `harness` and waits until it is connected. */
export async function openConnected(
  name: string,
  milliseconds = 60_000,
): Promise<void> {
  await openWindow('harness', name);
  await connectedWithin(name, milliseconds);
}

/** Opens a local folder window `name` on a folder `folders/<name>` of the run, made first, and waits for its agent. */
export async function openLocalWindow(
  name: string,
  folders: string,
): Promise<void> {
  const folder = path.join(variable('HARNESS_RUN_FOLDER'), folders, name);
  mkdirSync(folder, {recursive: true});
  await inWindow('local', 'acceptance.agent.openWindow', `file://${folder}`);
  await waitFor(`${name} to activate its agent`, () => isOpen(name), 60_000);
}

/**
 * Closes every window of the launch but `local` that is open, waits until no connection helper runs, and from then on
 * counts no server process that runs on the host now.
 */
export async function closeAllButLocal(): Promise<void> {
  for (const name of windowNames()) {
    if (name !== 'local' && isOpen(name)) {
      await closeWindow(name);
    }
  }
  await noHelperWithin(60_000);
  leftBefore = await hostServerProcesses();
}

/** The per-window mode: no local server, and the host's platform named so that no pick is asked. */
export async function perWindowMode(enabled: boolean): Promise<void> {
  await setting(
    'remote.SSH.remotePlatform',
    enabled ? {harness: 'linux'} : undefined,
  );
  await setting('remote.SSH.useLocalServer', enabled ? false : undefined);
}

/** Whether `file` exists on the host. */
export function existsOnHost(file: string): Promise<boolean> {
  return onHost('test', '-e', file).then(
    () => true,
    () => false,
  );
}
