/**
 * @fileoverview The configuration file that Edit Locally wants open in the window it switches to: kept in
 * one file of the extension's own storage for the local folder, taken once when the extension activates there.
 */

import type {Logger} from 'lib-log';
import {
  type HandoffKind,
  leaveHandoff,
  takeHandoff,
} from '../state/handoffs.ts';

/** The key under which an earlier version kept the pending edits in the global state. */
export const PENDING_EDITS_KEY = 'remote-oss.remote-containers.pendingEdits';

/** The files to open: the configuration's path on this machine, and the failed attempt's log when one was written. */
export interface PendingEdit {
  configFile: string;
  logFile?: string;
}

/** Whether `value` is what a pending edit holds. */
export function isPendingEdit(value: unknown): value is PendingEdit {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as {configFile?: unknown}).configFile === 'string' &&
    ['undefined', 'string'].includes(
      typeof (value as {logFile?: unknown}).logFile,
    )
  );
}

/** The handoffs of pending edits. */
export type PendingEditHandoffs = HandoffKind<PendingEdit>;

/** Keeps `configFile`, and the attempt's `logFile` when there is one, to be opened in the window that opens `folder` next. */
export function storePendingEdit(
  handoffs: PendingEditHandoffs,
  folder: string,
  configFile: string,
  logFile?: string,
): Promise<void> {
  return leaveHandoff(
    handoffs,
    folder,
    logFile === undefined ? {configFile} : {configFile, logFile},
  );
}

/** The file to open for `folder`, once; undefined when none was kept or it expired. */
export function takePendingEdit(
  handoffs: PendingEditHandoffs,
  folder: string,
): PendingEdit | undefined {
  return takeHandoff(handoffs, folder)?.value;
}

/** What the activation reads of the window and opens. */
export interface PendingEditPorts {
  handoffs: PendingEditHandoffs;
  /** The name of the remote the window is on; none for a local window. */
  remoteName(): string | undefined;
  folders(): ReadonlyArray<{scheme: string; fsPath: string}>;
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
    edit = takePendingEdit(ports.handoffs, only.fsPath);
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
