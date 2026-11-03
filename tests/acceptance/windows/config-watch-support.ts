/**
 * @fileoverview What the rows of the rebuild prompt share: the notification's words, a host-side rewrite of the
 * configuration, the reads of the notification centre and a window connected to a folder's container.
 */

import {execFile} from 'node:child_process';
import {existsSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
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

/** The key under which the editor keeps the workspace state of our extension. */
const STATE_KEY = 'remote-oss.remote-containers';

/** The fingerprints the dev container window of `folder` has stored, as its workspace storage holds them; none when it holds none. */
export function storedHashes(
  folder: string,
): Record<string, string> | undefined {
  const root = path.join(
    variable('HARNESS_USER_DATA'),
    'User',
    'workspaceStorage',
  );
  const needle = Buffer.from(path.basename(folder)).toString('hex');
  for (const entry of readdirSync(root)) {
    const marker = path.join(root, entry, 'workspace.json');
    const database = path.join(root, entry, 'state.vscdb');
    if (
      !existsSync(marker) ||
      !existsSync(database) ||
      !readFileSync(marker, 'utf8').includes(`dev-container%2B`) ||
      !readFileSync(marker, 'utf8').includes(needle)
    ) {
      continue;
    }
    const connection = new DatabaseSync(database, {readOnly: true});
    try {
      const row = connection
        .prepare('SELECT value FROM ItemTable WHERE key = ?')
        .get(STATE_KEY) as {value: string} | undefined;
      const state =
        row === undefined
          ? undefined
          : (JSON.parse(row.value) as Record<string, unknown>);
      const stored = state?.[
        'remote-oss.remote-containers.configurationWatch'
      ] as
        | {configurationState?: {contentHashes?: Record<string, string>}}
        | undefined;
      return stored?.configurationState?.contentHashes;
    } finally {
      connection.close();
    }
  }
  return undefined;
}
