/**
 * @fileoverview The one adapter between the call protocol and the editor: the command bus over the editor's commands
 * and the timers over the host's clock. The extension passes the editor's API in.
 */

import type * as vscode from 'vscode';
import type {CommandBus, Timers} from './protocol.ts';

/** The part of the editor API the adapter uses; the extension passes the real `vscode` module. */
export type CompanionEditorApi = Pick<typeof vscode, 'commands'>;

/** The command bus over the editor's commands. */
export function commandBus(editor: CompanionEditorApi): CommandBus {
  return {
    executeCommand: (commandId, argument) =>
      editor.commands.executeCommand(commandId, argument),
    registerCommand: (commandId, callback) =>
      editor.commands.registerCommand(commandId, callback),
  };
}

/** The timers over the host's clock. */
export const systemTimers: Timers = {
  setTimer: (callback, milliseconds) =>
    globalThis.setTimeout(callback, milliseconds),
  clearTimer: handle => {
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};
