/**
 * @fileoverview The entry of Remote Explorer in the web editor: a web editor has no runtime-arguments file to set
 * up, so the activation has nothing to run before it registers.
 */

import * as vscode from 'vscode';
import {activateInWindow} from './window-activation.ts';

/** Called by the editor when the extension activates. */
export function activate(context: vscode.ExtensionContext): Promise<void> {
  return activateInWindow(vscode, context, () => Promise.resolve());
}
