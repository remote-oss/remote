/**
 * @fileoverview What the rows on the Dev Containers view of the Remote Explorer share: its name and a wait for its
 * rows.
 */

import {execFile} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  inWindow,
  runLabelArguments,
  runScopedName,
  variable,
  waitFor,
} from './harness.ts';
import {
  dialogKindOf,
  rowDetails,
  type RowDetails,
  rowMenuAction,
  waitForDialog,
} from './renderer.ts';

/** The name of the view. */
export const VIEW = 'Dev Containers';

/** Waits until the view of window `name` has rows that `ready` accepts, and gives them. */
export async function rowsWhen(
  name: string,
  ready: (rows: RowDetails[]) => boolean,
  milliseconds = 60_000,
): Promise<RowDetails[]> {
  let shown: RowDetails[] = [];
  await waitFor(
    `the rows of ${VIEW} in window ${name}`,
    async () => {
      try {
        shown = (await rowDetails(name, VIEW)) ?? [];
      } catch {
        return false;
      }
      return ready(shown);
    },
    milliseconds,
  );
  return shown;
}

/** A program for `dev.containers.dockerPath` that runs `intercept` first, and then passes the call on to docker. */
export function dockerWrapper(name: string, intercept: string): string {
  const wrapper = path.join(variable('HARNESS_RUN_FOLDER'), name);
  writeFileSync(wrapper, `#!/bin/sh\n${intercept}\nexec docker "$@"\n`, {
    mode: 0o755,
  });
  return wrapper;
}

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

/** Opens the Dev Containers view in the local window and waits for the row labelled `label`. */
export async function viewed(label: string): Promise<void> {
  await inWindow('local', 'workbench.view.remote');
  await rowsWhen('local', rows => rows.some(each => each.label === label));
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

/** Picks the context menu item `item` of the row `label` in the local window. */
export function chosen(label: string, item: string): Promise<void> {
  return rowMenuAction('local', VIEW, label, item);
}
