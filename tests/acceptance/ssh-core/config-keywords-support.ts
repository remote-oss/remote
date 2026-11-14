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
  openWindow,
  readUserSettings,
  recordLines,
  restoreUserSettings,
  userSettings,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {dismissals} from '../windows/maintenance.ts';
import {notifications, statusItem} from '../windows/renderer.ts';

const execFileAsync = promisify(execFile);

/** The alias of every entry the rows write. */
export const ALIAS = 'c2593';

/** The lines of the run's `Host harness` block, without its `Host` line. */
function harnessLines(): string[] {
  const lines = readFileSync(variable('HARNESS_SSH_CONFIG'), 'utf8').split(
    '\n',
  );
  const start = lines.indexOf('Host harness');
  const rest = lines.slice(start + 1);
  const end = rest.findIndex(line => !line.startsWith(' '));
  return rest.slice(0, end === -1 ? rest.length : end);
}

/** Writes the file `label` of the run with the entry of {@link ALIAS}: the harness host's lines, then `extra`. */
export function entryFile(label: string, extra: readonly string[]): string {
  const file = path.join(
    variable('HARNESS_RUN_FOLDER'),
    `c2593-${label}.config`,
  );
  writeFileSync(
    file,
    [
      `Host ${ALIAS}`,
      ...harnessLines(),
      ...extra.map(line => `  ${line}`),
      '',
    ].join('\n'),
  );
  return file;
}

/** What plain `ssh -F <file> <alias> true` did: its exit status and what it wrote to stderr. */
export async function plainSsh(
  file: string,
): Promise<{status: number; stderr: string}> {
  try {
    await execFileAsync('ssh', ['-F', file, ALIAS, 'true']);
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
}

/** The time a failing connect has to show its dialog. */
const DIALOG_MILLISECONDS = 120_000;

/**
 * Connects window `name` to the entry written from `extra` with the setting pointing at its file, waits for the window to
 * connect or for its failure dialog, and gives what `body` makes of it before the window closes and the settings return.
 */
export async function connectWith<Result>(
  name: string,
  extra: readonly string[],
  expectation: 'connects' | 'fails',
  body: (outcome: Outcome, file: string) => Result | Promise<Result>,
): Promise<Result> {
  const file = entryFile(name, extra);
  const saved = readUserSettings();
  await userSettings({'remote.SSH.configFile': file});
  const mark = Date.now();
  try {
    appendScript(dismissals(name));
    await openWindow(ALIAS, name);
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
      },
      file,
    );
  } finally {
    await closeWindow(name).catch(() => undefined);
    restoreUserSettings(saved);
  }
}

/** The failure dialogs window `name` showed from `mark` (milliseconds) on. */
function shownFrom(name: string, mark: number) {
  return recordLines('failureDialog', name).filter(line => line.time >= mark);
}
