/**
 * @fileoverview The editor adapters of the connect's surfaces: the failure dialog, the licence modal, the platform pick,
 * the "More Actions..." pick, the SSH configuration file pick and the server download's notification, each a small
 * function over the editor it is given. `vscode` is imported for its types
 * only, so every adapter is tested with a fake editor.
 */

import type * as vscode from 'vscode';
import type {FileChoiceItem, FilePickPort} from '../config/file-choice.ts';
import {fileChoiceLabelOf, fileChoiceTextOf} from '../config/file-choice.ts';
import type {DownloadProgressPort} from '../cli/server-download-progress.ts';
import type {PlatformPickPort} from '../connect/platform-picker.ts';
import type {FailureDialogPort} from './failure-presenter.ts';
import type {LicenceDialogPort} from './licence-modal.ts';
import type {PreconnectDialogPort} from './preconnect-dialog.ts';
import type {MitigationPickPort} from './mitigation-picker.ts';
import type {NoticePort} from './notice.ts';
import type {TextInputPort} from './text-input.ts';
import {ownText} from './own-strings.ts';
import type {PromptEditor} from './prompt-surface.ts';
import type {Translate} from './strings.ts';

type Editor = Pick<typeof vscode, 'window'>;

/** A choice in a quick pick: its label and what choosing it means. */
interface Choice<Answer> {
  label: string;
  answer: Answer;
  /** Text beside the label. */
  description?: string;
  /** Whether the choice stays listed whatever the user types. */
  alwaysShow?: boolean;
}

/** What a quick pick is made from. */
interface PickOptions<Answer> {
  title?: string;
  placeholder: string;
  choices: ReadonlyArray<Choice<Answer>>;
  /** Whether the pick stays open when the focus moves away. */
  ignoreFocusOut: boolean;
  /** The index of the focused choice; the first when absent. */
  active?: number;
}

/**
 * Shows a single-selection quick pick with the first choice focused and gives the answer of the choice taken, or
 * nothing when it is hidden without one or `cancellation` ends. A cancellation that has ended already shows nothing.
 * The pick is disposed after.
 */
