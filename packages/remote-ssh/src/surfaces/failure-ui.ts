/**
 * @fileoverview The failure dialog of a connect: the modal error that says the connection could not be made, its
 * three buttons, and the picker of actions behind "More Actions...". A failure with no server source has a dialog of
 * its own that offers the setting. The dialog returns what the window does next, and writes nothing.
 */

import {endWithFullStop} from 'lib-ssh';
import type {Failed, FailurePresenter, PresenterOutcome} from 'lib-authority';
import {
  CANCELLED_REASON,
  DOWNLOAD_TEMPLATE_SETTING,
  FAILURE_TEMPLATES,
  REASON_TEMPLATES,
} from './failure-strings.ts';
import {filled, type Translate} from './strings.ts';

/** A button of a modal dialog and what choosing it means. */
export interface ModalChoice<Choice extends string> {
  label: string;
  choice: Choice;
}

/** What the failure UI needs of the editor. */
export interface FailureEditor {
  /**
   * Shows a modal error with the buttons in the order given. Escape and the close button choose `dismissChoice`,
   * which is one of the buttons.
   */
  showModal<Choice extends string>(request: {
    message: string;
    choices: ReadonlyArray<ModalChoice<Choice>>;
    dismissChoice: Choice;
  }): Promise<Choice>;
  /**
   * Shows a pick that closes when the user looks away, with the first item focused. Gives the chosen item's value, or
   * undefined when the user dismissed it.
   */
  pickAction<Value extends string>(request: {
    placeholder: string;
    items: ReadonlyArray<{label: string; value: Value}>;
  }): Promise<Value | undefined>;
  /** Runs an editor command. */
  runCommand(command: string, ...parameters: unknown[]): PromiseLike<unknown>;
  /** Hands an address to the external browser. */
  openExternal(address: string): PromiseLike<unknown>;
  /** The text for the display language of a template. */
  translate: Translate;
}

/** What the failure UI knows about the window and the product. */
export interface FailureUiOptions {
  /** The host as the authority wrote it, which the message names. */
  hostAlias: () => string;
  /** The editor's own application name, which the no-source message names. */
  applicationName: string;
  /** The display name of this extension, which the no-source message names. */
  displayName: string;
  /** Where the documentation of the extension is. */
  documentationUrl: string;
  /** The command that opens the SSH configuration file picker. */
  openConfigFileCommand: string;
  /** The identifiers of the extension and its companions, for the settings search. */
  extensionIds: readonly string[];
}

type DialogChoice = 'retry' | 'more' | 'close';

type ActionValue =
  'reload' | 'recent' | 'documentation' | 'configFile' | 'settings';

const OPEN_SETTINGS = 'workbench.action.openSettings';
const OPEN_RECENT = 'workbench.action.openRecent';

/** The reason of a failure as text, or none when it has none or names a string this table does not know. */
function reasonTextOf(
  failed: Failed,
  translate: Translate,
): string | undefined {
  if (failed.kind === 'licenceDeclined') {
    return filled(translate, CANCELLED_REASON);
  }
  const {reason} = failed;
  if (reason === undefined) {
    return undefined;
  }
  if ('text' in reason) {
    return reason.text === '' ? undefined : reason.text;
  }
  const template = REASON_TEMPLATES[reason.id];
  return template === undefined ? undefined : filled(translate, template);
}

/** The presenter of failures for one window. */
export function createFailurePresenter(
  editor: FailureEditor,
  options: FailureUiOptions,
): FailurePresenter {
  const {translate} = editor;

  function text(template: string, values: readonly string[] = []): string {
    return filled(translate, template, values);
  }

  async function pickedOutcome(): Promise<PresenterOutcome> {
    const picked = await editor.pickAction<ActionValue>({
      placeholder: text(FAILURE_TEMPLATES.pickerPlaceholder),
      items: [
        {label: text(FAILURE_TEMPLATES.reloadWindow), value: 'reload'},
        {label: text(FAILURE_TEMPLATES.openRecent), value: 'recent'},
        {
          label: text(FAILURE_TEMPLATES.openDocumentation),
          value: 'documentation',
        },
        {label: text(FAILURE_TEMPLATES.openConfigFile), value: 'configFile'},
        {label: text(FAILURE_TEMPLATES.openSettings), value: 'settings'},
      ],
    });
    switch (picked) {
      case 'reload':
        return 'reload';
      case 'recent':
        await editor.runCommand(OPEN_RECENT);
        break;
      case 'documentation':
        await editor.openExternal(options.documentationUrl);
        break;
      case 'configFile':
        await editor.runCommand(options.openConfigFileCommand);
        break;
      case 'settings':
        await editor.runCommand(
          OPEN_SETTINGS,
          `@ext:${options.extensionIds.join(',')}`,
        );
        break;
      default:
        break;
    }
    return 'handled';
  }

  async function connectionFailed(failed: Failed): Promise<PresenterOutcome> {
    const alias = options.hostAlias();
    const reason = reasonTextOf(failed, translate);
    const message =
      reason === undefined
        ? text(FAILURE_TEMPLATES.noReason, [alias])
        : text(FAILURE_TEMPLATES.withReason, [alias, reason]);
    const choice = await editor.showModal<DialogChoice>({
      message: endWithFullStop(message),
      choices: [
        {label: text(FAILURE_TEMPLATES.retry), choice: 'retry'},
        {label: text(FAILURE_TEMPLATES.moreActions), choice: 'more'},
        {label: text(FAILURE_TEMPLATES.closeRemote), choice: 'close'},
      ],
      dismissChoice: 'more',
    });
    switch (choice) {
      case 'retry':
        return 'reload';
      case 'close':
        return 'closeRemote';
      default:
        return pickedOutcome();
    }
  }

  async function noServerSource(failed: Failed): Promise<PresenterOutcome> {
    const values = [
      options.applicationName,
      DOWNLOAD_TEMPLATE_SETTING,
      options.displayName,
      reasonTextOf(failed, translate) ?? '',
    ];
    const choice = await editor.showModal<'open' | 'cancel'>({
      message: text(
        failed.kind === 'noServerSource'
          ? FAILURE_TEMPLATES.noServerSource
          : FAILURE_TEMPLATES.invalidTemplate,
        values,
      ),
      choices: [
        {label: text(FAILURE_TEMPLATES.openSetting), choice: 'open'},
        {label: text(FAILURE_TEMPLATES.cancel), choice: 'cancel'},
      ],
      dismissChoice: 'cancel',
    });
    if (choice === 'open') {
      await editor.runCommand(OPEN_SETTINGS, DOWNLOAD_TEMPLATE_SETTING);
    }
    return 'handled';
  }

  return {
    present: failed =>
      failed.kind === 'noServerSource' ||
      failed.kind === 'invalidServerTemplate'
        ? noServerSource(failed)
        : connectionFailed(failed),
  };
}
