/**
 * @fileoverview The launch's script and the held entries' signal files: the atomic append with which a test adds
 * entries between steps, and the signal file whose existence releases a held answer.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

/**
 * One entry a test adds to the launch's script: a surface and a text the question must contain, the answer, and —
 * like a script entry — the window that answers and the signal a held entry waits for.
 */
export interface AppendedEntry {
  surface:
    | 'pick'
    | 'maskedInput'
    | 'textInput'
    | 'platformPick'
    | 'failureDialog'
    | 'notice'
    | 'hostPick'
    | 'filePick'
    | 'mitigationPick'
    | 'licenceModal'
    | 'preconnectDialog';
  match: string;
  answer:
    | 'yes'
    | 'no'
    | 'dismiss'
    | 'linux'
    | 'windows'
    | 'macOS'
    | 'decline'
    | {text: string}
    | {button: string}
    | {label: string}
    | {typed: string};
  window?: string;
  after?: string;
}

/**
 * Adds `entries` to the script at `scriptFile` atomically: the whole new list is written to a temporary file in the
 * same folder and renamed over the script, so a reader that starts mid-write sees the old list or the new one,
 * never a partial write.
 */
export function appendScriptTo(
  scriptFile: string,
  entries: readonly AppendedEntry[],
): void {
  let held: AppendedEntry[] = [];
  if (existsSync(scriptFile)) {
    held =
      (
        JSON.parse(readFileSync(scriptFile, 'utf8')) as {
          entries?: AppendedEntry[];
        }
      ).entries ?? [];
  }
  const tempFile = path.join(
    path.dirname(scriptFile),
    `${path.basename(scriptFile)}.${String(process.pid)}.tmp`,
  );
  writeFileSync(tempFile, JSON.stringify({entries: [...held, ...entries]}));
  renameSync(tempFile, scriptFile);
}

/** The reserved signal name: an answer that must never come. */
const RESERVED_SIGNAL = 'never';

/**
 * Creates the signal file `<signals folder>/<name>`: a held entry that names it answers from then on. The name is
 * letters, digits and hyphens — never the reserved one.
 */
export function signalFile(signalsFolder: string, name: string): void {
  if (name === RESERVED_SIGNAL) {
    throw new Error(
      `the signal name 'never' is reserved for an answer that must never come`,
    );
  }
  mkdirSync(signalsFolder, {recursive: true});
  writeFileSync(path.join(signalsFolder, name), '');
}
