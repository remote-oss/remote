/**
 * @fileoverview The editor's operations the connect's surfaces run, over a given editor: the window's reload and the
 * remote's close through lib-authority's opener, the recent list, the configuration file's command, the Settings
 * editor on one setting, and a write to the user's settings. `vscode` is imported as a type only; the extension passes
 * the editor.
 */

import type * as vscode from 'vscode';
import {closeRemote, type OpenerHost, reload} from 'lib-authority';
import type {EditorOperations} from './editor-surfaces.ts';
import {commands} from './identifiers.generated.ts';

/** The editor's command that opens the recent list. */
const OPEN_RECENT_COMMAND = 'workbench.action.openRecent';

/** The editor's command that opens the Settings editor with a query. */
const OPEN_SETTINGS_COMMAND = 'workbench.action.openSettings';

/** The opener's view of the editor: its commands and its addresses. */
function openerHostOf(
  editor: Pick<typeof vscode, 'commands' | 'Uri'>,
): OpenerHost {
  return {
    executeCommand: (command, ...parameters) =>
      editor.commands.executeCommand(command, ...parameters),
    addressOf: parts => editor.Uri.from(parts),
  };
}

/** The operations over `editor`; `revealLog` is the log channel's. */
export function editorOperationsOf(
  editor: Pick<
    typeof vscode,
    'commands' | 'Uri' | 'workspace' | 'ConfigurationTarget'
  >,
  revealLog: () => void,
): EditorOperations {
  const opener = openerHostOf(editor);
  return {
    reloadWindow: () => reload(opener),
    closeRemote: () => closeRemote(opener),
    openRecent: () => editor.commands.executeCommand(OPEN_RECENT_COMMAND),
    openConfigFile: () =>
      editor.commands.executeCommand(commands.openConfigFile.id),
    openSetting: settingId =>
      editor.commands.executeCommand(OPEN_SETTINGS_COMMAND, settingId),
    writeUserSetting: (settingId, value) =>
      editor.workspace
        .getConfiguration()
        .update(settingId, value, editor.ConfigurationTarget.Global),
    revealLog,
  };
}
