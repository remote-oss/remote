/**
 * @fileoverview The test side of remote-ssh's scripted adapters: the script a connect is answered from, and the
 * record of what it was asked.
 */

import {readFileSync, writeFileSync} from 'node:fs';

/** One expected question and its answer, in the order the test expects them. */
export type ScriptEntry =
  | {surface: 'pick'; match: string; answer: 'yes' | 'no' | 'dismiss'}
  | {surface: 'maskedInput'; match: string; answer: {text: string} | 'dismiss'}
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
  | {surface: 'licenceModal'; match: string; answer: 'decline' | 'dismiss'};

/** One line of the record: the question as asked, and what the adapter answered. */
export interface RecordLine {
  surface: ScriptEntry['surface'];
  question: string;
  answer: string;
  matched: boolean;
}

/** The file the harness names in `variable`; throws when the tests run outside the harness. */
function fileNamed(variable: string): string {
  const file = process.env[variable];
  if (file === undefined || file === '') {
    throw new Error(`${variable} is not set; run the tests with the harness`);
  }
  return file;
}

/**
 * Writes the script for the next connect and empties the record. The extension reads the script when it activates,
 * once per window, so a test writes it before it opens the window that connects.
 */
export function scriptFor(entries: ScriptEntry[]): {record(): RecordLine[]} {
  writeFileSync(
    fileNamed('REMOTE_OSS_ACCEPTANCE_SCRIPT'),
    JSON.stringify({entries}),
  );
  const recordFile = fileNamed('REMOTE_OSS_ACCEPTANCE_RECORD');
  writeFileSync(recordFile, '');
  return {
    record: () =>
      readFileSync(recordFile, 'utf8')
        .split('\n')
        .filter(line => line !== '')
        .map(line => JSON.parse(line) as RecordLine),
  };
}
