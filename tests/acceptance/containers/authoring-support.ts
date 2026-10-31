/**
 * @fileoverview What the rows of the authoring wizard share: a window on a folder of the run holding the files a row
 * names, the wizard's command started without waiting for it, and the waits on its screen and its files.
 */

import {existsSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {
  closeWindow,
  startInWindow,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {
  pressEscape,
  quickPickOf,
  typeInQuickPick,
} from '../windows/renderer.ts';
import {runTemplatesReady} from '../windows/run-templates.ts';

/** The command that adds a configuration. */
export const COMMAND = 'remote-containers.createDevContainerFile';

/** The folder of the row `name` with the files `contents` names, made empty first, and the window on it. */
async function windowWith(
  name: string,
  contents: Readonly<Record<string, string>> = {},
): Promise<{window: string; folder: string}> {
  await runTemplatesReady();
  const folder = path.join(variable('HARNESS_RUN_FOLDER'), 'authoring', name);
  rmSync(folder, {recursive: true, force: true});
  mkdirSync(folder, {recursive: true});
  for (const [relative, text] of Object.entries(contents)) {
    const file = path.join(folder, relative);
    if (relative.endsWith('/')) {
      mkdirSync(file, {recursive: true});
      continue;
    }
    mkdirSync(path.dirname(file), {recursive: true});
    writeFileSync(file, text);
  }
  return {window: await openFolderWindow(folder), folder};
}

/**
 * Starts the command in `window` and returns once the window has accepted it, without waiting for it to end: it ends
 * only when the wizard does, and a command that reloads the window would leave a poll running past the row.
 */
export function startCommand(window: string, command = COMMAND): Promise<void> {
  return startInWindow(window, command);
}

/** Runs `body` over a window with the files, and closes the window after. */
export async function withWindow(
  name: string,
  contents: Readonly<Record<string, string>>,
  body: (window: string, folder: string) => Promise<void>,
): Promise<void> {
  const {window, folder} = await windowWith(name, contents);
  try {
    await body(window, folder);
  } finally {
    await closeWindow(window).catch(() => undefined);
  }
}

/** Waits until `file` exists. */
export function written(file: string): Promise<void> {
  return waitFor(`${file} to be written`, () => existsSync(file), 60_000);
}

/** The files named `relatives` under `folder`, those that exist. */
export function existing(folder: string, ...relatives: string[]): string[] {
  return relatives.filter(relative => existsSync(path.join(folder, relative)));
}

/**
 * Closes the screen of `window` with Escape, the input focused first because the focus may sit elsewhere, and waits
 * until it is gone; the editor takes a moment to hide it, so Escape is pressed again if it is still there after 3 s.
 */
export async function closeScreen(window: string): Promise<void> {
  const trail: unknown[] = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await typeInQuickPick(window, '');
    await pressEscape(window);
    await new Promise(resolve => setTimeout(resolve, 3000));
    const left = await quickPickOf(window);
    trail.push(left === undefined ? 'closed' : left.items.slice(0, 3));
    if (left === undefined) {
      return;
    }
  }
  throw new Error(`the pick did not close: ${JSON.stringify(trail)}`);
}
