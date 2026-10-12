/**
 * @fileoverview The editor adapters of the connect's surfaces: the failure dialog, the licence modal and the platform
 * pick, each a small function over the editor it is given. `vscode` is imported for its types only, so every adapter
 * is tested with a fake editor.
 */

import type * as vscode from 'vscode';
import type {PlatformPickPort} from '../connect/platform-picker.ts';
import type {FailureDialogPort} from './failure-presenter.ts';
import type {LicenceDialogPort} from './licence-modal.ts';
import {ownText} from './own-strings.ts';
import type {Translate} from './strings.ts';

type Editor = Pick<typeof vscode, 'window'>;

/** A choice in a quick pick: its label and what choosing it means. */
interface Choice<Answer> {
  label: string;
  answer: Answer;
}

/** What a quick pick is made from. */
interface PickOptions<Answer> {
  title?: string;
  placeholder: string;
  choices: ReadonlyArray<Choice<Answer>>;
  /** Whether the pick stays open when the focus moves away. */
  ignoreFocusOut: boolean;
}

/**
 * Shows a single-selection quick pick with the first choice focused and gives the answer of the choice taken, or
 * nothing when it is hidden without one or `cancellation` ends. The pick is disposed after.
 */
function pickOne<Answer>(
  editor: Editor,
  options: PickOptions<Answer>,
  cancellation: AbortSignal,
): Promise<Answer | undefined> {
  return new Promise(settle => {
    const pick = editor.window.createQuickPick();
    const items: vscode.QuickPickItem[] = options.choices.map(choice => ({
      label: choice.label,
    }));
    if (options.title !== undefined) {
      pick.title = options.title;
    }
    pick.placeholder = options.placeholder;
    pick.canSelectMany = false;
    pick.ignoreFocusOut = options.ignoreFocusOut;
    pick.items = items;
    pick.activeItems = items.slice(0, 1);
    let answer: Answer | undefined;
    function onAbort(): void {
      pick.hide();
    }
    cancellation.addEventListener('abort', onAbort);
    pick.onDidAccept(() => {
      const chosen = pick.selectedItems[0];
      answer = options.choices.find(
        choice => choice.label === chosen?.label,
      )?.answer;
      pick.hide();
    });
    pick.onDidHide(() => {
      cancellation.removeEventListener('abort', onAbort);
      pick.dispose();
      settle(answer);
    });
    pick.show();
  });
}

/** The buttons of a modal, in order, with the last one the close affordance so the editor adds no second Cancel. */
function modalItems(buttons: readonly string[]): vscode.MessageItem[] {
  return buttons.map((title, index) => ({
    title,
    isCloseAffordance: index === buttons.length - 1,
  }));
}

/** The failure dialog of a connect: a modal error whose last button, "More Actions...", is the cancel. */
export function failureDialogOf(editor: Editor): FailureDialogPort {
  return {
    showError: async (text, buttons) =>
      (
        await editor.window.showErrorMessage(
          text,
          {modal: true},
          ...modalItems(buttons),
        )
      )?.title,
  };
}

/** The licence modal: a modal warning with the detail, whose last button is the cancel. */
export function licenceDialogOf(editor: Editor): LicenceDialogPort {
  return {
    showModal: async (message, detail, buttons) =>
      (
        await editor.window.showWarningMessage(
          message,
          {modal: true, detail},
          ...modalItems(buttons),
        )
      )?.title,
  };
}

/** The platform pick: the three platforms as a quick pick that closes when the user looks away. */
export function platformPickPortOf(
  editor: Editor,
  translate: Translate,
): PlatformPickPort {
  return {
    pick: (pick, cancellation) =>
      pickOne(
        editor,
        {
          placeholder: ownText(pick.placeholder, translate),
          choices: pick.items.map(item => ({
            label: item.label,
            answer: item.platform,
          })),
          ignoreFocusOut: false,
        },
        cancellation,
      ),
  };
}
