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

/** The file to open: the configuration's path on this machine. */
export interface PendingEdit {
  configFile: string;
}

function isPendingEdit(value: unknown): value is PendingEdit {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as {configFile?: unknown}).configFile === 'string'
  );
}

/** Keeps `configFile` to be opened in the window that opens `folder` next. */
export function storePendingEdit(
  memento: IntentMemento,
  folder: string,
  configFile: string,
  now: number,
): Promise<void> {
  return storeTimedEntry(memento, PENDING_EDITS_KEY, folder, {configFile}, now);
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
  try {
    const edit = await takePendingEdit(ports.memento, only.fsPath, ports.now());
    if (edit !== undefined) {
      await ports.open(edit.configFile);
    }
  } catch (caught) {
    ports.logger.warn(
      `the configuration file could not be opened: ${caught instanceof Error ? caught.message : String(caught)}`,
    );
  }
}
