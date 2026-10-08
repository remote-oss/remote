/**
 * @fileoverview Drives an SSH configuration file in the editor under test: opens it, triggers completion the way a
 * user does, waits, accepts, and reads the line back.
 */

import {mkdirSync, mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import * as vscode from 'vscode';

/** How completion is opened: Ctrl+Space, or typing letters that open the quick suggestions. */
export type CompletionTrigger = {invoke: true} | {typed: string};

/** The text of line 2 after opening completion there, waiting, and accepting the focused item. */
export async function acceptedAfterWait(
  trigger: CompletionTrigger,
  waitMilliseconds: number,
): Promise<string> {
  const folder = mkdtempSync(path.join(tmpdir(), 'ssh-config-'));
  mkdirSync(path.join(folder, '.ssh'));
  const file = path.join(folder, '.ssh', 'config');
  writeFileSync(
    file,
    '# fixture\n\nHost f4201a.invalid\n    HostName 192.0.2.1\n',
  );
  const document = await vscode.workspace.openTextDocument(file);
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(1, 0, 1, 0);
  await delay(1000);
  await ('invoke' in trigger
    ? vscode.commands.executeCommand('editor.action.triggerSuggest')
    : typeLetters(trigger.typed));
  await delay(waitMilliseconds);
  await vscode.commands.executeCommand('acceptSelectedSuggestion');
  await delay(300);
  const text = document.lineAt(1).text;
  await vscode.commands.executeCommand(
    'workbench.action.revertAndCloseActiveEditor',
  );
  return text;
}

async function typeLetters(letters: string): Promise<void> {
  for (const letter of letters) {
    await vscode.commands.executeCommand('type', {text: letter});
    await delay(150);
  }
}

/** The line texts of `count` trials of one trigger and wait. */
export async function trials(
  count: number,
  trigger: CompletionTrigger,
  waitMilliseconds: number,
): Promise<string[]> {
  const results: string[] = [];
  for (let trial = 0; trial < count; trial++) {
    results.push(await acceptedAfterWait(trigger, waitMilliseconds));
  }
  return results;
}
