/**
 * @fileoverview The one place a configuration's text is changed: through the editor's open document, or through the
 * file system, by a policy that says which, and a guard that keeps a save inside the workspace and on a JSON object.
 * It shows nothing: the caller shows a refusal and decides any notification, told by `durable` when one may follow.
 */

import path from 'node:path';
import {parseTree} from 'jsonc-parser';
import {NotAnObjectError} from './jsonc-edit.ts';

/** Where a file is, as the editor names it: its scheme and its path. */
export interface ConfigUri {
  scheme: string;
  /** The path on the machine for a `file:` URI. */
  fsPath: string;
  toString(): string;
}

/** An editor document. */
export interface ConfigDocument {
  uri: ConfigUri;
  getText(): string;
  isDirty: boolean;
}

/** What the file system says of a path. */
interface ConfigStat {
  symbolicLink: boolean;
}

/** The editor's calls, so that the seam runs on fakes. */
export interface ConfigurationEditPorts {
  /** The documents some tab of the editor holds. */
  openDocuments(): readonly ConfigDocument[];
  /** Opens the document without showing a tab. */
  openTextDocument(uri: ConfigUri): Promise<ConfigDocument>;
  /** Replaces the whole text of the document, through the editor; whether the editor applied it. */
  applyEdit(document: ConfigDocument, text: string): Promise<boolean>;
  /** Saves the document through the editor; whether it was saved. */
  save(document: ConfigDocument): Promise<boolean>;
  fileSystem: {
    stat(uri: ConfigUri): Promise<ConfigStat>;
    readFile(uri: ConfigUri): Promise<string>;
    writeFile(uri: ConfigUri, text: string): Promise<void>;
    rename(from: ConfigUri, to: ConfigUri): Promise<void>;
    delete(uri: ConfigUri): Promise<void>;
  };
  /** The real path of a `file:` URI, links resolved. */
  realPath(uri: ConfigUri): Promise<string>;
  workspaceFolders(): readonly ConfigUri[];
  /** The URI of the file at the path `fsPath` of this machine. */
  fileUri(fsPath: string): ConfigUri;
  /** The URI of a file named `name` in the folder of `uri`. */
  sibling(uri: ConfigUri, name: string): ConfigUri;
  /** A name part that no other file of the folder has: the adapter gives `randomUUID()`. */
  unique(): string;
}

/** Which way the edit goes: the buffer, the disk unless a tab holds the file, or the editor's save when it is safe. */
export type EditPolicy = 'buffer' | 'diskUnlessOpen' | 'diskOrSaveIfClean';

/** The new text from the current one, or none for no change. */
export type TextChange = (current: string) => string | undefined;

/** Why an edit was refused. */
type RefusalReason = 'outsideWorkspace' | 'symbolicLink' | 'notAnObject';

/** How the edit ended. */
export type EditResult =
  | {kind: 'unchanged'}
  | {kind: 'inBuffer'; durable: false}
  | {kind: 'saved'; durable: true}
  | {kind: 'written'; durable: true}
  | {kind: 'refused'; reason: RefusalReason};

