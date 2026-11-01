/**
 * @fileoverview What the rows of the authoring wizard share: a window on a folder of the run holding the files a row
 * names, the wizard's command started without waiting for it, and the waits on its screen and its files.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {openFolderWindow} from './folder-windows.ts';
import {closeWindow, startInWindow, variable, waitFor} from './harness.ts';
import {
  acceptQuickPick,
  chooseQuickPickRow,
  detailedQuickPickRows,
  pressEscape,
  quickPickFacts,
  quickPickOf,
  quickPickRows,
  type QuickPickRow,
  typeInQuickPick,
  waitForQuickPick,
} from './renderer.ts';
import {runTemplatesReady} from './run-templates.ts';

/** The command that adds a configuration. */
export const COMMAND = 'remote-containers.createDevContainerFile';

/** The workspace row of the location pick. */
export const WORKSPACE_ROW = 'Add configuration to workspace';

/** The user data row of the location pick. */
export const USER_DATA_ROW = 'Add configuration to user data folder';

/** The placeholder of the location pick. */
const LOCATION_PLACEHOLDER =
  'Where would you like to create your container configuration?';

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

/**
 * Starts the command in `window` and returns once the window has accepted it, without waiting for it to end: it ends
 * only when the wizard does, and a command that reloads the window would leave a poll running past the row.
 */
export function startCommand(window: string, command = COMMAND): Promise<void> {
  return startInWindow(window, command);
}

/** Waits until the pick that follows the location pick shows, which replaces it. */
export function waitForPickAfterLocation(window: string): Promise<void> {
  return waitFor(
    'the pick after the location pick',
    async () => {
      const shown = await quickPickOf(window);
      return (
        shown !== undefined &&
        shown.items.length > 0 &&
        shown.placeholder !== LOCATION_PLACEHOLDER
      );
    },
    30_000,
  );
}

/** Answers the location pick of `window` with the workspace row, and waits for the template pick. */
export async function chooseWorkspace(window: string): Promise<void> {
  await waitFor(
    'the location pick',
    async () =>
      (await quickPickFacts(window))?.placeholder === LOCATION_PLACEHOLDER,
    180_000,
  );
  await chooseQuickPickRow(window, WORKSPACE_ROW);
  await waitForPickAfterLocation(window);
}

/** Waits for the option screen whose placeholder is `placeholder`, and takes its focused item, the template's default. */
export async function takeOptionScreen(
  window: string,
  placeholder: string,
): Promise<void> {
  await waitFor(
    `the option screen ${placeholder}`,
    async () => (await quickPickOf(window))?.placeholder === placeholder,
    60_000,
  );
  await new Promise(resolve => setTimeout(resolve, 500));
  await acceptQuickPick(window);
}

/** The placeholder of the one option screen of the Alpine template. */
export const ALPINE_OPTION = 'Alpine version:';

/** The placeholder of the Select Features screen. */
export const FEATURES_PLACEHOLDER = 'Select additional features to install';

/** The placeholder of the Optional Files/Directories screen. */
const OPTIONAL_PLACEHOLDER = 'Include the following optional files/directories';

/** Waits for Optional Files/Directories and presses OK with nothing checked, which leaves every optional file out. */
export async function takeOptionalScreen(window: string): Promise<void> {
  await takeOptionScreen(window, OPTIONAL_PLACEHOLDER);
}

/**
 * Waits for Select Features and presses OK with nothing checked, then takes the optional files of the template; a
 * template that has none (`optional` false) ends the wizard there.
 */
