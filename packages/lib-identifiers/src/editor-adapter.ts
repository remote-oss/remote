/**
 * @fileoverview The one adapter between lib-identifiers and the editor: command registration, the out-of-context
 * information line, setting inspection and context keys.
 */

import type * as vscode from 'vscode';
import type {CommandEntry, CommandHost} from './commands.ts';
import type {ContextKeyHost} from './context-keys.ts';
import type {SettingHost} from './settings.ts';

/** The part of the editor API the adapter uses; the extension passes the real `vscode` module. */
export type EditorApi = Pick<
  typeof vscode,
  'commands' | 'window' | 'workspace' | 'l10n'
>;

/** The part of the extension's manifest that names its commands, with the titles the editor localized. */
export interface CommandManifest {
  readonly contributes?: {
    readonly commands?: ReadonlyArray<{
      readonly command: string;
      readonly title: string;
    }>;
  };
}

/** Every editor operation lib-identifiers needs. */
export interface IdentifierHost
  extends CommandHost, SettingHost, ContextKeyHost {}

const OUT_OF_CONTEXT_MESSAGE = "'{0}' is not possible in the current context.";

/**
 * The editor operations over `editor`. `manifest` is the extension's own manifest as the editor loaded it, with
 * its `%key%` placeholders replaced by the texts of the user's language.
 */
export function identifierHost(
  editor: EditorApi,
  manifest: CommandManifest,
): IdentifierHost {
  const titles = new Map(
    (manifest.contributes?.commands ?? []).map(command => [
      command.command,
      command.title,
    ]),
  );
  return {
    registerCommand: (commandId, callback) =>
      editor.commands.registerCommand(commandId, callback),
    showOutOfContext: (entry: CommandEntry) => {
      void editor.window.showInformationMessage(
        editor.l10n.t(
          OUT_OF_CONTEXT_MESSAGE,
          titles.get(entry.id) ?? entry.title,
        ),
      );
    },
    inspectSetting: settingId =>
      editor.workspace.getConfiguration().inspect(settingId) ?? {},
    setContext: (contextKey, value) =>
      editor.commands.executeCommand('setContext', contextKey, value),
  };
}
