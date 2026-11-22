/**
 * @fileoverview What the Remote Explorer leaves behind in the launch's profile and in a window: folders, log folders,
 * state keys, an output channel and notifications (F-5301 AC-14, section 9). The dialog is read as core draws it in the window, so the launch must set `window.dialogStyle`
 * to `custom`.
 */

import {existsSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {commandsOf, editorLogsFolder, variable} from './harness.ts';
import {dialogOf, notifications, type ShownDialog} from './renderer.ts';
import {readStateDatabase} from './state-database.ts';

/** The folders of `folder` whose name says they are the explorer's, at any depth. */
function explorerFolders(folder: string): string[] {
  if (!existsSync(folder)) {
    return [];
  }
  return readdirSync(folder, {recursive: true, encoding: 'utf8'}).filter(
    entry => path.basename(entry).includes('remote-explorer'),
  );
}

/** The keys of the profile's global state database that name the explorer. */
function explorerStateKeys(userData: string): string[] {
  const database = path.join(userData, 'User', 'globalStorage', 'state.vscdb');
  if (!existsSync(database)) {
    return [];
  }
  return readStateDatabase(database, opened =>
    opened
      .prepare("SELECT key FROM ItemTable WHERE key LIKE '%remote-explorer%'")
      .all()
      .map(entry => String(entry.key)),
  );
}

/** What the explorer left in the profile and in window `name`, each empty when it left nothing. */
export interface ExplorerTraces {
  /** The explorer's folders under the profile's global storage. */
  storage: string[];
  /** The explorer's folders under the editor's logs. */
  logs: string[];
  /** The profile's state keys that name the explorer. */
  stateKeys: string[];
  /** The commands that show the explorer's output channel, which exists only when the explorer made one. */
  outputChannel: string[];
  /** The notifications the window shows. */
  notifications: string[];
  /** The dialog the window shows, which core draws in the window only when the launch sets `window.dialogStyle` to `custom`. */
  dialog: ShownDialog | undefined;
}

/** What the explorer left in the profile and in window `name`. */
export async function explorerTraces(name: string): Promise<ExplorerTraces> {
  const userData = variable('HARNESS_USER_DATA');
  return {
    storage: explorerFolders(path.join(userData, 'User', 'globalStorage')),
    logs: explorerFolders(editorLogsFolder()),
    stateKeys: explorerStateKeys(userData),
    outputChannel: await commandsOf(
      name,
      'workbench.action.output.show.extension-output-remote-oss.remote-explorer',
    ),
    notifications: await notifications(name),
    dialog: await dialogOf(name),
  };
}

/** What {@link explorerTraces} reads when the explorer left nothing. */
export const NO_TRACES: ExplorerTraces = {
  storage: [],
  logs: [],
  stateKeys: [],
  outputChannel: [],
  notifications: [],
  dialog: undefined,
};
