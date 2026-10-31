/**
 * @fileoverview What the rows of the Dev Containers view's actions share: Docker called from the row, containers of the
 * run that the view lists as dev containers, and the readers of a row's icon, the dialog and the toasts of the local
 * window.
 */

import {execFile} from 'node:child_process';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  inWindow,
  runLabelArguments,
  runScopedName,
  variable,
  waitFor,
} from './harness.ts';
import {rowsWhen, VIEW} from './dev-containers-view.ts';
import {
  dialogKindOf,
  rowDetails,
  rowMenuAction,
  toastDetails,
  waitForDialog,
} from './renderer.ts';

const execFileAsync = promisify(execFile);

/** What `docker <argv>` printed, trimmed. */
export async function docker(...argv: string[]): Promise<string> {
  const {stdout} = await execFileAsync('docker', argv);
  return stdout.trim();
}

/** `State.Status` of a container, or `gone` when Docker has none by that name or id. */
export async function stateOf(container: string): Promise<string> {
  try {
    return await docker('inspect', '-f', '{{.State.Status}}', container);
  } catch {
    return 'gone';
  }
}

/** The full id of a container. */
export function idOf(container: string): Promise<string> {
  return docker('inspect', '-f', '{{.Id}}', container);
}

/**
 * Creates a container of the run named `runScopedName(base)` that the view lists as a dev container by the folder name
 * `base`, with `command` run in it. `started` false only creates it. `extra` is added to `docker create` before the image.
 */
export async function made(
  base: string,
  command: readonly string[],
  options: {started?: boolean; extra?: readonly string[]} = {},
): Promise<string> {
  const container = runScopedName(base);
  await docker(
    options.started === false ? 'create' : 'run',
    ...(options.started === false ? [] : ['-d']),
    '--name',
    container,
    ...runLabelArguments(),
    '--label',
    `devcontainer.local_folder=${path.join(variable('HARNESS_RUN_FOLDER'), base)}`,
    ...(options.extra ?? []),
    variable('HARNESS_DEVCONTAINER_IMAGE'),
    ...command,
  );
  return container;
}

/** Opens the Dev Containers view in window `name` (the local one by default) and waits for the row labelled `label`. */
export async function viewed(label: string, name = 'local'): Promise<void> {
  await inWindow(name, 'workbench.view.remote');
  await rowsWhen(name, rows => rows.some(each => each.label === label));
}

/** The icon of the row labelled `label` in window `name`, or none when the view lists no such row. */
export async function iconOf(
  name: string,
  label: string,
): Promise<string | undefined> {
  try {
    return (await rowDetails(name, VIEW))?.find(each => each.label === label)
      ?.icon;
  } catch {
    return undefined;
  }
}

/** Waits until the row labelled `label` of window `name` has the icon `icon`, or none when `icon` is undefined. */
export function iconReaches(
  name: string,
  label: string,
  icon: string | undefined,
  milliseconds = 30_000,
): Promise<void> {
  return waitFor(
    `the row ${label} to have the icon ${String(icon)}`,
    async () => (await iconOf(name, label)) === icon,
    milliseconds,
  );
}

/** What the open dialog of window `name` says. */
export async function shown(name: string): Promise<{
  message: string;
  details: string;
  buttons: string[];
  kind: string | undefined;
}> {
  const dialog = await waitForDialog(name, 30_000);
  return {...dialog, kind: await dialogKindOf(name)};
}

/** Picks the context menu item `item` of the row `label` in window `name` (the local one by default). */
export function chosen(
  label: string,
  item: string,
  name = 'local',
): Promise<void> {
  return rowMenuAction(name, VIEW, label, item);
}

/** The toasts of window `name` in the order shown, once there are `count` of them. */
export async function notified(
  name: string,
  count: number,
): Promise<Array<{message: string; buttons: string[]}>> {
  let shownToasts: Awaited<ReturnType<typeof toastDetails>> = [];
  await waitFor(
    `${String(count)} notifications in window ${name}`,
    async () => {
      shownToasts = await toastDetails(name);
      return shownToasts.length >= count;
    },
    30_000,
  );
  return shownToasts.map(({message, buttons}) => ({message, buttons}));
}

/** The ids `docker <listing>` prints, sorted: the containers, images or volumes the engine holds. */
export async function idsOf(...listing: string[]): Promise<string[]> {
  return (await docker(...listing))
    .split('\n')
    .filter(line => line !== '')
    .sort();
}
