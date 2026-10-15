/**
 * @fileoverview The editor's side of the failure presenter: its modal error, its quick pick and the commands it runs,
 * behind the ports the presenter takes. The editor's module is handed in, so nothing here imports it.
 */

import type {ErrorButton, RecoveryPorts} from './recovery-presenter.ts';

/** The parts of the editor's API the adapters use; the `vscode` namespace has them. */
export interface RecoveryEditor<Address> {
  window: {
    showErrorMessage(
      message: string,
      options: {modal: boolean; detail: string},
      ...items: ErrorButton[]
    ): PromiseLike<ErrorButton | undefined>;
    showQuickPick(
      items: readonly string[],
      options: {placeHolder: string},
    ): PromiseLike<string | undefined>;
  };
  commands: {
    executeCommand(
      command: string,
      ...parameters: unknown[]
    ): PromiseLike<unknown>;
  };
  env: {openExternal(address: Address): PromiseLike<unknown>};
  Uri: {file(path: string): Address; parse(address: string): Address};
}

/** The ports of the presenter over the editor; `keepEdit` and `logger` are the window's own. */
export function recoveryPortsOf<Address>(
  editor: RecoveryEditor<Address>,
  own: Pick<RecoveryPorts, 'keepEdit' | 'logger'>,
): RecoveryPorts {
  return {
    ...own,
    showError: async (message, detail, buttons) =>
      (
        await editor.window.showErrorMessage(
          message,
          {modal: true, detail},
          ...buttons,
        )
      )?.title,
    pick: (placeholder, labels) =>
      editor.window.showQuickPick(labels, {placeHolder: placeholder}),
    openLocally: folder =>
      editor.commands.executeCommand(
        'vscode.openFolder',
        editor.Uri.file(folder),
        {forceReuseWindow: true},
      ),
    reloadWindow: () =>
      editor.commands.executeCommand('workbench.action.reloadWindow'),
    openRecent: () =>
      editor.commands.executeCommand('workbench.action.openRecent'),
    openExternal: address => editor.env.openExternal(editor.Uri.parse(address)),
    openSetting: setting =>
      editor.commands.executeCommand('workbench.action.openSettings', setting),
    later: task => {
      setTimeout(task, 0);
    },
  };
}
