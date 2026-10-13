/**
 * @fileoverview The activation of Remote Explorer in a window, shared by the desktop and the web entry: the
 * stand-down guard, the entry's setup, and the commands, with the end of what was registered added to the context.
 */

import type * as vscode from 'vscode';
import {identifierHost} from 'lib-identifiers';
import {standDownHost} from 'lib-standdown';
import {activateExplorer, silentHandlers} from './activation.ts';
import {commands, standDown} from './identifiers.generated.ts';

/** The warning of a window where the other Remote Explorer runs, and its button. */
const STAND_DOWN_WARNING =
  'Remote Explorer stays inactive in this window because another Remote Explorer extension is enabled. Both use the same commands, settings and views. Disable one of the two and reload the window.';
const STAND_DOWN_BUTTON = 'Show Remote Explorer Extension';

/** What the editor tells about the extension, as far as activation reads it. */
interface Manifest {
  displayName: string;
  contributes?: {commands?: Array<{command: string; title: string}>};
}

/** The part of the editor API the window's activation uses; the entry passes the real `vscode` module. */
export type WindowEditor = Pick<
  typeof vscode,
  'commands' | 'window' | 'workspace' | 'l10n' | 'extensions'
>;

/**
 * Activates the explorer in this window: the stand-down guard, `setup`, then the commands. On `serving` the end of
 * the registration is added to `context.subscriptions`.
 */
export async function activateInWindow(
  editor: WindowEditor,
  context: Pick<vscode.ExtensionContext, 'subscriptions' | 'extension'>,
  setup: () => PromiseLike<unknown>,
): Promise<void> {
  const result = await activateExplorer({
    table: {commands, standDown},
    standDownTexts: {
      warning: editor.l10n.t(STAND_DOWN_WARNING),
      button: editor.l10n.t(STAND_DOWN_BUTTON),
    },
    standDown: standDownHost(editor),
    commands: identifierHost(editor, context.extension.packageJSON as Manifest),
    handlers: silentHandlers(commands),
    setup,
  });
  if (result.kind === 'serving') {
    context.subscriptions.push({
      dispose: () => {
        result.dispose();
      },
    });
  }
}
