/**
 * @fileoverview The check of a saved workspace's folder list before Reopen in Container goes on: the first
 * problem of the list is shown in one modal, whose Continue goes on as if there were none and whose Cancel stops.
 */

import path from 'node:path';
import {type ParseError, parse} from 'jsonc-parser';
import type {Translate} from '../surfaces/engine-dialogs.ts';
import {filled} from '../surfaces/filled.ts';

/** The English text of each message the check gives, by its string id. */
const WORKSPACE_FOLDER_TEMPLATES = {
  S185: "Folder '{0}' is not a subfolder of shared root folder '{1}'.",
  S279: 'Problems loading workspace file {0}: {1}',
  S363: 'The workspace could fail to open in a container: {0}',
  S406: 'Workspace contains a folder that defines neither a path nor a URI.',
  S407: "Workspace contains an absolute folder path '{0}'.",
  S408: "Workspace contains folder '{0}' not on the local file system.",
  S409: 'Workspace does not define any folders',
} as const;

/** What reading the workspace file gave: its text, or why it could not be read. */
export type WorkspaceRead =
  {kind: 'text'; text: string} | {kind: 'unreadable'; message: string};

/** What the check reads and asks. */
export interface WorkspaceFolderPorts {
  /** The text of a workspace file, or why it cannot be read. */
  readWorkspaceFile(file: string): PromiseLike<WorkspaceRead>;
  /** Shows a modal information dialog with the detail `text` and the buttons Cancel and Continue; whether Continue was chosen. */
  confirmModal(text: string): PromiseLike<boolean>;
  translate: Translate;
}

/** The scheme of an address as written, none for a text that has none. */
function schemeOf(address: string): string | undefined {
  return /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(address)?.[1];
}

/** Whether a path is absolute in the form of this machine or in a Windows one (a drive or a UNC path). */
function isAbsolute(candidate: string): boolean {
  return path.isAbsolute(candidate) || path.win32.isAbsolute(candidate);
}

/** The first problem of one folder entry, or none. */
function entryProblem(
  entry: unknown,
  sharedRoot: string,
  translate: Translate,
): string | undefined {
  const record =
    typeof entry === 'object' && entry !== null
      ? (entry as Record<string, unknown>)
      : {};
  if (typeof record.uri === 'string') {
    return schemeOf(record.uri) === 'file'
      ? undefined
      : filled(translate, WORKSPACE_FOLDER_TEMPLATES.S408, [record.uri]);
  }
  if (typeof record.path !== 'string') {
    return translate(WORKSPACE_FOLDER_TEMPLATES.S406);
  }
  if (isAbsolute(record.path)) {
    return filled(translate, WORKSPACE_FOLDER_TEMPLATES.S407, [record.path]);
  }
  const resolved = path.resolve(sharedRoot, record.path);
  const relative = path.relative(sharedRoot, resolved);
  return relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
    ? filled(translate, WORKSPACE_FOLDER_TEMPLATES.S185, [resolved, sharedRoot])
    : undefined;
}

/** The first problem of a workspace file's folder list, as the dialog's `{0}`, or none. */
export function workspaceProblemOf(
  read: WorkspaceRead,
  workspaceFile: string,
  translate: Translate,
): string | undefined {
  if (read.kind === 'unreadable') {
    return filled(translate, WORKSPACE_FOLDER_TEMPLATES.S279, [
      workspaceFile,
      read.message,
    ]);
  }
  const errors: ParseError[] = [];
  const parsed: unknown = parse(read.text, errors, {allowTrailingComma: true});
  const folders =
    errors.length === 0 && typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>).folders
      : undefined;
  if (
    folders === undefined ||
    (Array.isArray(folders) && folders.length === 0)
  ) {
    return translate(WORKSPACE_FOLDER_TEMPLATES.S409);
  }
  if (!Array.isArray(folders)) {
    return translate(WORKSPACE_FOLDER_TEMPLATES.S406);
  }
  const sharedRoot = path.dirname(workspaceFile);
  for (const entry of folders) {
    const problem = entryProblem(entry, sharedRoot, translate);
    if (problem !== undefined) {
      return problem;
    }
  }
  return undefined;
}

/**
 * Whether Reopen in Container goes on for the saved workspace `workspaceFile`: yes when its folder list has no problem,
 * and else as the user answers the modal that names the first one.
 */
export async function workspaceFoldersAccepted(
  ports: WorkspaceFolderPorts,
  workspaceFile: string,
): Promise<boolean> {
  const problem = workspaceProblemOf(
    await ports.readWorkspaceFile(workspaceFile),
    workspaceFile,
    ports.translate,
  );
  return problem === undefined
    ? true
    : ports.confirmModal(
        filled(ports.translate, WORKSPACE_FOLDER_TEMPLATES.S363, [problem]),
      );
}
