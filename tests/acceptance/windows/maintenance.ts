/**
 * @fileoverview What the server maintenance rows share: the scripted answers of the host pick, the host's server
 * processes counted from a baseline, the record read from a mark, and the user settings changed as the Settings editor
 * changes them.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import type {AppendedEntry} from '../../../tools/script-file.ts';
import {
  appendScript,
  closeWindow,
  connectedWithin,
  connectionLog,
  hostPassword,
  inWindow,
  isOpen,
  noHelperWithin,
  onHost,
  onHostAs,
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
 * from. The script is lined up with the window's cursor first, so an entry an earlier command left unused can't
 * answer this one.
 */
export async function runWith(
  window: string,
  command: string,
  answers: readonly AppendedEntry[],
): Promise<number> {
  alignScript(window);
  appendScript(answers.map(answer => ({...answer, window})));
  const mark = recordLines().length;
  try {
    await inWindow(window, command);
  } catch (caught) {
    throw new Error(
      `${String(caught)}; the log:\n${connectionLog().slice(-30).join('\n')}`,
      {cause: caught},
    );
  }
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
  const mark = recordLines().length;
  await openWindow('harness', name);
  try {
    await connectedWithin(name, milliseconds);
  } catch (caught) {
    const lines = linesSince(mark, name).map(
      line => `${line.surface}: ${line.question}`,
    );
    throw new Error(
      `${String(caught)}; ${name}'s record:\n${lines.join('\n')}\nthe log:\n${connectionLog().slice(-40).join('\n')}`,
      {cause: caught},
    );
  }
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

/** Ends the host's servers and removes their installs, so that the next connect installs the server afresh. */
export async function freshHost(): Promise<void> {
  await closeAllButLocal();
  // The bracket keeps pkill's pattern from matching this shell's own command line.
  const servers = `${DATA_FOLDER.replace('/.', '/[.]')}/bin/`;
  await onHost(
    'sh',
    '-c',
    `pkill -f '${servers}' || true; rm -rf '${DATA_FOLDER}/bin' '${DATA_FOLDER}/cli'`,
  );
}

/** The entries that dismiss a failing window's dialog and the pick of actions after it, written for its folder name. */
export function dismissals(window: string) {
  return [
    {
      surface: 'failureDialog',
      match: 'Could not establish connection',
      answer: 'dismiss',
      window,
    },
    {
      surface: 'mitigationPick',
      match: 'Pick an action',
      answer: 'dismiss',
      window,
    },
  ] as const;
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

/** The surfaces whose record lines move a window's cursor through the script, as the scripted adapters count them. */
const ANSWERED_SURFACES = new Set([
  'pick',
  'maskedInput',
  'textInput',
  'platformPick',
  'hostPick',
  'filePick',
  'failureDialog',
  'notice',
  'mitigationPick',
  'licenceModal',
]);

/**
 * Lines up the script with window `window`'s cursor, so that the next entries appended for it are the ones the cursor
 * reaches. The cursor is the count of the window's answered record lines; an earlier file may have left entries no
 * question used, or rewritten the script (`scriptEntries`) so that it holds fewer entries for the window than it
 * answered. Unused entries of the window are dropped, and a missing count is made up with placeholders before the
 * cursor, which no question reads again. The entries of other windows are untouched.
 */
export function alignScript(window: string): void {
  const scriptFile = variable('REMOTE_OSS_ACCEPTANCE_SCRIPT');
  const entries = existsSync(scriptFile)
    ? ((
        JSON.parse(readFileSync(scriptFile, 'utf8')) as {
          entries?: Array<{window?: string}>;
        }
      ).entries ?? [])
    : [];
  const answered = recordLines().filter(
    line =>
      line.window === window &&
      line.matched &&
      line.held !== true &&
      ANSWERED_SURFACES.has(line.surface),
  ).length;
  let counted = 0;
  const kept = entries.filter(entry => {
    if (entry.window !== undefined && entry.window !== window) {
      return true;
    }
    counted += 1;
    return counted <= answered;
  });
  const placeholders = Array.from(
    {length: Math.max(0, answered - counted)},
    () => ({surface: 'notice', match: '', answer: 'dismiss', window}),
  );
  const tempFile = `${scriptFile}.${String(process.pid)}.tmp`;
  writeFileSync(
    tempFile,
    JSON.stringify({entries: [...placeholders, ...kept]}),
  );
  renameSync(tempFile, scriptFile);
}

/** The data folder of the server of `harness-fish`, the account whose login shell is fish. */
export const FISH_DATA_FOLDER = '/home/harness-fish/.vscodium-server-insiders';

/** Opens window `name` on `harness-fish` until it connects, so the account has a running server, then closes it. */
export async function fishServerInstalled(name: string): Promise<void> {
  await openWindow('harness-fish', name);
  try {
    await connectedWithin(name, INSTALL_MILLISECONDS);
  } finally {
    await closeWindow(name);
  }
}

/** Whether a server of `harness-fish` runs on the host; the bracket keeps pgrep from matching its own command line. */
export function fishServerRuns(): Promise<boolean> {
  return onHostAs(
    'harness-fish',
    'pgrep',
    '-f',
    `${FISH_DATA_FOLDER.replace('/.', '/[.]')}/bin/`,
  ).then(
    () => true,
    () => false,
  );
}
