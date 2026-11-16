/**
 * @fileoverview What the rows of F-2109 (card #2593) share: a host entry of their own, written from the run's
 * `Host harness` block plus the keywords under test, plain `ssh` run against it as the comparison, and the outcome of a
 * window that connects to it.
 */

import {execFile} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  appendScript,
  closeWindow,
  connectedWithin,
  connectionLog,
  openWindow,
  readUserSettings,
  recordLines,
  restoreUserSettings,
  userSettings,
  variable,
  waitFor,
} from './harness.ts';
import {dismissals} from './maintenance.ts';
import {
  indicatorDisconnects,
  notifications,
  statusItem,
  windowTitle,
} from './renderer.ts';

const execFileAsync = promisify(execFile);

/** The modes of the extension: the local connection server, and one `ssh` of its own per window. */
export const MODES = [
  {mode: 'server', settings: {}},
  {
    mode: 'terminal',
    settings: {'remote.SSH.useLocalServer': false},
  },
] as const;

/** The lines of the run's block of host `base`, without its `Host` line. */
function blockLines(base: string): string[] {
  const lines = readFileSync(variable('HARNESS_SSH_CONFIG'), 'utf8').split(
    '\n',
  );
  const start = lines.indexOf(`Host ${base}`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex(line => !line.startsWith(' '));
  return rest.slice(0, end === -1 ? rest.length : end);
}

/** The block of host `alias`: the lines of the run's block `base` but those of `without`, then `extra`. */
export function hostBlock(
  alias: string,
  extra: readonly string[],
  without: readonly string[] = [],
  base = 'harness',
): string[] {
  return [
    `Host ${alias}`,
    ...blockLines(base).filter(
      line => !without.includes(line.trim().split(' ')[0] ?? ''),
    ),
    ...extra.map(line => `  ${line}`),
    '',
  ];
}

/**
 * Writes the file `name` of the run from `blocks`, each the lines of a `Host` block, and gives its path. The run's
 * shared known-hosts file is replaced by one of the row's own: other rows of the launch write host keys to the shared
 * one, and a key they left for an address of this row's hops would fail the row for a reason that is not its own.
 */
export function writeConfig(
  name: string,
  blocks: ReadonlyArray<readonly string[]>,
): string {
  const folder = variable('HARNESS_RUN_FOLDER');
  const file = path.join(folder, `${name}.config`);
  const own = path.posix.join(folder, `${name}.hosts`);
  writeFileSync(
    file,
    blocks
      .flat()
      .map(line =>
        /^\s+UserKnownHostsFile\s+\S+\/known_hosts$/u.test(line)
          ? line.replace(/\S+$/u, own)
          : line,
      )
      .join('\n'),
  );
  return file;
}

/** Writes the file of the run for alias `alias` with its entry: the harness host's lines, then `extra`. */
function entryFile(
  alias: string,
  extra: readonly string[],
  without: readonly string[] = [],
  hosts: readonly string[] = [],
): string {
  return writeConfig(alias, [
    hostBlock(alias, extra, without),
    ...hosts.map(host => [`Host ${host}`, '  HostName 127.0.0.1', '']),
  ]);
}

/**
 * The `ssh` the launch's Remote - SSH runs: the `remote.SSH.path` of the launch's user settings, or the `ssh` on the
 * PATH when they name none, so that a row's plain `ssh` is the product's.
 */
export function launchSsh(): string {
  const text = readUserSettings();
  const named =
    text === undefined
      ? undefined
      : (JSON.parse(text) as Record<string, unknown>)['remote.SSH.path'];
  return typeof named === 'string' && named !== '' ? named : 'ssh';
}

/** What plain `ssh -F <file> <alias> true`, with the launch's `ssh`, did: its exit status and what it wrote to stderr. */
export async function plainSsh(
  file: string,
  alias: string,
): Promise<{status: number; stderr: string}> {
  try {
    await execFileAsync(launchSsh(), ['-F', file, alias, 'true']);
    return {status: 0, stderr: ''};
  } catch (caught) {
    const failure = caught as {code?: number; stderr?: string};
    return {status: failure.code ?? 1, stderr: failure.stderr ?? ''};
  }
}

/** What the user sees of a window after its connect: connected, the remote indicator, the toasts and the failure dialog. */
export interface Outcome {
  connected: boolean;
  indicator: string;
  toasts: string[];
  dialog: string | undefined;
  buttons: string[] | undefined;
  progress: string[];
  /** The lines the connection log gained from the start of this connect, and no earlier ones. */
  connectLog: string[];
  /** When the failure dialog was shown, in milliseconds since the epoch. */
  dialogTime: number | undefined;
  /** The window's title. */
  title: string;
  /** Milliseconds from the first progress line to the failure dialog; undefined when there was no dialog. */
  failedAfter: number | undefined;
  /** The text of the user settings right after the row set them, and when the connect ended. */
  settingsBefore: string | undefined;
  settingsAfter: string | undefined;
}

/** What a row may change of its connect: settings it sets, keywords of the harness entry it leaves out, answers it scripts. */
export interface ConnectOptions {
  /** A file the row wrote itself, in place of the entry written from `extra`. */
  file?: string;
  settings?: Readonly<Record<string, unknown>>;
  without?: readonly string[];
  /** Aliases of further hosts the file holds after the entry. */
  hosts?: readonly string[];
  script?: Parameters<typeof appendScript>[0];
}

/** The time a failing connect has to show its dialog. */
const DIALOG_MILLISECONDS = 120_000;

/**
 * Connects window `name`, whose name is also the alias of its entry, to the entry written from `extra` with the setting pointing at its file, waits for the window to
 * connect or for its failure dialog, and gives what `body` makes of it before the window closes and the settings return.
 */
export async function connectWith<Result>(
  name: string,
  extra: readonly string[],
  expectation: 'connects' | 'fails',
  body: (outcome: Outcome, file: string) => Result | Promise<Result>,
  options: ConnectOptions = {},
): Promise<Result> {
  const file =
    options.file ?? entryFile(name, extra, options.without, options.hosts);
  const saved = readUserSettings();
  await userSettings({'remote.SSH.configFile': file, ...options.settings});
  const settingsBefore = readUserSettings();
  const mark = Date.now();
  const logMark = connectionLog().length;
  try {
    appendScript(options.script ?? dismissals(name));
    await openWindow(name, name);
    if (expectation === 'connects') {
      await connectedWithin(name, 120_000);
    } else {
      await waitFor(
        `the failure dialog of ${name}`,
        () => shownFrom(name, mark).length > 0,
        DIALOG_MILLISECONDS,
      );
    }
    const dialog = shownFrom(name, mark)[0];
    if (expectation === 'fails') {
      await indicatorDisconnects(name);
    }
    return await body(
      {
        connected: expectation === 'connects',
        indicator: (await statusItem(name, 'status.host')).text,
        toasts: await notifications(name),
        dialog: dialog?.question,
        buttons: dialog?.buttons,
        progress: recordLines('progress', name)
          .filter(line => line.time >= mark)
          .map(line => line.question),
        connectLog: connectionLog().slice(logMark),
        dialogTime: dialog?.time,
        title: await windowTitle(name),
        failedAfter:
          dialog === undefined
            ? undefined
            : dialog.time -
              (recordLines('progress', name).find(line => line.time >= mark)
                ?.time ?? mark),
        settingsBefore,
        settingsAfter: readUserSettings(),
      },
      file,
    );
  } catch (caught) {
    const seen = recordLines(undefined, name)
      .map(
        line =>
          `${line.surface}: ${line.question.slice(0, 80)} -> ${line.answer}`,
      )
      .join('\n');
    throw new Error(`${String(caught)}\nwhat the window asked:\n${seen}`, {
      cause: caught,
    });
  } finally {
    await closeWindow(name).catch(() => undefined);
    restoreUserSettings(saved);
  }
}

/** The failure dialogs window `name` showed from `mark` (milliseconds) on. */
function shownFrom(name: string, mark: number) {
  return recordLines('failureDialog', name).filter(line => line.time >= mark);
}

/** How many times the connection log says a window resolved `alias` to a local port, which it does once it is connected. */
export function resolvedCount(alias: string): number {
  return connectionLog().filter(line =>
    line.includes(`Resolved ssh-remote+${alias} to local port`),
  ).length;
}
