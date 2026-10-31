/**
 * @fileoverview What the rows of the authoring wizard share: the command, a window on an empty folder of the row, and
 * the waits on the files the wizard writes.
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
import {runTemplatesReady} from '../windows/run-templates.ts';

/** The command that starts the wizard. */
const COMMAND = 'remote-containers.createDevContainerFile';

/** The configuration the wizard writes, relative to the folder. */
export const CONFIGURATION = '.devcontainer/devcontainer.json';

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

/** Starts the command in `window`; it returns once the window has accepted it, and the wizard goes on in the window. */
export async function startCommand(window: string): Promise<void> {
  await startInWindow(window, COMMAND);
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
