/**
 * @fileoverview The log files of the extension: their names, the pick that lists them, the previous activation's file,
 * and the level the `dev.containers.logLevel` setting asks for. All pure.
 */

/** The two kinds of log file an activation writes. */
export type LogFileKind = 'remoteContainers' | 'shutdownMonitor';

/** A log file of the profile: its kind and the start of the activation that wrote it, as its name has it. */
export interface LogFileName {
  kind: LogFileKind;
  /** The activation's start as the name holds it: ISO-8601 UTC with `:` replaced by `-` and the fractional dot kept. */
  start: string;
}

/** A log file found on disk. */
export interface LogFile extends LogFileName {
  /** The file's absolute path. */
  file: string;
  /** Its size in bytes when the pick opened. */
  size: number;
}

/** A row of the pick that lists the log files. */
export interface LogChoice {
  label: string;
  description: string;
  file: string;
}

/** The name of a log file of `kind` for an activation that started at `start`. */
export function logFileNameOf(kind: LogFileKind, start: Date): string {
  return `${kind}-${logStartOf(start)}.log`;
}

/** The start of an activation as a log file name holds it. */
export function logStartOf(start: Date): string {
  return start.toISOString().replaceAll(':', '-');
}

const LOG_NAME =
  /^(remoteContainers|shutdownMonitor)-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z)\.log$/u;

/** What a file name says, or none when it is no log file of ours. */
export function parseLogFileName(name: string): LogFileName | undefined {
  const match = LOG_NAME.exec(name);
  const kind = match?.[1];
  const start = match?.[2];
  return (kind === 'remoteContainers' || kind === 'shutdownMonitor') &&
    start !== undefined
    ? {kind, start}
    : undefined;
}

/** The time a log file name's start stands for. */
function timeOfStart(start: string): Date {
  return new Date(start.replace(/T(\d{2})-(\d{2})-(\d{2})/u, 'T$1:$2:$3'));
}

/** Two digits. */
function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

/** A file's start in local time as the pick shows it: `yyyy-MM-dd HH:mm:ss`. */
export function localStartOf(start: string): string {
  const time = timeOfStart(start);
  const day = `${String(time.getFullYear())}-${twoDigits(time.getMonth() + 1)}-${twoDigits(time.getDate())}`;
  return `${day} ${twoDigits(time.getHours())}:${twoDigits(time.getMinutes())}:${twoDigits(time.getSeconds())}`;
}

/**
 * The rows of the pick for `files`, newest name timestamp first (never the modification time), the label the kind, the
 * description the local start and the size in bytes with no digit grouping. Files of one start order by their path.
 */
export function logChoicesOf(files: readonly LogFile[]): LogChoice[] {
  return [...files]
    .sort((left, right) =>
      left.start === right.start
        ? left.file.localeCompare(right.file)
        : right.start.localeCompare(left.start),
    )
    .map(each => ({
      label: each.kind,
      description: `${localStartOf(each.start)} - ${String(each.size)} bytes`,
      file: each.file,
    }));
}

/**
 * The newest `remoteContainers` file that is not the current activation's, whose start is `current`; none when there is
 * no other. A `shutdownMonitor` file is never the answer.
 */
export function previousLogOf(
  files: readonly LogFile[],
  current: string,
): LogFile | undefined {
  return files
    .filter(each => each.kind === 'remoteContainers' && each.start !== current)
    .sort((left, right) => right.start.localeCompare(left.start))[0];
}

/** The level the CLI is run at. */
export type LogLevel = 'info' | 'debug' | 'trace';

/**
 * The level the setting asks for: `info`, `debug` and `trace` exactly as written; any other non-empty string is `info`;
 * an empty string, `null` or a missing value is `debug`. Nothing reports a value that is ignored.
 */
export function logLevelOf(value: unknown): LogLevel {
  if (value === 'info' || value === 'debug' || value === 'trace') {
    return value;
  }
  return typeof value === 'string' && value !== '' ? 'info' : 'debug';
}
