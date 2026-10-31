/**
 * @fileoverview What the rows of the authoring wizard share: a window on a folder of the run holding the files a row
 * names, the wizard's command started without waiting for it, and the waits on its screen and its files.
 */

import {existsSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {closeWindow, inWindow, variable, waitFor} from '../windows/harness.ts';
import {pressEscape, quickPickOf} from '../windows/renderer.ts';
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

/** Runs the command in `window` without waiting for it, which ends only when the wizard does. */
export function startCommand(window: string, command = COMMAND): void {
  inWindow(window, command).catch(() => undefined);
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

/** Closes the screen of `window` with Escape and waits until it is gone. */
export async function closeScreen(window: string): Promise<void> {
  await pressEscape(window);
  await waitFor(
    'the pick to close',
    async () => (await quickPickOf(window)) === undefined,
    30_000,
  );
}
