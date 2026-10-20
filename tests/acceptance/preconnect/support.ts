import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import type {AppendedEntry} from '../../../tools/script-file.ts';
import {
  connectedWithin,
  connectionLog,
  openWindow,
  readUserSettings,
  recordLines,
  restoreUserSettings,
  type RecordLine,
  userSettings,
  variable,
  waitFor,
} from '../windows/harness.ts';

/** The setting that names the script. */
export const SETTING = 'remote.SSH.preconnect';

/** The words both messages of the dialog hold, which the entries match. */
const QUESTION = 're-connection script';

/** The folder of the run that holds the rows' scripts and their markers. */
export function fixtureFolder(): string {
  const folder = path.join(variable('HARNESS_RUN_FOLDER'), 'f2108');
  mkdirSync(folder, {recursive: true});
  return folder;
}

/**
 * Writes the executable script `name` in the fixture folder, whose body gets `MARKER` as the file it writes its
 * findings to, and gives its path.
 */
export function writeScript(name: string, body: string, mode = 0o755): string {
  const file = path.join(fixtureFolder(), name);
  writeFileSync(
    file,
    `#!/bin/sh\nMARKER=${JSON.stringify(`${file}.marker`)}\n${body}\n`,
  );
  chmodSync(file, mode);
  return file;
}

/** What the script wrote to its marker, or nothing when it did not run. */
export function markerOf(file: string): string | undefined {
  const marker = `${file}.marker`;
  return existsSync(marker) ? readFileSync(marker, 'utf8') : undefined;
}

/** The entry that answers the dialog of window `window` with `button`, or dismisses it. */
export function answerEntry(window: string, button: string): AppendedEntry {
  return {
    surface: 'preconnectDialog',
    match: QUESTION,
    answer: button === 'dismiss' ? 'dismiss' : {button},
    window,
  };
}

/** The dialog lines of window `window` in the record. */
export function dialogLines(window: string): RecordLine[] {
  return recordLines('preconnectDialog', window);
}

/** Runs `body` with `remote.SSH.preconnect` set to `value`, and gives the user settings back at its end. */
export async function withSetting<Result>(
  value: unknown,
  body: () => Promise<Result>,
): Promise<Result> {
  const saved = readUserSettings();
  await userSettings({[SETTING]: value});
  try {
    return await body();
  } finally {
    restoreUserSettings(saved);
  }
}

/** Opens window `name` on the host `alias` and waits until it is connected. */
export async function openConnected(
  name: string,
  alias = 'harness',
): Promise<void> {
  await openWindow(alias, name);
  await connectedWithin(name, 120_000);
}

/** The entries that dismiss the failure dialog of window `window` and the pick of actions after it. */
export {dismissals} from '../windows/maintenance.ts';

/** Opens window `name` on `harness` and waits for its failure dialog; gives that dialog's record line. */
export async function failureOf(
  name: string,
  alias = 'harness',
  milliseconds = 120_000,
): Promise<RecordLine> {
  await openWindow(alias, name);
  await waitFor(
    `the failure dialog of ${name}`,
    () => recordLines('failureDialog', name).length > 0,
    milliseconds,
  );
  const [line] = recordLines('failureDialog', name);
  if (line === undefined) {
    throw new Error(`${name} showed no failure dialog`);
  }
  return line;
}

/** The lines of the connection log written after the first `mark` lines. */
export function logSince(mark: number): string[] {
  return connectionLog().slice(mark);
}
