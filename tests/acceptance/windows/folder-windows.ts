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
  closeWindow,
  devContainersOf,
  inWindow,
  isOpen,
  variable,
  waitFor,
  windowEvents,
  windowNames,
  writeUserSetting,
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
    target === 'memfs:/' ? target : pathToFileURL(target).href,
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

/** The name of a window whose first folder is the in-memory `memfs:/` of the window agent. */
const MEMORY_WINDOW = 'memfs';

/**
 * Opens a local window on the in-memory folder `memfs:/` and waits for its agent: the window of the folder itself, or,
 * with `workspaceFile`, the window of that saved `.code-workspace` file, which lists the folder. The agent of the
 * window serves the folder, empty until `writeMemoryFile` puts a file in it.
 */
export function openMemoryWindow(workspaceFile?: string): Promise<string> {
  return openLocalWindow(workspaceFile ?? 'memfs:/', MEMORY_WINDOW);
}

/** Writes `text` to `file` (an absolute path in the folder) of the in-memory folder served by window `name`. */
export function writeMemoryFile(
  name: string,
  file: string,
  text: string,
): Promise<void> {
  return inWindow(name, 'acceptance.agent.memoryWrite', file, text);
}

/** Sets a user setting from the local window, or removes it for `undefined`, and waits until the local window reads the result. */
export async function setUserSetting(
  settingId: string,
  value: unknown,
): Promise<void> {
  await writeUserSetting(settingId, value, 'local', 30_000);
}

/** Removes every container of the run made for `folder`. */
export async function removeContainers(folder: string): Promise<void> {
  const containerIds = await devContainersOf(folder);
  if (containerIds.length > 0) {
    await execFileAsync('docker', ['rm', '-f', ...containerIds]);
  }
}

/** Runs `docker` with the arguments and gives what it printed. */
export type DockerRunner = (
  dockerArguments: readonly string[],
) => Promise<{stdout: string}>;

/** Runs the real `docker`. */
function realDocker(
  dockerArguments: readonly string[],
): Promise<{stdout: string}> {
  return execFileAsync('docker', dockerArguments);
}

/**
 * Removes every container carrying the run's label, and no other: a developer's own containers on the same daemon are
 * left, so the rows that read the daemon's containers fail there instead of removing them.
 */
export async function removeRunContainers(
  runId = variable('HARNESS_RUN_ID'),
  docker: DockerRunner = realDocker,
): Promise<void> {
  const {stdout} = await docker([
    'ps',
    '--all',
    '--quiet',
    '--filter',
    `label=remote-oss.acceptance.run=${runId}`,
  ]);
  const containerIds = stdout.split('\n').filter(line => line !== '');
  if (containerIds.length > 0) {
    await docker(['rm', '-f', ...containerIds]);
  }
}

/**
 * Closes the windows the earlier rows left open, then removes the containers of the run. The rows of a view read the
 * rows the view draws, and a list that outgrows the view's panel draws only the first of them, so each starts with no
 * container left by an earlier row. The windows go first: one left open would try to reconnect to a container removed
 * under it.
 */
export async function clearEarlierRows(): Promise<void> {
  for (const name of windowNames()) {
    if (name !== 'local' && isOpen(name)) {
      // Best effort: a window that does not close belongs to a row that has failed already, and must not fail this one.
      await closeWindow(name).catch(() => undefined);
    }
  }
  await removeRunContainers();
}
