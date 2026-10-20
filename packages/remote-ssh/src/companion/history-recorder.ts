/**
 * @fileoverview The recording of the window's folder or workspace in the folder history, once, when the session's
 * first resolve settles and succeeded.
 */

import type {LastResolve} from 'lib-authority';
import {hostKeyOfAuthority, type HistoryEntry} from 'lib-companion';
import {type HistoryMemento, recordOpened} from './folder-history.ts';

/** A URI as the recorder reads it. */
interface WindowUri {
  scheme: string;
  authority: string;
  path: string;
}

/** What the recorder reads of the window: its workspace file and its folders. */
export interface WindowWorkspace {
  workspaceFile(): WindowUri | undefined;
  workspaceFolders(): readonly WindowUri[];
}

/** The scheme of an address on a remote window's file system. */
const REMOTE_SCHEME = 'vscode-remote';

/** The path without its trailing slashes, except for the root, which stays `/`. */
function pathOf(uri: WindowUri): string {
  return uri.path.replace(/\/+$/, '') || '/';
}

/** The entry this window records, or none: a workspace file, else the one folder, on a `vscode-remote` address. */
export function entryOfWindow(
  workspace: WindowWorkspace,
): {hostKey: string; entry: HistoryEntry} | undefined {
  const file = workspace.workspaceFile();
  const folders = workspace.workspaceFolders();
  const [folder] = folders;
  let source: {uri: WindowUri; kind: HistoryEntry['kind']} | undefined;
  if (file?.scheme === REMOTE_SCHEME) {
    source = {uri: file, kind: 'workspace'};
  } else if (folders.length === 1 && folder?.scheme === REMOTE_SCHEME) {
    source = {uri: folder, kind: 'folder'};
  }
  const hostKey =
    source === undefined ? undefined : hostKeyOfAuthority(source.uri.authority);
  return source === undefined || hostKey === undefined
    ? undefined
    : {hostKey, entry: {path: pathOf(source.uri), kind: source.kind}};
}

/** Records the window's entry once, when the session's first resolve settles and it succeeded. */
export function recordOnFirstResolve(
  resolve: {
    onFirstResolveSettled(listener: () => void): void;
    lastResolve(): LastResolve;
  },
  workspace: WindowWorkspace,
  memento: HistoryMemento,
): void {
  let recorded = false;
  resolve.onFirstResolveSettled(() => {
    const record = entryOfWindow(workspace);
    if (recorded || resolve.lastResolve() !== 'succeeded' || !record) {
      return;
    }
    recorded = true;
    // The history is a convenience: a write that fails is dropped, with no notice and no log line.
    void recordOpened(memento, record.hostKey, record.entry).catch(
      () => undefined,
    );
  });
}
