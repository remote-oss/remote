/**
 * @fileoverview The editor behind the connect commands: the host pick as a quick pick that is rebuilt on every change
 * of its text, the opening of an empty remote window, and the editor's own commands. `vscode` is imported for its
 * types only; the editor is a value it is given, so every function is tested with a fake one.
 */

import type * as vscode from 'vscode';
import {type OpenerHost, openRemote} from 'lib-authority';
import type {HostListResult} from 'lib-ssh';
import {textOfId} from '../surfaces/failure-strings.ts';
import type {FailureStringId} from '../surfaces/failure-strings.ts';
import type {Translate} from '../surfaces/strings.ts';
import type {HostPickPort} from '../surfaces/host-pick.ts';
import type {ConnectCommandEditor} from './connect-commands.ts';
import type {PickerItem, PickerModel} from './picker-model.ts';

type Editor = Pick<typeof vscode, 'window' | 'commands' | 'env' | 'Uri'>;

/** The label of a row: a host or the typed text as it is, a fixed row from the string table. */
export function labelOf(item: PickerItem, translate: Translate): string {
  return item.kind === 'host' || item.kind === 'typed'
    ? item.label
    : textOfId(item.label.id as FailureStringId, translate, item.label.values);
}

/** The quick pick items of a model: the rows in order, each kept listed whatever is typed where its model says so. */
function itemsOf(
  model: PickerModel,
  translate: Translate,
): vscode.QuickPickItem[] {
  return model.items.map(item => ({
    label: labelOf(item, translate),
    alwaysShow: item.keepVisible,
  }));
}

/**
 * The host pick: no title, a placeholder, one choice, left open when the focus moves away. Every change of the text
 * shows the rows `modelOf` gives for it with the first row focused. The pick is disposed after.
 */
function pickHost(
  editor: Editor,
  translate: Translate,
  initial: PickerModel,
  modelOf: (typedText: string) => PickerModel,
): Promise<PickerItem | undefined> {
  return new Promise(settle => {
    const pick = editor.window.createQuickPick();
    let model = initial;
    let items = itemsOf(model, translate);
    pick.placeholder = textOfId(
      initial.placeholder.id as FailureStringId,
      translate,
      initial.placeholder.values,
    );
    pick.canSelectMany = false;
    pick.ignoreFocusOut = true;
    pick.items = items;
    // The first row is focused once, before the pick shows. After a change of the text the editor keeps the focus
    // itself: setting it again would focus a row its own filter hid, and Enter would then pick nothing.
    pick.activeItems = items.slice(0, 1);
    let answer: PickerItem | undefined;
    pick.onDidChangeValue(typedText => {
      model = modelOf(typedText);
      items = itemsOf(model, translate);
      pick.items = items;
    });
    pick.onDidAccept(() => {
      const [taken] = pick.selectedItems;
      answer =
        taken === undefined ? undefined : model.items[items.indexOf(taken)];
      pick.hide();
    });
    pick.onDidHide(() => {
      pick.dispose();
      settle(answer);
    });
    pick.show();
  });
}

/** The editor's host pick: the quick pick `pickHost` runs, as the port the connect commands and the harness use. */
export function hostPickPortOf(
  editor: Editor,
  translate: Translate,
): HostPickPort {
  return {
    pick: (initial, modelOf) => pickHost(editor, translate, initial, modelOf),
  };
}

/** The opener's view of the editor: its commands, and the address it builds for a resource. */
export function openerHostOf(editor: Editor): OpenerHost {
  return {
    executeCommand: (command, ...parameters) =>
      editor.commands.executeCommand(command, ...parameters),
    addressOf: parts => editor.Uri.from(parts),
  };
}

/** The connect commands' editor: the host list is read by `listHosts` at each command, and the pick is `hostPick`. */
export function connectCommandEditorOf(
  editor: Editor,
  listHosts: () => HostListResult,
  hostPick: HostPickPort,
): ConnectCommandEditor {
  return {
    listHosts,
    pickHost: (initial, modelOf) => hostPick.pick(initial, modelOf),
    openRemote: async (authority, window) => {
      const outcome = await openRemote(openerHostOf(editor), authority, {
        pathKind: 'folder',
        target: window,
      });
      if (outcome.kind === 'rejected') {
        throw new Error(outcome.reason);
      }
    },
    runCommand: command => editor.commands.executeCommand(command),
    remoteName: () => editor.env.remoteName,
  };
}