function pickOne<Answer>(
  editor: Editor,
  options: PickOptions<Answer>,
  cancellation: AbortSignal,
): Promise<Answer | undefined> {
  if (cancellation.aborted) {
    return Promise.resolve(undefined);
  }
  return new Promise(settle => {
    const pick = editor.window.createQuickPick();
    const items: vscode.QuickPickItem[] = options.choices.map(choice => ({
      label: choice.label,
      ...(choice.description === undefined
        ? {}
        : {description: choice.description}),
      ...(choice.alwaysShow === undefined
        ? {}
        : {alwaysShow: choice.alwaysShow}),
    }));
    if (options.title !== undefined) {
      pick.title = options.title;
    }
    pick.placeholder = options.placeholder;
    pick.canSelectMany = false;
    pick.ignoreFocusOut = options.ignoreFocusOut;
    pick.items = items;
    const focused = options.active ?? 0;
    pick.activeItems = items.slice(focused, focused + 1);
    let answer: Answer | undefined;
    function onAbort(): void {
      pick.hide();
    }
    cancellation.addEventListener('abort', onAbort);
    pick.onDidAccept(() => {
      const [taken] = pick.selectedItems;
      answer =
        taken === undefined
          ? undefined
          : options.choices[items.indexOf(taken)]?.answer;
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

/**
 * Shows a masked input box that stays open when the user looks away and gives what was typed on accept, or nothing
 * when it is hidden without one or `cancellation` ends. A cancellation that has ended already shows nothing. The input
 * box is disposed after.
 */
function askText(
  editor: Editor,
  placeholder: string,
  cancellation: AbortSignal,
): Promise<string | undefined> {
  if (cancellation.aborted) {
    return Promise.resolve(undefined);
  }
  return new Promise(settle => {
    const inputBox = editor.window.createInputBox();
    inputBox.placeholder = placeholder;
    inputBox.password = true;
    inputBox.ignoreFocusOut = true;
    let typed: string | undefined;
    function onAbort(): void {
      inputBox.hide();
    }
    cancellation.addEventListener('abort', onAbort);
    inputBox.onDidAccept(() => {
      typed = inputBox.value;
      inputBox.hide();
    });
    inputBox.onDidHide(() => {
      cancellation.removeEventListener('abort', onAbort);
      inputBox.dispose();
      settle(typed);
    });
    inputBox.show();
  });
}

/** The buttons of a modal, in order, with the last one the close affordance so the editor adds no second Cancel. */
function modalItems(buttons: readonly string[]): vscode.MessageItem[] {
  return buttons.map((title, index) => ({
    title,
    isCloseAffordance: index === buttons.length - 1,
  }));
}

/** The plain text input: `showInputBox` with the request's title, prompt and placeholder, or nothing when dismissed. */
export function textInputOf(editor: Editor): TextInputPort {
  return {
    showInputBox: async request => {
      const options: vscode.InputBoxOptions = {};
      if (request.title !== undefined) {
        options.title = request.title;
      }
      if (request.prompt !== undefined) {
        options.prompt = request.prompt;
      }
      if (request.placeholder !== undefined) {
        options.placeHolder = request.placeholder;
      }
      return await editor.window.showInputBox(options);
    },
  };
}

/** The non-modal notices: `showInformationMessage`, `showWarningMessage` and `showErrorMessage` without `modal`. */
export function noticeOf(editor: Editor): NoticePort {
  return {
    showInformation: async (message, buttons) =>
      await editor.window.showInformationMessage(message, ...buttons),
    showWarning: async (message, buttons) =>
      await editor.window.showWarningMessage(message, ...buttons),
    showError: async (message, buttons) =>
      await editor.window.showErrorMessage(message, ...buttons),
  };
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

/** The licence modal: a modal information message with the detail and the extension's items; the editor adds its Cancel. */
export function licenceDialogOf(editor: Editor): LicenceDialogPort {
  return {
    showModal: async (message, detail, buttons) =>
      (
        await editor.window.showInformationMessage(
          message,
          {modal: true, detail},
          ...buttons.map(title => ({title})),
        )
      )?.title,
  };
}

/** The pre-connection dialog: a modal warning message with the detail and the extension's items; the editor adds its Cancel. */
export function preconnectDialogPortOf(editor: Editor): PreconnectDialogPort {
  return {
    showModal: async (message, detail, buttons) =>
      (
        await editor.window.showWarningMessage(
          message,
          {modal: true, detail},
          ...buttons.map(title => ({title})),
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
          active: pick.items.findIndex(item => item.platform === pick.active),
        },
        cancellation,
      ),
  };
}

/** The SSH configuration file pick: the rows of `choice` as a quick pick without a title, open when the focus moves away. */
export function filePickPortOf(
  editor: Editor,
  translate: Translate,
): FilePickPort {
  return {
    pick: choice =>
      pickOne<FileChoiceItem>(
        editor,
        {
          placeholder: fileChoiceTextOf(choice.placeholder, translate),
          choices: choice.items.map(item =>
            item.kind === 'file'
              ? {label: fileChoiceLabelOf(item, translate), answer: item}
              : {
                  label: fileChoiceLabelOf(item, translate),
                  description: fileChoiceTextOf(item.description, translate),
                  alwaysShow: true,
                  answer: item,
                },
          ),
          ignoreFocusOut: true,
        },
        new AbortController().signal,
      ),
  };
}

/** The "More Actions..." pick: five fixed items as a quick pick without a title, closing when the user looks away. */
export function mitigationPickPortOf(editor: Editor): MitigationPickPort {
  return {
    pick: pick =>
      pickOne(
        editor,
        {
          placeholder: pick.placeholder,
          choices: pick.items.map(item => ({
            label: item.label,
            answer: item.action,
          })),
          ignoreFocusOut: false,
        },
        new AbortController().signal,
      ),
  };
}

/** The questions of a login: a pick that closes when the user looks away, and a masked input that stays open. */
export function promptEditorOf(
  editor: Editor,
  translate: Translate,
): PromptEditor {
  return {
    pick: (request, cancellation) =>
      pickOne(
        editor,
        {
          ...(request.title === undefined ? {} : {title: request.title}),
          placeholder: request.placeholder,
          choices: request.items,
          ignoreFocusOut: false,
        },
        cancellation,
      ),
    maskedInput: (request, cancellation) =>
      askText(editor, request.placeholder, cancellation),
    translate,
  };
}

/**
 * The server download's notification: a progress notification that can't be cancelled, whose bar follows the
 * percentages reported, and which stays until it is closed. A percentage lower than one shown before moves nothing.
 */
export function downloadProgressOf(
  editor: Pick<typeof vscode, 'window' | 'ProgressLocation'>,
): DownloadProgressPort {
  return {
    show: title => {
      let shown = 0;
      let wanted = 0;
      let target: vscode.Progress<{increment: number}> | undefined;
      let finish!: () => void;
      const finished = new Promise<void>(resolve => {
        finish = resolve;
      });
      function forward(): void {
        if (target !== undefined && wanted > shown) {
          target.report({increment: wanted - shown});
          shown = wanted;
        }
      }
      void editor.window.withProgress(
        {
          location: editor.ProgressLocation.Notification,
          title,
          cancellable: false,
        },
        progress => {
          target = progress;
          forward();
          return finished;
        },
      );
      return {
        report: percent => {
          wanted = percent;
          forward();
        },
        close: () => {
          finish();
        },
      };
    },
  };
}
