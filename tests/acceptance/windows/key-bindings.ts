/**
 * @fileoverview The user keybindings a row presses and the user files it leaves unchanged: writing the launch's
 * `keybindings.json` for the keys of a row and putting it back, and the text of the user's settings and keybindings
 * files for the rows that compare them before and after a press (F-2006, card #2817).
 */

import {existsSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {variable} from './harness.ts';
import {settingsText} from './maintenance.ts';

/** One user keybinding: the key and the command it runs. */
export interface KeyBinding {
  key: string;
  command: string;
}

/** The launch's `keybindings.json`. */
function keybindingsFile(): string {
  return path.join(variable('HARNESS_USER_DATA'), 'User/keybindings.json');
}

/** The bytes of the launch's keybindings file, or nothing when it doesn't exist. */
function keybindingsText(): string | undefined {
  const file = keybindingsFile();
  return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
}

/**
 * Writes `bindings` as the launch's user keybindings and returns the function that puts the file back as it was: the
 * editor reads the file when it changes, so a row that presses a key waits for the binding to be there first.
 */
export function bindKeys(bindings: readonly KeyBinding[]): () => void {
  const file = keybindingsFile();
  const before = keybindingsText();
  writeFileSync(file, JSON.stringify(bindings));
  return () => {
    if (before === undefined) {
      rmSync(file, {force: true});
    } else {
      writeFileSync(file, before);
    }
  };
}

/** `bindKeys` for one key. */
export function bindKey(key: string, command: string): () => void {
  return bindKeys([{key, command}]);
}

/** The user files a row must leave unchanged, as text: the settings and the keybindings. */
export function userFilesText(): [string, string | undefined] {
  return [settingsText(), keybindingsText()];
}
