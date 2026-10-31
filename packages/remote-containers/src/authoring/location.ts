/**
 * @fileoverview The location stage of the wizard: the first quick pick, which asks whether the configuration is added
 * to the workspace or to the extension's own store of user data. It works untrusted and has no Back.
 */

import type {Translate} from '../surfaces/engine-dialogs.ts';
import type {FolderFacts, RootEntry} from './curated-templates.ts';
import type {WalkFiles} from './folder-facts.ts';
import {type QuickPicker, shownPick} from './quick-pick.ts';
import {newSlot, slotOf, type StoreFiles} from './user-data-store.ts';

/** The English template of each text of the stage, by its string id. */
const LOCATION_TEMPLATES = {
  S403: 'Where would you like to create your container configuration?',
  S027: 'Add configuration to workspace',
  S370: 'This allows you to share the configuration with others via source control',
  S026: 'Add configuration to user data folder',
  S371: 'This avoids having outgoing changes in your workspace folder',
  S082: 'Configuration already exists',
} as const;

/** One row of the pick: where the configuration goes when it is accepted. */
export interface LocationRow {
  label: string;
  description?: string;
  detail: string;
  place: 'workspace' | 'userData';
}

/** What the stage needs besides the wizard's ports: the pick, and the store it looks in and adds to. */
export interface LocationPorts {
  createQuickPick(): QuickPicker<LocationRow>;
  /** The folder of the store. */
  storeRoot: string;
  store: StoreFiles;
  /** The user's home folder, which the dialogs write as `~`. */
  home: string;
}

/** The names the folder's own configuration files can have, relative to it. */
const ROOT_CONFIGURATION = '.devcontainer.json';
const FOLDER_CONFIGURATION = 'devcontainer.json';
const CONFIGURATION_FOLDER = '.devcontainer';

/** What the pick reads of the window and the folder. */
export interface LocationRequest {
  title: string;
  folder: string;
  facts: FolderFacts;
  files: WalkFiles;
  translate: Translate;
}

/** Where the user wants the configuration, or nothing for Escape. */
export type LocationChoice =
  {kind: 'workspace'} | {kind: 'userData'; slot: string} | {kind: 'cancelled'};

function isFileNamed(entry: RootEntry, name: string): boolean {
  return entry.name === name && entry.kind === 'file';
}

/** Whether the folder holds a configuration file of its own: a subfolder's does not count. */
async function hasOwnConfiguration(request: LocationRequest): Promise<boolean> {
  if (
    request.facts.rootEntries.some(entry =>
      isFileNamed(entry, ROOT_CONFIGURATION),
    )
  ) {
    return true;
  }
  const inside = await request.files.list(
    `${request.folder}/${CONFIGURATION_FOLDER}`,
  );
  return inside.some(entry => isFileNamed(entry, FOLDER_CONFIGURATION));
}

/** Asks where the configuration goes; for the store, the folder's own slot, or a new one. */
export async function askLocation(
  location: LocationPorts,
  request: LocationRequest,
  cancellation: AbortSignal,
): Promise<LocationChoice> {
  function text(name: keyof typeof LOCATION_TEMPLATES): string {
    return request.translate(LOCATION_TEMPLATES[name]);
  }
  const [workspaceHas, stored] = await Promise.all([
    hasOwnConfiguration(request),
    slotOf(location.storeRoot, request.folder, location.store),
  ]);
  const exists = text('S082');
  const rows: LocationRow[] = [
    {
      label: text('S027'),
      ...(workspaceHas ? {description: exists} : {}),
      detail: text('S370'),
      place: 'workspace',
    },
    {
      label: text('S026'),
      ...(stored === undefined ? {} : {description: exists}),
      detail: text('S371'),
      place: 'userData',
    },
  ];
  const choice = await shownPick<
    LocationRow,
    {kind: 'picked'; place: LocationRow['place']}
  >(
    () => location.createQuickPick(),
    cancellation,
    (picker, finish) => {
      picker.title = request.title;
      picker.placeholder = text('S403');
      picker.items = rows;
      picker.activeItems = rows.slice(0, 1);
      picker.onDidAccept(() => {
        const [selected] = picker.selectedItems;
        if (selected !== undefined) {
          finish({kind: 'picked', place: selected.place});
        }
      });
    },
  );
  if (choice.kind === 'cancelled') {
    return choice;
  }
  if (choice.place === 'workspace') {
    return {kind: 'workspace'};
  }
  const slot =
    stored ??
    (await newSlot(location.storeRoot, request.folder, location.store));
  return {kind: 'userData', slot: slot.name};
}
