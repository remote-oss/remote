/**
 * @fileoverview Copy existing configuration to workspace: the configuration in the folder's slot of the store of user
 * data is written, byte for byte, to the workspace's `.devcontainer/devcontainer.json`, and the user is then asked
 * whether to delete the stored one. The copy comes first, so Keep, Cancel and Escape all leave both files.
 */

import path from 'node:path';
import type {Translate} from '../surfaces/engine-dialogs.ts';
import {filled} from '../surfaces/filled.ts';
import type {StoredSlot} from './user-data-store.ts';

/** The English templates of the texts of the copy, by their string ids. */
const COPY_TEMPLATES = {
  S108: 'Delete the configuration from the user data folder?',
  S182: "File '{0}' already exists, overwrite?",
  delete: 'Delete',
  keep: 'Keep',
  overwrite: 'Overwrite',
  skip: 'Skip',
  cancel: 'Cancel',
  notWritten: "The configuration couldn't be written to {0}: {1}",
} as const;

/** The workspace file the copy writes, relative to the folder. */
const WORKSPACE_FILE = path.join('.devcontainer', 'devcontainer.json');

/** How the copy ends; the wizard ends with it. */
export type CopyOutcome =
  | {
      kind: 'written';
      files: string[];
      /** The folder the files are in. */
      target: string;
      /** Whether that is the workspace or the slot. */
      place: 'workspace' | 'userData';
    }
  | {kind: 'cancelled'}
  | {kind: 'failed'; detail: string};

/** What the copy needs of its surroundings. */
export interface CopyStoredPorts {
  files: {
    exists(file: string): Promise<boolean>;
    read(file: string): Promise<Uint8Array>;
    /** Writes the bytes, replacing the file. */
    write(file: string, bytes: Uint8Array): Promise<void>;
    makeFolder(folder: string): Promise<void>;
    /** Removes the folder and what is in it. */
    removeFolder(folder: string): Promise<void>;
  };
  /** A modal with the buttons, the first the primary one; gives the one chosen, or nothing for Escape. */
  show(
    severity: 'error' | 'info',
    message: string,
    detail: string,
    buttons: readonly string[],
  ): Promise<string | undefined>;
  translate: Translate;
}

/**
 * Copies the stored configuration of `slot` into `folder`. A file already there is asked about first, and Skip and Cancel
 * end it with nothing written. After the copy, Delete removes the slot; Keep, Cancel and Escape leave it. The outcome
 * is the workspace file written after a Delete, and the slot's folder with no file written after the others.
 */
export async function copyStored(
  request: {folder: string; slot: StoredSlot},
  ports: CopyStoredPorts,
): Promise<CopyOutcome> {
  const {folder, slot} = request;
  function text(template: string, values: readonly string[] = []): string {
    return filled(ports.translate, template, values);
  }
  const target = path.join(folder, WORKSPACE_FILE);
  if (await ports.files.exists(target)) {
    // the first button is the primary one: Skip, which leaves the file as it is
    const answer = await ports.show(
      'info',
      text(COPY_TEMPLATES.S182, [WORKSPACE_FILE]),
      '',
      [
        text(COPY_TEMPLATES.skip),
        text(COPY_TEMPLATES.overwrite),
        text(COPY_TEMPLATES.cancel),
      ],
    );
    if (answer !== text(COPY_TEMPLATES.overwrite)) {
      return {kind: 'cancelled'};
    }
  }
  try {
    const bytes = await ports.files.read(slot.configFile);
    await ports.files.makeFolder(path.dirname(target));
    await ports.files.write(target, bytes);
  } catch (caught) {
    const detail = caught instanceof Error ? caught.message : String(caught);
    await ports.show(
      'error',
      text(COPY_TEMPLATES.notWritten, [folder, detail]),
      '',
      [],
    );
    return {kind: 'failed', detail};
  }
  const answer = await ports.show('info', text(COPY_TEMPLATES.S108), '', [
    text(COPY_TEMPLATES.keep),
    text(COPY_TEMPLATES.delete),
    text(COPY_TEMPLATES.cancel),
  ]);
  if (answer !== text(COPY_TEMPLATES.delete)) {
    return {kind: 'written', files: [], target: slot.folder, place: 'userData'};
  }
  await ports.files.removeFolder(slot.folder);
  return {
    kind: 'written',
    files: [WORKSPACE_FILE],
    target: folder,
    place: 'workspace',
  };
}
