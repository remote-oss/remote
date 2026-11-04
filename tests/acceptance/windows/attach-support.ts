/**
 * @fileoverview What the rows that attach to a running container share: the containers they start under a label of
 * their own, the Docker program that lists only those, and their removal.
 */

import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {dockerWrapper} from './dev-containers-view.ts';
import {
  runLabelArguments,
  startInWindow,
  variable,
  waitFor,
} from './harness.ts';
import {
  answerDialog,
  chooseQuickPickRow,
  quickPickRows,
  waitForDialog,
  waitForQuickPick,
} from './renderer.ts';

const execFileAsync = promisify(execFile);

/** The label every container of these rows carries, so that a listing sees these alone. */
const GROUP = 'remote-oss.c162';

/** A program for the Docker setting that lists the running containers of the group `group` and nothing else. */
export function listingOnly(name: string, group: string): string {
  return dockerWrapper(
    name,
    `if [ "$1" = ps ]; then shift; exec docker ps --filter label=${GROUP}=${group} "$@"; fi`,
  );
}

/** Runs `docker` with `parameters`. */
export async function docker(...parameters: string[]): Promise<string> {
  const {stdout} = await execFileAsync('docker', parameters);
  return stdout.trim();
}

/** Starts a container `name` of the group, doing nothing; gives its full id. */
export async function started(
  name: string,
  group: string,
  image = variable('HARNESS_DEVCONTAINER_IMAGE'),
): Promise<string> {
  return docker(
    'run',
    '-d',
    '--name',
    name,
    ...runLabelArguments(),
    '--label',
    `${GROUP}=${group}`,
    image,
    'sleep',
    'infinity',
  ).then(started => docker('inspect', '-f', '{{.Id}}', started));
}

/** Removes the containers of the group. */
export async function removeGroup(group: string): Promise<void> {
  const found = await docker(
    'ps',
    '-aq',
    '--filter',
    `label=${GROUP}=${group}`,
  );
  if (found !== '') {
    await docker('rm', '-f', ...found.split('\n'));
  }
}

/** The command that opens the picker of the running containers. */
const ATTACH_COMMAND = 'remote-containers.attachToRunningContainer';

/** Runs the attach command in the window `local`, accepts the warning when it comes, and picks the one row `label`. */
export async function pickedContainer(label: string): Promise<void> {
  await startInWindow('local', ATTACH_COMMAND);
  await waitForDialog('local', 60_000).then(
    () => answerDialog('local', 'Got It'),
    () => undefined,
  );
  await waitForQuickPick('local', 60_000);
  await waitFor(
    'the picker to fill',
    async () => (await quickPickRows('local')).length === 1,
    30_000,
  );
  await chooseQuickPickRow('local', label);
}
