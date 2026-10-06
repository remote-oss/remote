/**
 * @fileoverview The extension's entry point. Activation registers the completion provider and does nothing else:
 * no output, no storage, no message.
 */

import * as vscode from 'vscode';
import {registerSshConfigCompletion} from './completion-adapter.ts';

/** Called by the editor on `onLanguage:ssh_config`. */
export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(registerSshConfigCompletion(vscode));
}
