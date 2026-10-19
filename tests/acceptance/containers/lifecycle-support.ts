import {execFile} from 'node:child_process';
import path from 'node:path';
import {promisify} from 'node:util';
import {devContainersOf, waitFor} from '../windows/harness.ts';
import {pageText, statusItem} from '../windows/renderer.ts';

const execFileAsync = promisify(execFile);

/** The status bar text F-0408 shows while background commands run. */
const CONFIGURING = 'Configuring Dev Container (show log)';

/** The remote indicator while the connect is not done. */
export const OPENING = 'Opening Remote...';

/** The file the commands of a row append to, in the workspace folder where each command starts. */
export const ORDER_FILE = '.c44-order';

/** A command that appends `label` and the time in seconds to the order file. */
export function mark(label: string): string {
  return `echo "${label} $(date +%s)" >> ${ORDER_FILE}`;
}

/** A command that waits until the signal file `signalName` exists in the workspace folder. */
export function waitSignal(signalName: string): string {
  return `while [ ! -e .c44-${signalName} ]; do sleep 0.2; done`;
}

/** The container workspace folder of `folder`'s container. */
export function workspaceOf(folder: string): string {
  return `/workspaces/${path.basename(folder)}`;
}

/** The one container of `folder`; it fails when the number is not one. */
export async function containerOf(folder: string): Promise<string> {
  const containers = await devContainersOf(folder);
  const [containerId] = containers;
  if (containerId === undefined || containers.length !== 1) {
    throw new Error(
      `expected one container of ${folder}, found ${
        containers.length === 0 ? 'none' : containers.join(', ')
      }`,
    );
  }
  return containerId;
}

/** Runs `command` in `folder`'s workspace folder in container `containerId` and gives its standard output. */
export async function inWorkspace(
  containerId: string,
  folder: string,
  command: string,
): Promise<string> {
  const {stdout} = await execFileAsync('docker', [
    'exec',
    '--workdir',
    workspaceOf(folder),
    containerId,
    'sh',
    '-c',
    command,
  ]);
  return stdout;
}

/** The labels of the order file's lines, in file order; a file not written yet is empty. */
export async function labelsOf(
  containerId: string,
  folder: string,
): Promise<string[]> {
  const text = await inWorkspace(
    containerId,
    folder,
    `cat ${ORDER_FILE} 2>/dev/null || true`,
  );
  return text
    .split('\n')
    .filter(line => line !== '')
    .map(line => line.split(' ')[0] ?? '');
}

/** The time in seconds of the order file's line labelled `label`. */
export async function timeOf(
  containerId: string,
  folder: string,
  label: string,
): Promise<number> {
  const text = await inWorkspace(containerId, folder, `cat ${ORDER_FILE}`);
  const line = text.split('\n').find(each => each.startsWith(`${label} `));
  if (line === undefined) {
    throw new Error(`no line ${label} in ${text}`);
  }
  return Number(line.split(' ')[1]);
}

/** Makes the signal file `signalName` in `folder`'s workspace folder, which the waiting command is looking for. */
export async function signal(
  containerId: string,
  folder: string,
  signalName: string,
): Promise<void> {
  await inWorkspace(containerId, folder, `touch .c44-${signalName}`);
}

/** Waits until the order file holds at least the labels `wanted`. */
export async function untilLabels(
  containerId: string,
  folder: string,
  wanted: readonly string[],
): Promise<void> {
  await waitFor(
    `the order file to hold ${wanted.join(', ')}`,
    async () => {
      const labels = await labelsOf(containerId, folder);
      return wanted.every(label => labels.includes(label));
    },
    120_000,
  );
}

/** The connect's state in window `name`: the remote indicator and whether the Configuring text shows. */
export async function stateOf(
  name: string,
): Promise<{indicator: string; configuring: boolean}> {
  return {
    indicator: (await statusItem(name, 'status.host')).text,
    configuring: (await pageText(name)).includes(CONFIGURING),
  };
}

/** Waits until `folder` has its container and gives its id. */
export async function waitForContainer(folder: string): Promise<string> {
  await waitFor(
    `the container of ${folder}`,
    async () => (await devContainersOf(folder)).length === 1,
    180_000,
  );
  return containerOf(folder);
}
