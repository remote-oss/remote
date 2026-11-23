/**
 * @fileoverview What C2 knows of Docker Desktop on each host: where it is installed, how it is started and its process
 * listed, which error texts of the CLI mean that the daemon is not up yet, and how long a failed check waits for it.
 * The start's program, arguments and paths come from this table alone, never from a setting, and are spawned with an
 * argument list and no shell.
 */

/** How many times, or for how long, a failed check is repeated. */
export type RecheckBound =
  {kind: 'count'; limit: number} | {kind: 'time'; limit: number};

/** What one host's Docker Desktop is started, found and waited for with. */
export interface DesktopData {
  /** Where the application is installed. */
  application: string;
  /** The program that starts it in the background, and its arguments. */
  start: {program: string; parameters: readonly string[]};
  /** The program that lists its process, its arguments, and the name the listing holds when it runs. */
  listing: {
    program: string;
    parameters: readonly string[];
    processName: string;
  };
  /** How often a failed check is repeated, in milliseconds. */
  recheckIntervalMilliseconds: number;
  /** The bound of the re-checks when the application was already running, and when this check started it. */
  rechecks: {running: RecheckBound; started: RecheckBound};
}

/** The words of the CLI's errors that mean the daemon is not up, in lower case. */
const DAEMON_DOWN_TEXTS: readonly string[] = [
  'failed to connect to the docker api',
  'cannot connect to the docker daemon',
];

const INTERVAL = 5000;
const SIX_CHECKS: RecheckBound = {kind: 'count', limit: 6};
const FIVE_MINUTES: RecheckBound = {kind: 'time', limit: 5 * 60 * 1000};

/** The table: macOS starts the application in the background, Windows runs the installed program; Linux has none. */
const DESKTOP_DATA: Readonly<Record<string, DesktopData>> = {
  darwin: {
    application: '/Applications/Docker.app',
    start: {
      program: '/usr/bin/open',
      parameters: ['--background', '-a', 'Docker'],
    },
    listing: {
      program: '/usr/bin/pgrep',
      parameters: ['-lx', 'Docker Desktop'],
      processName: 'Docker Desktop',
    },
    recheckIntervalMilliseconds: INTERVAL,
    rechecks: {running: SIX_CHECKS, started: SIX_CHECKS},
  },
  win32: {
    application: 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe',
    start: {
      program: 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe',
      parameters: [],
    },
    listing: {
      program: 'C:\\Windows\\System32\\tasklist.exe',
      parameters: [
        '/FI',
        'IMAGENAME eq Docker Desktop.exe',
        '/FO',
        'CSV',
        '/NH',
      ],
      processName: 'Docker Desktop.exe',
    },
    recheckIntervalMilliseconds: INTERVAL,
    rechecks: {running: SIX_CHECKS, started: FIVE_MINUTES},
  },
};

/** The data of the host `platform` (a value of `process.platform`); none for a host with no automatic start. */
export function desktopDataOf(platform: string): DesktopData | undefined {
  return Object.hasOwn(DESKTOP_DATA, platform)
    ? DESKTOP_DATA[platform]
    : undefined;
}

/** Whether the error text of a failed check says that the daemon is not up. */
export function daemonDownText(errorText: string): boolean {
  const lower = errorText.toLowerCase();
  return DAEMON_DOWN_TEXTS.some(words => lower.includes(words));
}

/**
 * Whether a failed check starts Docker Desktop: the host has start data, the application is installed, and the error
 * says the daemon is not up.
 */
export function shouldStartDesktop(
  data: DesktopData | undefined,
  installed: boolean,
  errorText: string,
): boolean {
  return data !== undefined && installed && daemonDownText(errorText);
}

/** The bound of the re-checks: the one for an application already running, or the one for an application this check started. */
export function recheckBoundOf(
  data: DesktopData,
  startedByThisCheck: boolean,
): RecheckBound {
  return startedByThisCheck ? data.rechecks.started : data.rechecks.running;
}

/**
 * Whether one more re-check may run, after `done` re-checks and `elapsedMilliseconds` since the start. A count allows
 * `limit` re-checks; a time allows a re-check while the time since the start is within the limit.
 */
export function mayRecheck(
  bound: RecheckBound,
  done: number,
  elapsedMilliseconds: number,
): boolean {
  return bound.kind === 'count'
    ? done < bound.limit
    : elapsedMilliseconds <= bound.limit;
}
