/**
 * @fileoverview What the rows of the rebuild prompt share: the notification's words, a host-side rewrite of the
 * configuration, the reads of the notification centre and a window connected to a folder's container.
 */

import {execFile} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {inWindow, reopenInContainer, variable, waitFor} from './harness.ts';
import {openFolderWindow} from './folder-windows.ts';
import {notificationCentre} from './renderer.ts';

/** The words of the notification for the files `names`. */
export function changed(names: string): string {
  return `Configuration file(s) changed: ${names}. The container might need to be rebuilt to apply the changes.`;
}

/** The start of every such notification. */
export const CHANGED_START = 'Configuration file(s) changed:';

/** Writes `changes` over the configuration of `folder` on the host, as an editor of another process would. */
export function rewriteConfiguration(
  folder: string,
  changes: Readonly<Record<string, unknown>>,
): void {
  const file = path.join(folder, '.devcontainer', 'devcontainer.json');
  writeFileSync(
    file,
    JSON.stringify({
      ...(JSON.parse(readFileSync(file, 'utf8')) as object),
      ...changes,
    }),
  );
}

/** The notifications of window `name` about changed configuration files, newest first. */
export async function changedNotices(name: string): Promise<string[]> {
  return (await notificationCentre(name)).filter(text =>
    text.startsWith(CHANGED_START),
  );
}

/** Waits until window `name` has `count` such notifications, and gives them. */
export async function noticesWhen(
  name: string,
  count: number,
): Promise<string[]> {
  let seen: string[] = [];
  await waitFor(
    `${String(count)} notification(s) about changed files in window ${name}`,
    async () => {
      seen = await changedNotices(name);
      return seen.length >= count;
    },
    30_000,
  );
  return seen;
}

/** Runs Clear All Notifications in window `name`. Measured: the command clears only after the centre has been opened by a read and hidden again, so the sequence is the one that clears. */
export async function clearNotifications(name: string): Promise<void> {
  await inWindow(name, 'notifications.clearAll');
  await new Promise(resolve => setTimeout(resolve, 3000));
  await changedNotices(name);
  await inWindow(name, 'notifications.hideList');
  await inWindow(name, 'notifications.clearAll');
  await new Promise(resolve => setTimeout(resolve, 2000));
}

/** The notifications of window `name` about changed files after it has been left alone for `seconds`. */
export async function noticesAfter(
  name: string,
  seconds: number,
): Promise<string[]> {
  await new Promise(resolve => setTimeout(resolve, seconds * 1000));
  return changedNotices(name);
}

/** Opens `folder` in its container and gives the window, after the container and the window have settled. */
export async function connectedWindow(folder: string): Promise<string> {
  const name = await openFolderWindow(folder);
  await reopenInContainer(name);
  await new Promise(resolve => setTimeout(resolve, 3000));
  return name;
}

const execFileAsync = promisify(execFile);

/** The output of `docker` run with `parameters` in the Docker configuration that the launch gives the editor, trimmed. */
export async function dockerInLaunch(...parameters: string[]): Promise<string> {
  const {stdout} = await execFileAsync('docker', parameters, {
    env: {
      ...process.env,
      DOCKER_CONFIG: path.join(variable('HARNESS_RUN_FOLDER'), 'docker-config'),
    },
  });
  return stdout.trim();
}