export async function takeFeatureScreen(
  window: string,
  optional = true,
): Promise<void> {
  await takeOptionScreen(window, FEATURES_PLACEHOLDER);
  if (optional) {
    await takeOptionalScreen(window);
  }
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

/** What a written configuration holds that the rows read: its Features, and its keys in the order written. */
export type WrittenConfiguration = Record<string, unknown> & {
  features?: Record<string, unknown>;
};

/** The configuration a row's wizard wrote into `folder`, once it is there, its commented lines and trailing commas dropped. */
export async function configurationOf(
  folder: string,
): Promise<WrittenConfiguration> {
  const file = path.join(folder, CONFIGURATION);
  await written(file);
  await new Promise(resolve => setTimeout(resolve, 1000));
  const text = readFileSync(file, 'utf8')
    .split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .join('\n')
    .replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(text) as WrittenConfiguration;
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

/** The id that names one of the run's own templates in its registry, which the wizard takes as a custom id. */
function labId(name: string): string {
  return `${variable('HARNESS_TEMPLATE_REGISTRY')}/remote-oss-run/custom/${name}:1`;
}

/** Runs the wizard in `window` and takes the template `name` of the run's registry by its id; its first screen follows. */
export async function startedWith(window: string, name: string): Promise<void> {
  await startCommand(window);
  await chooseWorkspace(window);
  await typeInQuickPick(window, labId(name));
  await new Promise(resolve => setTimeout(resolve, 1500));
  await acceptQuickPick(window);
}

/** Waits until the pick shows the screen whose placeholder is `placeholder`, and gives its rows. */
export async function screenWith(
  window: string,
  placeholder: string,
): Promise<QuickPickRow[]> {
  await waitFor(
    `the screen ${placeholder}`,
    async () => (await quickPickOf(window))?.placeholder === placeholder,
    60_000,
  );
  await new Promise(resolve => setTimeout(resolve, 500));
  return quickPickRows(window);
}

/** Takes the focused row of each screen of `placeholders`, in turn. */
export async function takenThrough(
  window: string,
  placeholders: readonly string[],
): Promise<void> {
  for (const placeholder of placeholders) {
    await screenWith(window, placeholder);
    await acceptQuickPick(window);
  }
}

/** The placeholders of the string option screens of the options-lab template, in order. */
export const STRING_SCREENS = ['Flavour:', 'Channel:', 'Motto:'] as const;

/** The placeholder of the boolean option screen of the options-lab template. */
export const BOOLEAN_SCREEN =
  "Select the options for the 'Options Lab' dev container";

/** The store of the launch's profile: where the extension keeps the configurations that are not in a workspace. */
export function storeRoot(): string {
  return path.join(
    variable('HARNESS_USER_DATA'),
    'User',
    'globalStorage',
    'remote-oss.remote-containers',
    'configs',
  );
}

/** Removes the slots of the run, so that a row starts with no configuration in the store. */
export function emptyStore(): void {
  rmSync(storeRoot(), {recursive: true, force: true});
}

/** The names of the slots in the store. */
export function slotNames(): string[] {
  return existsSync(storeRoot()) ? readdirSync(storeRoot()).sort() : [];
}

/** The rows of the pick open in `window` as the rows of this card are compared: label, description, second line. */
export async function rowsOf(
  window: string,
): Promise<Array<[string, string, string, boolean]>> {
  return (await detailedQuickPickRows(window)).map(each => [
    each.label,
    each.description,
    each.detail,
    each.focused,
  ]);
}

/** Answers the location pick of `window` with the user data row and waits for the pick that follows it. */
export async function chooseUserData(window: string): Promise<void> {
  await waitForQuickPick(window);
  await chooseQuickPickRow(window, USER_DATA_ROW);
  await waitForPickAfterLocation(window);
}

/** Runs the command in `window` for the user data folder and picks the template labelled `label`. */
export async function writeToStore(
  window: string,
  label = 'Alpine',
): Promise<void> {
  await startCommand(window);
  await chooseUserData(window);
  await chooseQuickPickRow(window, label);
  await takeOptionScreen(window, ALPINE_OPTION);
  await takeFeatureScreen(window);
}

/** The files under `folder`, relative and sorted. */
export function filesIn(folder: string): string[] {
  return readdirSync(folder, {recursive: true, withFileTypes: true})
    .filter(entry => entry.isFile())
    .map(entry =>
      path.relative(folder, path.join(entry.parentPath, entry.name)),
    )
    .sort();
}
