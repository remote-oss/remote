/**
 * @fileoverview What the server maintenance rows share: the scripted answers of the host pick, the host's server
 * processes counted from a baseline, the record read from a mark, and the user settings changed as the Settings editor
 * changes them.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {pressEscape} from './renderer.ts';
import type {AppendedEntry} from '../../../tools/script-file.ts';
import {
  closeWindowOnDisplay,
  drive,
  mayCloseOnDisplay,
  nameHoldsName,
  topLevelWindows,
  windowPidOf,
  type DisplayStep,
} from './display.ts';
import {
  appendScript,
  closeContained,
  closeWindow,
  connectedWithin,
  connectionLog,
  hostPassword,
  inWindow,
  isOpen,
  leftoverPagesNote,
  noHelperWithin,
  onHost,
  onHostAs,
  openWindow,
  readUserSettings,
  recordLines,
  type RecordLine,
  variable,
  waitFor,
  writeUserSetting,
  windowEvents,
  windowNames,
  windowState,
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

/** The answer that takes platform `answer` in the platform pick. */
export function platformAnswer(
  answer: 'linux' | 'windows' | 'macOS' | 'dismiss',
): AppendedEntry {
  return {surface: 'platformPick', match: 'platform', answer};
}

/** What `remote.SSH.remotePlatform` holds in the user settings file, or nothing. */
export function storedPlatform(): unknown {
  const text = readUserSettings();
  return text === undefined
    ? undefined
    : (JSON.parse(text) as Record<string, unknown>)[
        'remote.SSH.remotePlatform'
      ];
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
 * The main processes of the servers on the host, the shell that starts one and its node process. A server that an earlier
 * row left is counted too, since the window of a row attaches to it: they are the processes a Kill Current must leave.
 * The children of a server (a window's extension host, a terminal host) come and go with the windows and are not counted.
 */
export async function serverMainProcesses(): Promise<number[]> {
  // A status of 1 is no match; any other status of pgrep, a bad pattern or a failure, fails the call. The pattern is
  // written so that the shell's own command line does not match it.
  return (
    await onHost(
      'sh',
      '-c',
      `pgrep -u harness -f '${DATA_FOLDER}/.* [-]-start-server'; status=$?; [ $status -le 1 ] || exit $status`,
    )
  )
    .split('\n')
    .filter(line => line !== '')
    .map(Number);
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

/** The first line of `window` since `mark` that shows core resolving the authority of SSH host `host` again. */
function resolvedAgainSince(
  mark: number,
  window: string,
  host: string,
): RecordLine | undefined {
  return linesSince(mark, window).find(
    line =>
      line.surface === 'progress' &&
      line.question === `Setting up SSH Host ${host}`,
  );
}

/** How many of `lines` each window has. */
function countsByWindow(lines: readonly RecordLine[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const line of lines) {
    counts[line.window] = (counts[line.window] ?? 0) + 1;
  }
  return counts;
}

/** The length of the connection log at the moment each record mark was taken, by that mark. */
const logMarks = new Map<number, number>();

/** The line of the connection log that says core resolved `host` again after a connection was lost. */
function reconnectionLine(host: string): RegExp {
  return new RegExp(
    `Resolving ssh-remote\\+${host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, attempt \\d+, reconnection`,
    'u',
  );
}

/**
 * Waits `milliseconds` for core's reconnection of `window` to host `host` after its server went, and gives the time it
 * was seen. Core's resolve is seen in the record as the progress of "Setting up SSH Host", which opens only after half a
 * second, and in the connection log as the line that names the reconnection attempt, which a quick resolve leaves alone:
 * either is the evidence. When none comes it fails with what the window and the record showed, since a hosted run uploads
 * neither.
 */
export async function waitForReconnection(
  mark: number,
  window: string,
  host: string,
  milliseconds: number,
): Promise<number> {
  const logMark = logMarks.get(mark) ?? Number.POSITIVE_INFINITY;
  const pattern = reconnectionLine(host);
  let seen = 0;
  try {
    await waitFor(
      `${window} to be resolved again by core’s reconnection`,
      () => {
        const progress = resolvedAgainSince(mark, window, host);
        const logged = connectionLog()
          .slice(logMark)
          .some(line => pattern.test(line));
        if (progress === undefined && !logged) {
          return false;
        }
        seen = progress?.time ?? Date.now();
        return true;
      },
      milliseconds,
    );
    return seen;
  } catch (error) {
    const state = await windowState(window).catch(() => undefined);
    throw new Error(
      `${(error as Error).message}: ${JSON.stringify({
        remoteName: state?.remoteName,
        open: isOpen(window),
        lines: linesSince(mark, window)
          .slice(-12)
          .map(line => [line.surface, line.question, line.answer]),
        // Where the record's lines went, if not to this window: a count of them by window.
        sinceMark: countsByWindow(recordLines().slice(mark)),
        events: windowEvents(window)
          .slice(-6)
          .map(entry => entry.event),
        connection: connectionLog().slice(-8),
      })}`,
      {cause: error},
    );
  }
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
  logMarks.set(mark, connectionLog().length);
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

/** Changes a user setting from the local window, as the Settings editor does (`undefined` removes it), and waits until `window` reads it. */
export async function setting(
  settingId: string,
  value: unknown,
  window = 'local',
): Promise<void> {
  await writeUserSetting(settingId, value, window, 10_000);
}

/** The bytes of the launch's user settings file, as text. */
export function settingsText(): string {
  return readFileSync(
    path.join(variable('HARNESS_USER_DATA'), 'User/settings.json'),
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
 * Closes every window of the launch but `local` whose agent is still active, whichever row opened it: a window that a
 * failed row left, and a window a row opened and never closed. A window that will not close must not fail the hook, and
 * with it every row after: `closeContained` dismisses its dialog and, failing that, ends its extension host. A window
 * whose agent has ended is not listed here, whatever its page does. The windows the named loop leaves behind, the
 * editor top-levels no agent reports, are closed on the display.
 */
export async function closeLeftoverWindows(
  step: DisplayStep = launchDisplayStep(),
): Promise<void> {
  for (const name of windowNames()) {
    if (name !== 'local' && isOpen(name)) {
      await closeContained(name, pressEscape);
    }
  }
  await closeUnownedDisplayWindows(step);
  const left = await leftoverPagesNote();
  if (left !== undefined) {
    process.stderr.write(`after closing the leftover windows: ${left}\n`);
  }
}

/** The display step the launch's close runs on: the harness display itself, with the ownership the launch reads from its own record. */
function launchDisplayStep(): DisplayStep {
  return {
    windows: () => topLevelWindows(),
    pidOf: windowId => windowPidOf(drive, windowId),
    editorPid: () => editorMainProcess(),
    mayClose: windowId => mayCloseOnDisplay(windowId),
    close: windowId => closeWindowOnDisplay(windowId),
  };
}

/** The window ids of the display the launch's last clean settle held, so a close pass closes what a row left after it, and never what the launch found. */
let settledWindows: Set<string> | undefined;

/** The windows the display pass told of, once each, so a window that will not close is not re-told at every settle. */
const toldWindows = new Set<string>();

/** Whether the launch's inert pass has told once, so a launch that cannot own the display says so once and not at every row. */
let inertTold = false;

/**
 * The launch's editor main process: the launch starts the editor detached, and every window process the agents record
 * in their pid files shares the editor's process group, whose id is the group leader's pid, the editor's own. A launch
 * whose recorded window processes are all ended, or whose display says no process, cannot say which process it is.
 */
function editorMainProcess(): Promise<string | undefined> {
  const folder = variable('REMOTE_OSS_ACCEPTANCE_WINDOWS');
  let files: string[];
  try {
    files = readdirSync(folder);
  } catch {
    return Promise.resolve(undefined);
  }
  const pids = files
    .filter(file => /^\d+$/.test(file))
    .map(file => Number(file))
    .sort((first, second) => first - second);
  for (const procId of pids) {
    try {
      const stat = readFileSync(
        path.join('/proc', String(procId), 'stat'),
        'utf8',
      );
      // The fields run state, ppid, pgrp, ... after the command in parentheses, which may hold spaces.
      const pgrp = stat
        .slice(stat.lastIndexOf(')') + 1)
        .trim()
        .split(/\s+/)[2];
      if (pgrp !== undefined && pgrp !== '') {
        return Promise.resolve(pgrp);
      }
    } catch {
      // A process that ended between the look and the read names no group: its file stays until the launch ends.
    }
  }
  return Promise.resolve(undefined);
}

/**
 * Closes, on the display, the editor top-levels the launch's rows left: a visible top-level the launch's editor opened
 * (its _NET_WM_PID is the editor's main process) that the launch's last clean settle did not hold, that no window's
 * agent reports, and that asks its window manager for a close. A top-level that will not close, or that does not accept
 * one, is told once and held in the record, as a named window that will not close is not failed.
 */
async function closeUnownedDisplayWindows(step: DisplayStep): Promise<void> {
  const editor = await step.editorPid();
  if (editor === undefined) {
    if (!inertTold) {
      inertTold = true;
      process.stderr.write(
        'acceptance: the display leftover close is inert: no window of the launch names its editor\n',
      );
    }
    return;
  }
  const names = windowNames();
  const windows = await step.windows();
  for (const window of windows) {
    if (!window.managed) {
      continue;
    }
    // The launch's folder-less windows own the title its window.title setting gives them, and among them the suite's own window,
    // the one whose agent never closes: neither is a row's to close.
    if (window.name === '[]') {
      continue;
    }
    if (settledWindows?.has(window.id) === true) {
      continue;
    }
    if (names.some(name => nameHoldsName(window.name, name))) {
      continue;
    }
    if ((await step.pidOf(window.id)) !== editor) {
      continue;
    }
    if (!(await step.mayClose(window.id))) {
      displayLeftoverNote(window, 'does not accept a close');
      continue;
    }
    const said = `${window.id} (${window.name === '' ? 'no name' : window.name})`;
    try {
      await step.close(window.id);
    } catch {
      // A close the display refuses is the window staying; the settle says so.
    }
    // The settle asks the window for its pid, one read at a time: a window the display dropped has no pid to give.
    const gone = await waitFor(
      `the display to drop window ${said}`,
      async () => (await step.pidOf(window.id)) === undefined,
      30_000,
    )
      .then(() => true)
      .catch(() => false);
    process.stderr.write(
      `acceptance: display ${gone ? 'close' : 'leftover'}: ${said} by closeLeftoverWindows\n`,
    );
  }
  settledWindows = new Set((await step.windows()).map(each => each.id));
}

/** Tells once of the window `window` the display pass will not close, naming it and the step that saw it. */
function displayLeftoverNote(
  window: {id: string; name: string},
  reason: string,
): void {
  if (toldWindows.has(window.id)) {
    return;
  }
  toldWindows.add(window.id);
  process.stderr.write(
    `acceptance: display leftover: ${window.id} (${window.name === '' ? 'no name' : window.name}) ${reason}, told once by closeLeftoverWindows\n`,
  );
}

/**
 * Closes every window of the launch but `local` that is open, waits until no connection helper runs, and from then on
 * counts no server process that runs on the host now.
 */
export async function closeAllButLocal(): Promise<void> {
  await closeLeftoverWindows();
  await noHelperWithin(60_000);
  leftBefore = await hostServerProcesses();
}

/** Ends the servers of `account` on the host and removes their installs, so that the next connect installs the server afresh. */
export async function freshHost(account = 'harness'): Promise<void> {
  await closeAllButLocal();
  // The bracket keeps pkill's pattern from matching this shell's own command line.
  const folder = DATA_FOLDER.replace('/harness/', `/${account}/`);
  const servers = `${folder.replace('/.', '/[.]')}/bin/`;
  await onHostAs(
    account,
    'sh',
    '-c',
    `pkill -f '${servers}' || true; rm -rf '${folder}/bin' '${folder}/cli'`,
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

/** Adds a copy of the `harness` block named `alias` to the run's ssh_config, and gives the original text back. */
export function addHarnessCopy(alias: string): string {
  const file = variable('HARNESS_SSH_CONFIG');
  const original = readFileSync(file, 'utf8');
  const start = original.indexOf('Host harness\n');
  const block = original.slice(start, original.indexOf('\n\n', start));
  writeFileSync(
    file,
    `${original}\n${block.replace('Host harness', `Host ${alias}`)}\n`,
  );
  return original;
}

/** Puts the run's ssh_config back to `original`. */
export function restoreConfig(original: string): void {
  writeFileSync(variable('HARNESS_SSH_CONFIG'), original);
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

/**
 * Turns the local connection server off and stores the platform of `harness-fish`, or undoes both with `false`. A fish
 * login shell runs none of a piped input before the input ends, so in the default mode it never answers the platform
 * probe and its connect fails at the connect wait, as F-2206 AC-28 says, with or without an entry; in the non-local mode
 * the entry decides the platform and no probe runs (F-2206 7.E5's own workaround). The rows of other features on fish
 * connect so.
 */
export async function fishWithoutProbe(on = true): Promise<void> {
  await setting('remote.SSH.useLocalServer', on ? false : undefined);
  await setting(
    'remote.SSH.remotePlatform',
    on ? {'harness-fish': 'linux'} : undefined,
  );
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