/** Whether `inner` is a file below `outer`, by their real paths. */
function isBelow(outer: string, inner: string): boolean {
  const relative = path.relative(outer, inner);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

/** The document some tab holds for `file`, if any. */
function openDocumentOf(
  file: ConfigUri,
  ports: ConfigurationEditPorts,
): ConfigDocument | undefined {
  return ports
    .openDocuments()
    .find(document => document.uri.toString() === file.toString());
}

/** Edits the document's text through the editor, and does not save it. */
async function inBuffer(
  document: ConfigDocument,
  change: TextChange,
  ports: ConfigurationEditPorts,
): Promise<EditResult> {
  const next = change(document.getText());
  if (next === undefined) {
    return {kind: 'unchanged'};
  }
  await ports.applyEdit(document, next);
  return {kind: 'inBuffer', durable: false};
}

/** The text the disk holds for `file`, or none when the file isn't there. */
async function diskTextOf(
  file: ConfigUri,
  ports: ConfigurationEditPorts,
): Promise<string> {
  try {
    await ports.fileSystem.stat(file);
  } catch {
    return '';
  }
  return ports.fileSystem.readFile(file);
}

/**
 * Writes `text` over `file` under a temporary name in its own folder, then renames it into place. It has no guard on the
 * place by design: it is for files in folders the extension owns (the attach files), never for a workspace file, and
 * the adapter's rename must overwrite.
 */
async function replaceFile(
  file: ConfigUri,
  text: string,
  ports: ConfigurationEditPorts,
): Promise<void> {
  const temporary = ports.sibling(file, `.${ports.unique()}.tmp`);
  await ports.fileSystem.writeFile(temporary, text);
  try {
    await ports.fileSystem.rename(temporary, file);
  } catch (failure) {
    await ports.fileSystem.delete(temporary);
    throw failure;
  }
}

/** Why a save of `file` is refused by its place, or none when the place is fine. */
async function placeRefusal(
  file: ConfigUri,
  ports: ConfigurationEditPorts,
): Promise<RefusalReason | undefined> {
  if (file.scheme !== 'file') {
    return (await ports.fileSystem.stat(file)).symbolicLink
      ? 'symbolicLink'
      : undefined;
  }
  const real = await ports.realPath(file);
  for (const folder of ports.workspaceFolders()) {
    if (
      folder.scheme === 'file' &&
      isBelow(await ports.realPath(folder), real)
    ) {
      return undefined;
    }
  }
  return 'outsideWorkspace';
}

/** The edit through the editor that ends in a save, after the guard. */
async function savedEdit(
  file: ConfigUri,
  change: TextChange,
  ports: ConfigurationEditPorts,
): Promise<EditResult> {
  const refusal = await placeRefusal(file, ports);
  if (refusal !== undefined) {
    return {kind: 'refused', reason: refusal};
  }
  const document =
    openDocumentOf(file, ports) ?? (await ports.openTextDocument(file));
  const current = document.getText();
  if (parseTree(current, [])?.type !== 'object') {
    return {kind: 'refused', reason: 'notAnObject'};
  }
  const next = change(current);
  if (next === undefined) {
    return {kind: 'unchanged'};
  }
  await ports.applyEdit(document, next);
  await ports.save(document);
  return {kind: 'saved', durable: true};
}

/**
 * Changes the text of `file` by `change`, the way `policy` says:
 * - `buffer`: through the editor's document, never saved;
 * - `diskUnlessOpen`: through the document when a tab holds the file, else the file replaced on disk, so that a link
 *   is replaced, not written through;
 * - `diskOrSaveIfClean`: through the document, saved unless a tab holds unsaved changes, and only for a file that lies
 *   inside the workspace and holds a JSON object. A temporary file and a rename are never used for it.
 * A `change` that throws `NotAnObjectError` is a refusal with the reason `notAnObject`.
 */
export async function applyConfigurationEdit(
  file: ConfigUri,
  change: TextChange,
  policy: EditPolicy,
  ports: ConfigurationEditPorts,
): Promise<EditResult> {
  try {
    const open = openDocumentOf(file, ports);
    if (policy === 'buffer') {
      return await inBuffer(
        open ?? (await ports.openTextDocument(file)),
        change,
        ports,
      );
    }
    if (open !== undefined && (policy === 'diskUnlessOpen' || open.isDirty)) {
      return await inBuffer(open, change, ports);
    }
    if (policy === 'diskUnlessOpen') {
      const next = change(await diskTextOf(file, ports));
      if (next === undefined) {
        return {kind: 'unchanged'};
      }
      await replaceFile(file, next, ports);
      return {kind: 'written', durable: true};
    }
    return await savedEdit(file, change, ports);
  } catch (failure) {
    if (failure instanceof NotAnObjectError) {
      return {kind: 'refused', reason: 'notAnObject'};
    }
    throw failure;
  }
}
