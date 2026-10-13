/**
 * @fileoverview The test side of remote-ssh's scripted adapters: the script a connect is answered from, and the
 * record of what it was asked.
 */

import {existsSync, readFileSync, writeFileSync} from 'node:fs';

/** One expected question and its answer, in the order the test expects them. */
export type ScriptEntry = (
  | {surface: 'pick'; match: string; answer: 'yes' | 'no' | 'dismiss'}
  | {surface: 'maskedInput'; match: string; answer: {text: string} | 'dismiss'}
  | {
      surface: 'notice';
      match: string;
      answer: {button: string} | 'dismiss';
    }
  | {
      surface: 'platformPick';
      match: string;
      answer: 'linux' | 'windows' | 'macOS' | 'dismiss';
    }
  | {
      surface: 'failureDialog';
      match: string;
      answer: {button: string} | 'dismiss';
    }
  | {surface: 'mitigationPick'; match: string; answer: string}
  | {surface: 'licenceModal'; match: string; answer: 'decline' | 'dismiss'}
) & {
  /** The window that answers; an entry without one is answered once by each window. */
  window?: string;
};

/** One line of the record: the question as asked, and what the adapter answered. */
export interface RecordLine {
  /** A question's surface, or `progress` or `downloadProgress` for a display-only line. */
  surface: ScriptEntry['surface'] | 'progress' | 'downloadProgress';
  question: string;
  answer: string;
  matched: boolean;
  /** Whether the progress message carried the details link; only the phase lines of a `progress` surface have it. */
  details?: boolean;
  /** The name of the window that wrote the line. */
  window: string;
  /** The time of the line's append. */
  time: number;
  /** The labels the failure dialog was shown with, in order; only the lines of a `failureDialog` surface have it. */
  buttons?: string[];
}

/** The lines of a record file; a record not written yet is empty. */
export function readRecord(recordFile: string): RecordLine[] {
  if (!existsSync(recordFile)) {
    return [];
  }
  return readFileSync(recordFile, 'utf8')
    .split('\n')
    .filter(line => line !== '')
    .map(line => JSON.parse(line) as RecordLine);
}

/** The file the harness names in `variable`; throws when the tests run outside the harness. */
function fileNamed(variable: string): string {
  const file = process.env[variable];
  if (file === undefined || file === '') {
    throw new Error(`${variable} is not set; run the tests with the harness`);
  }
  return file;
}

/** What a test reads back about a script: the record, and whether every entry was used. */
export interface ScriptRun {
  record(): RecordLine[];
  /** Throws when an entry of the script was not used by a question. */
  assertAllUsed(): void;
}

/** The run of `entries`, recorded in `recordFile`; a record not written yet is empty. */
function runOf(entries: readonly ScriptEntry[], recordFile: string): ScriptRun {
  function record(): RecordLine[] {
    return readRecord(recordFile);
  }
  return {
    record,
    assertAllUsed: () => {
      const used = record().filter(line => line.matched).length;
      if (used < entries.length) {
        throw new Error(
          `${String(entries.length - used)} of ${String(entries.length)} script entries were not used`,
        );
      }
    },
  };
}

/**
 * Writes the script for the next connect and empties the record. The extension reads the script when it activates,
 * once per window, so a test writes it before it opens the window that connects. Each entry the adapters use adds
 * one matched line to the record, so `assertAllUsed` counts the unused entries from it.
 */
export function scriptFor(entries: ScriptEntry[]): ScriptRun {
  writeFileSync(
    fileNamed('REMOTE_OSS_ACCEPTANCE_SCRIPT'),
    JSON.stringify({entries}),
  );
  const recordFile = fileNamed('REMOTE_OSS_ACCEPTANCE_RECORD');
  writeFileSync(recordFile, '');
  return runOf(entries, recordFile);
}

/** The script this window was launched with, which the harness wrote before the editor started. */
export function launchScript(): ScriptRun {
  const {entries} = JSON.parse(
    readFileSync(fileNamed('REMOTE_OSS_ACCEPTANCE_SCRIPT'), 'utf8'),
  ) as {entries: ScriptEntry[]};
  return runOf(entries, fileNamed('REMOTE_OSS_ACCEPTANCE_RECORD'));
}
