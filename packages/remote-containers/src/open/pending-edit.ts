/**
 * @fileoverview The configuration file that Edit Locally wants open in the window it switches to: kept in
 * `globalState` under the local folder, with the time, and taken once when the extension activates there.
 */

import type {Logger} from 'lib-log';
import {
  type IntentMemento,
  storeTimedEntry,
  takeTimedEntry,
} from '../state/timed-store.ts';

/** The extension's own key in `globalState`; it is not synced. */
export const PENDING_EDITS_KEY = 'remote-oss.remote-containers.pendingEdits';

/** The files to open: the configuration's path on this machine, and the failed attempt's log when one was written. */
export interface PendingEdit {
  configFile: string;
  logFile?: string;
}

function isPendingEdit(value: unknown): value is PendingEdit {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as {configFile?: unknown}).configFile === 'string' &&
    ['undefined', 'string'].includes(
      typeof (value as {logFile?: unknown}).logFile,
    )
  );
}

/** Keeps `configFile`, and the attempt's `logFile` when there is one, to be opened in the window that opens `folder` next. */
export function storePendingEdit(
  memento: IntentMemento,
  folder: string,
  configFile: string,
  now: number,
  logFile?: string,
): Promise<void> {
  return storeTimedEntry(
    memento,
    PENDING_EDITS_KEY,
    folder,
    logFile === undefined ? {configFile} : {configFile, logFile},
    now,
  );
}

/** The file to open for `folder`, once; undefined when none was kept or it expired. */
export async function takePendingEdit(
  memento: IntentMemento,
  folder: string,
  now: number,
): Promise<PendingEdit | undefined> {
  const taken = await takeTimedEntry(
    memento,
    PENDING_EDITS_KEY,
    folder,
    now,
    isPendingEdit,
  );
  return taken?.value;
}

/** What the activation reads of the window and opens. */
export interface PendingEditPorts {
  memento: IntentMemento;
  /** The name of the remote the window is on; none for a local window. */
  remoteName(): string | undefined;
  folders(): ReadonlyArray<{scheme: string; fsPath: string}>;
  now(): number;
  /** Opens a file of this machine in the window. */
  open(file: string): PromiseLike<unknown>;
  /** Opens the failed attempt's log in a second, unfocused group beside the configuration. */
  openLog(file: string): PromiseLike<unknown>;
  /** Whether a file of this machine exists. */
  exists(file: string): PromiseLike<boolean>;
  logger: Logger;
}

/** Opens the file that Edit Locally kept for this window's folder, once: a local window with one `file` folder only. */
export async function openPendingEdit(ports: PendingEditPorts): Promise<void> {
  const folders = ports.folders();
  const [only] = folders;
  if (
    ports.remoteName() !== undefined ||
    folders.length !== 1 ||
    only?.scheme !== 'file'
  ) {
    return;
  }
  let edit: PendingEdit | undefined;
  try {
    edit = await takePendingEdit(ports.memento, only.fsPath, ports.now());
  } catch (caught) {
    ports.logger.warn(
      `the pending edit could not be read: ${caught instanceof Error ? caught.message : String(caught)}`,
    );
  }
  if (edit === undefined) {
    return;
  }
  // The log opens even when the configuration is gone, and the configuration opens first so the log leaves its focus.
  await attempt(ports, 'the configuration file', edit.configFile, file =>
    ports.open(file),
  );
  const {logFile} = edit;
  if (logFile !== undefined && (await ports.exists(logFile))) {
    await attempt(ports, "the failed attempt's log", logFile, file =>
      ports.openLog(file),
    );
  }
}

/** Opens `file` with `open`; a failure is only logged, naming `what`. */
async function attempt(
  ports: PendingEditPorts,
  what: string,
  file: string,
  open: (file: string) => PromiseLike<unknown>,
): Promise<void> {
  try {
    await open(file);
  } catch (caught) {
    ports.logger.warn(
      `${what} could not be opened: ${caught instanceof Error ? caught.message : String(caught)}`,
    );
  }
}
