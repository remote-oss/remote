/**
 * @fileoverview The shared part of exploring a Volume in a Dev Container (card containers-155, part B): the window
 * name, the explore address, the explorer containers by their label, and the open-and-wait.
 */

import {connectedToContainer, hexOf, inWindow} from '../windows/harness.ts';
import {docker} from '../windows/dev-containers-view.ts';

/** The window of an explored volume is named after the folder `/volume`. */
export const WINDOW = 'volume';

/** The address of the window that explores the volume `volumeName`, as the command or a link opens it. */
export function exploreUri(volumeName: string): string {
  return `vscode-remote://dev-container+${hexOf({
    repositoryPath: '',
    volumeName,
    folder: 'volume',
    inspectVolume: true,
  })}/volume`;
}

/** The ids of the containers that carry the label `vsch.local.volume=<volumeName>`, stopped or not. */
export async function explorersOf(volumeName: string): Promise<string[]> {
  const output = await docker(
    'ps',
    '-a',
    '-q',
    '--no-trunc',
    '--filter',
    `label=vsch.local.volume=${volumeName}`,
  );
  return output === '' ? [] : output.split('\n');
}

/** Opens the explore window of `volumeName` and waits until it is connected. */
export async function explored(volumeName: string): Promise<void> {
  await inWindow(
    'local',
    'acceptance.agent.openWindow',
    exploreUri(volumeName),
  );
  await connectedToContainer(WINDOW, 900_000);
}
