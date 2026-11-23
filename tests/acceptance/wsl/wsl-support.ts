/**
 * @fileoverview What the WSL rows share on a Linux machine: folders to open, the palette's WSL entries, and what a
 * command that should do nothing changed in the window.
 */

import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {readUserSettings, variable, windowNames} from '../windows/harness.ts';
import {paletteItems} from '../windows/palette.ts';
import {dialogOf, notifications, quickPickOf} from '../windows/renderer.ts';

/** A folder of the run named `label` holding `files`. */
export function runFolder(
  label: string,
  files: Readonly<Record<string, string>> = {},
): string {
  const folder = path.join(variable('HARNESS_RUN_FOLDER'), 'wsl', label);
  mkdirSync(folder, {recursive: true});
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(path.join(folder, name), text);
  }
  return folder;
}

/** The entries of the extension that the palette of window `name` lists for "WSL". */
export async function wslPaletteEntries(name: string): Promise<string[]> {
  return (await paletteItems(name, 'WSL')).filter(item =>
    item.startsWith('WSL: '),
  );
}

/** Everything in window `name` that a command doing nothing must leave as it was. */
export interface WindowEffects {
  windows: string;
  settings: string | undefined;
  picker: boolean;
  dialog: boolean;
  toasts: readonly string[];
}

/** What window `name` shows and what the run holds, before or after an action. */
export async function effectsOf(name: string): Promise<WindowEffects> {
  return {
    windows: windowNames().join(','),
    settings: readUserSettings(),
    picker: (await quickPickOf(name)) !== undefined,
    dialog: (await dialogOf(name)) !== undefined,
    toasts: await notifications(name),
  };
}
