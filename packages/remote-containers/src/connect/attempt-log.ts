/**
 * @fileoverview The log of the connect attempt that is running or has failed: the lines of the Dev Containers log since
 * the attempt's phase began, kept as the log shows them (masked), and written to a file of the extension's log folder
 * when a failure dialog is about to show, so that Edit devcontainer.json Locally can open it beside the configuration.
 */

import {mkdir, readdir, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {defaultFormat, type LogLine, type Sink} from 'lib-log';

/** How many lines of an attempt are kept: the newest. */
const ATTEMPT_LINE_LIMIT = 5000;

/** How many attempt files stay in the folder: the newest. */
const ATTEMPT_FILE_LIMIT = 10;

const FILE_PREFIX = 'dev-containers-attempt-';
const FILE_SUFFIX = '.log';

/** A sink that keeps the lines of the current attempt. */
export interface AttemptLog extends Sink {
  /** Starts a new attempt: the lines kept so far are dropped. */
  begin(): void;
  /** The lines of the attempt, formatted as the log channel shows them. */
  lines(): readonly string[];
}

/** The attempt log, over the lines the logger passes after it has masked them. */
export function createAttemptLog(): AttemptLog {
  let kept: string[] = [];
  return {
    write: (line: LogLine) => {
      kept.push(defaultFormat(line));
      if (kept.length > ATTEMPT_LINE_LIMIT) {
        kept = kept.slice(-ATTEMPT_LINE_LIMIT);
      }
    },
    begin: () => {
      kept = [];
    },
    lines: () => kept,
  };
}

/** The time of a file name: `yyyymmddThhmmss` in UTC. */
function stamp(now: number): string {
  return new Date(now).toISOString().replace(/[-:]/g, '').slice(0, 15);
}

/**
 * Writes the attempt's lines to `<folder>/dev-containers-attempt-<time>.log`, keeps the newest
 * {@link ATTEMPT_FILE_LIMIT} such files and gives the new file's path.
 */
export async function writeAttemptLog(
  attempt: AttemptLog,
  folder: string,
  now: number,
): Promise<string> {
  await mkdir(folder, {recursive: true});
  const file = path.join(folder, `${FILE_PREFIX}${stamp(now)}${FILE_SUFFIX}`);
  await writeFile(
    file,
    attempt
      .lines()
      .map(line => `${line}\n`)
      .join(''),
  );
  const attempts = (await readdir(folder))
    .filter(name => name.startsWith(FILE_PREFIX) && name.endsWith(FILE_SUFFIX))
    .sort();
  await Promise.all(
    attempts
      .slice(0, -ATTEMPT_FILE_LIMIT)
      .map(name => rm(path.join(folder, name), {force: true})),
  );
  return file;
}
