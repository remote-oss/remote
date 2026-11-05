/**
 * @fileoverview The shared part of the recovery container's rows (card containers-162): the windows' names, the
 * clone warning and the failure dialog's buttons, starting a broken clone and reaching its recovery container, and
 * the volume's recovery containers.
 */

import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {
  connectedToContainer,
  startInWindow,
  waitFor,
} from '../windows/harness.ts';
import {openMemoryWindow} from '../windows/folder-windows.ts';
import {
  acceptQuickPick,
  answerDialog,
  dialogOf,
  quickPickOf,
  typeInQuickPick,
  waitForDialog,
} from '../windows/renderer.ts';
import {clonedVolumes, containersWith} from '../windows/volume-clones.ts';

const execFileAsync = promisify(execFile);

/** The window of the clone of `broken.git`, named after its folder. */
export const FIRST = 'broken';

/** The window of the clone of `broken-two.git`, named after its folder. */
export const SECOND = 'broken-two';

/** The text of the clone warning, which shows once in the profile. */
export const CLONE_WARNING =
  'Cloning a repository in a Dev Container may execute arbitrary code.';

/** The failure dialog's buttons for a volume window, in the order the dialog lists them. */
export const FOUR_BUTTONS = [
  'Close Remote',
  'Edit devcontainer.json in Recovery Container',
  'More Actions...',
  'Retry',
];

/** The offer's button. */
export const RECOVERY = 'Edit devcontainer.json in Recovery Container';

/**
 * Types `source` into the clone command of a new memory-folder window, giving the warning its Got It when it shows; the
 * window's failure dialog is then the next thing to wait for.
 */
export async function startClone(source: string): Promise<void> {
  const local = await openMemoryWindow();
  await startInWindow(local, 'remote-containers.openRepositoryInUniqueVolume');
  await waitFor(
    'the clone warning or the source pick',
    async () =>
      (await dialogOf(local)) !== undefined ||
      (await quickPickOf(local)) !== undefined,
    60_000,
  );
  if ((await dialogOf(local))?.message === CLONE_WARNING) {
    await answerDialog(local, 'Got It');
  }
  await typeInQuickPick(local, source);
  await acceptQuickPick(local);
}

/** Clones `source` until its build fails, then asks the dialog for the recovery container and waits for the window. */
export async function reachRecovery(
  source: string,
  folder: string,
): Promise<void> {
  await startClone(source);
  await waitForDialog(folder, 900_000);
  await answerDialog(folder, RECOVERY);
  await connectedToContainer(folder, 900_000);
}

/** The recovery containers of the volume, in any state, as ids. */
export async function recoveryContainers(volume: string): Promise<string[]> {
  return containersWith(`vsch.local.volume=${volume}`);
}

/** The name of the one volume the clone of `source` made. */
export async function volumeOf(source: string): Promise<string> {
  return String((await clonedVolumes(source))[0]?.split(' ')[0]);
}

/** What `docker inspect` prints for `container` through the Go template `format`. */
export async function inspected(
  container: string,
  format: string,
): Promise<string> {
  const {stdout} = await execFileAsync('docker', [
    'inspect',
    '--format',
    format,
    container,
  ]);
  return stdout.trim();
}
