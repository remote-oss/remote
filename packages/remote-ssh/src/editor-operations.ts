/**
 * @fileoverview The editor's operations the connect's surfaces run, over a given editor: the window's reload and the
 * remote's close, the recent list, the configuration file's command, the Settings editor on one setting, and a write
 * to the user's settings. `vscode` is imported as a type only; the extension passes the editor.
 */

import type * as vscode from 'vscode';
import type {EditorOperations} from './editor-surfaces.ts';
import {commands} from './identifiers.generated.ts';

/** The editor's command that reloads the window. */
const RELOAD_COMMAND = 'workbench.action.reloadWindow';

/** The editor's command that leaves the remote. */
const CLOSE_REMOTE_COMMAND = 'workbench.action.remote.close';

/** The editor's command that opens the recent list. */
const OPEN_RECENT_COMMAND = 'workbench.action.openRecent';

/** The editor's command that opens the user's settings file; given a setting to reveal, it only shows it. */
const OPEN_SETTINGS_FILE_COMMAND = 'workbench.action.openSettingsJson';

/** The operations over `editor`; `revealLog` is the log channel's. */
export function editorOperationsOf(
  editor: Pick<typeof vscode, 'commands' | 'workspace' | 'ConfigurationTarget'>,
  revealLog: () => void,
): EditorOperations {
  return {
    reloadWindow: () => editor.commands.executeCommand(RELOAD_COMMAND),
    closeRemote: () => editor.commands.executeCommand(CLOSE_REMOTE_COMMAND),
    openRecent: () => editor.commands.executeCommand(OPEN_RECENT_COMMAND),
    openConfigFile: () =>
      editor.commands.executeCommand(commands.openConfigFile.id),
    openSetting: settingId =>
      editor.commands.executeCommand(OPEN_SETTINGS_FILE_COMMAND, {
        revealSetting: {key: settingId},
      }),
    writeUserSetting: (settingId, value) =>
      editor.workspace
        .getConfiguration()
        .update(settingId, value, editor.ConfigurationTarget.Global),
    revealLog,
  };
}
