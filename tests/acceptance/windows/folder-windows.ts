/**
 * @fileoverview What the Dev Containers rows share: a local window opened on a folder or a workspace file, a user setting
 * changed and read back, and the containers of a folder removed.
 */

import {execFile} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {promisify} from 'node:util';
import {
  devContainersOf,
  inWindow,
  settingIn,
  waitFor,
  windowEvents,
} from './harness.ts';

const execFileAsync = promisify(execFile);

/** How many times window `name` has activated its agent. */
export function activations(name: string): number {
  return windowEvents(name).filter(each => each.event === 'activated').length;
}

/** Opens a local window on `target` from the local window, and waits for the agent of the window named `name`. */
async function openLocalWindow(target: string, name: string): Promise<string> {
  const before = activations(name);
  await inWindow(
    'local',
    'acceptance.agent.openWindow',
    pathToFileURL(target).href,
  );
  await waitFor(
    `window ${name} to activate its agent`,
    () => activations(name) > before,
    60_000,
  );
  return name;
}

/** Opens a local window on `folder` and waits for its agent; the window is named after the folder. */
export function openFolderWindow(folder: string): Promise<string> {
  return openLocalWindow(folder, path.basename(folder));
}

/**
 * Opens a local window on the `.code-workspace` file `workspaceFile` and waits for its agent. The window is named
 * after the workspace's first folder, as the agent names every window with folders, so the file must list one.
 */
export function openWorkspaceWindow(workspaceFile: string): Promise<string> {
  const listed = (
    JSON.parse(readFileSync(workspaceFile, 'utf8')) as {
      folders?: Array<{path?: string}>;
    }
  ).folders?.[0]?.path;
  if (listed === undefined) {
    throw new Error(`${workspaceFile} lists no folder to name its window by`);
  }
  return openLocalWindow(
    workspaceFile,
    path.basename(path.resolve(path.dirname(workspaceFile), listed)),
  );
}

/** Sets a user setting from the local window and waits until the local window reads it back. */
export async function setUserSetting(
  settingId: string,
  value: unknown,
): Promise<void> {
  await inWindow('local', 'acceptance.agent.updateSetting', settingId, value);
  await waitFor(
    `${settingId} to read back as ${JSON.stringify(value)}`,
    async () =>
      JSON.stringify((await settingIn('local', settingId)) ?? null) ===
      JSON.stringify(value ?? null),
    30_000,
  );
}

/** Removes every container of the run made for `folder`. */
export async function removeContainers(folder: string): Promise<void> {
  const containerIds = await devContainersOf(folder);
  if (containerIds.length > 0) {
    await execFileAsync('docker', ['rm', '-f', ...containerIds]);
  }
}
