/**
 * @fileoverview What the rows of the `explorer-home` launch share: the run's own HOME with its `.ssh` folder, the files
 * Remote - SSH reads from the disk, and a window that shows the Remote Explorer.
 */

import {mkdirSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {type ConfigFileReader, listHosts} from 'lib-ssh';
import {openFolderWindow} from './folder-windows.ts';
import {inWindow, variable, waitFor} from './harness.ts';
import {
  allQuickPickRows,
  pressEscape,
  quickPickFacts,
  quickPickValue,
} from './renderer.ts';

/** The run's HOME, as the launch gives it to the editor. */
function home(): string {
  return path.join(variable('HARNESS_RUN_FOLDER'), 'home');
}

/** The user's `.ssh` folder, made when it is missing. */
export function sshFolder(): string {
  const folder = path.join(home(), '.ssh');
  mkdirSync(folder, {recursive: true});
  return folder;
}

/** Writes `lines` to `relative` under the user's `.ssh` folder and gives its path. */
export function sshFile(relative: string, lines: readonly string[]): string {
  const file = path.join(sshFolder(), relative);
  mkdirSync(path.dirname(file), {recursive: true});
  writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
}

/** The files Remote - SSH reads, from the disk: text or entries, none for anything else. */
const FILE_READER: ConfigFileReader = {
  readText: file => {
    try {
      return readFileSync(file, 'utf8');
    } catch {
      return undefined;
    }
  },
  listFolder: folder => {
    try {
      return readdirSync(folder);
    } catch {
      return undefined;
    }
  },
};

/**
 * The system file's hosts as Remote - SSH lists them, its Include lines followed, the hosts that come after the user's
 * in every list: read with a home folder that holds no user file, so they don't depend on the machine's own file.
 */
export function systemHosts(): string[] {
  const listed = listHosts(
    '',
    {
      homeFolder: path.join(variable('HARNESS_RUN_FOLDER'), 'no-home'),
      platform: 'linux',
    },
    FILE_READER,
  );
  return 'hosts' in listed ? listed.hosts.map(entry => entry.name) : [];
}

/** A new folder window named `name` that shows the Remote Explorer. */
export async function viewWindow(name: string): Promise<string> {
  const folder = path.join(variable('HARNESS_RUN_FOLDER'), 'home-rows', name);
  mkdirSync(folder, {recursive: true});
  const window = await openFolderWindow(folder);
  await inWindow(window, 'workbench.view.remote');
  return window;
}

/** The placeholder of the Command Palette, which a picker or input is told apart from. */
const PALETTE_PLACEHOLDER = 'Type the name of a command to run.';

/** What a picker or input of Remote - SSH shows: its frame, the label and description of each row, and what the input holds. */
export interface PickShown {
  title: string;
  placeholder: string;
  rows: string[];
  value: string;
}

/** What the quick pick open in window `name` shows, once it is there. */
export async function pickShown(name: string): Promise<PickShown> {
  await waitFor(
    `a picker or input in window ${name}`,
    async () => {
      const shown = await quickPickFacts(name);
      return (
        shown !== undefined &&
        shown.placeholder !== PALETTE_PLACEHOLDER &&
        shown.placeholder !== ''
      );
    },
    30_000,
  );
  const facts = await quickPickFacts(name);
  return {
    title: facts?.title ?? '',
    placeholder: facts?.placeholder ?? '',
    rows: (await allQuickPickRows(name)).map(entry =>
      entry.description === ''
        ? entry.label
        : `${entry.label} | ${entry.description}`,
    ),
    value: await quickPickValue(name),
  };
}

/** Closes the quick pick open in window `name` with Escape, and waits until none is shown. */
export async function closePick(name: string): Promise<void> {
  await pressEscape(name);
  await waitFor(
    `the quick pick of window ${name} to close`,
    async () => (await quickPickFacts(name)) === undefined,
    10_000,
  );
}
