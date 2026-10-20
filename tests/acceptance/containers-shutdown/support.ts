import {readFileSync} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {
  closeWindow,
  devContainerFolder,
  devContainersOf,
  reopenInContainer,
  waitFor,
} from '../windows/harness.ts';
import {openFolderWindow} from '../windows/folder-windows.ts';

const execFileAsync = promisify(execFile);

/** What `docker inspect` says of a container's state: its status and the exit code of its last run. */
export interface ContainerState {
  status: string;
  exitCode: number;
}

/** The state of container `containerId`; `gone` when the engine has no such container. */
export async function stateOf(
  containerId: string,
): Promise<ContainerState | 'gone'> {
  try {
    const {stdout} = await execFileAsync('docker', [
      'inspect',
      '--format',
      '{{.State.Status}} {{.State.ExitCode}}',
      containerId,
    ]);
    const [status = '', code = '0'] = stdout.trim().split(' ');
    return {status, exitCode: Number(code)};
  } catch {
    return 'gone';
  }
}

/** A window opened on a folder of the run and reopened in its container, with the container's id. */
export interface ConnectedWindow {
  window: string;
  folder: string;
  containerId: string;
}

/** Opens a window on a new folder with `configuration`, reopens it in its container and gives the three. */
export async function connectedWindow(
  name: string,
  configuration: Readonly<Record<string, unknown>> = {},
): Promise<ConnectedWindow> {
  const folder = devContainerFolder(name, {name: 'Shutdown', ...configuration});
  const window = await openFolderWindow(folder);
  await reopenInContainer(window);
  const [containerId = ''] = await devContainersOf(folder);
  return {window, folder, containerId};
}

/** What became of a container over the seconds after its window was closed. */
export interface Outcome {
  /** The state read at each second, `seconds` apart from the close: status and exit code, or `gone`. */
  states: Array<ContainerState | 'gone'>;
  /** The seconds after the close at which the container was first not running; undefined when it never stopped. */
  stoppedAfter: number | undefined;
}

/**
 * Closes `connected`'s window and reads its container's state once a second for `seconds` seconds, from the close;
 * it gives the states and when the container stopped.
 */
export async function closedAndWatched(
  connected: ConnectedWindow,
  seconds: number,
): Promise<Outcome> {
  await closeWindow(connected.window);
  return watched(connected.containerId, seconds, Date.now());
}

/** Reads the state of `containerId` once a second for `seconds` seconds counted from `from`. */
export async function watched(
  containerId: string,
  seconds: number,
  from: number,
): Promise<Outcome> {
  const states: Array<ContainerState | 'gone'> = [];
  let stoppedAfter: number | undefined;
  for (let second = 0; second <= seconds; second += 1) {
    const wait = from + second * 1000 - Date.now();
    if (wait > 0) {
      await new Promise(resolve => setTimeout(resolve, wait));
    }
    const state = await stateOf(containerId);
    states.push(state);
    if (
      stoppedAfter === undefined &&
      (state === 'gone' || state.status !== 'running')
    ) {
      stoppedAfter = second;
    }
  }
  return {states, stoppedAfter};
}

/** Removes the containers the folder's configuration made, and the one `extra` names. */
export async function removeContainersOf(
  folder: string,
  extra: readonly string[] = [],
): Promise<void> {
  const found = await devContainersOf(folder);
  const ids = [
    ...found,
    ...extra.filter(
      id => !found.some(one => id.startsWith(one) || one.startsWith(id)),
    ),
  ];
  if (ids.length > 0) {
    await execFileAsync('docker', ['rm', '--force', ...ids]);
  }
}

/** Waits until container `containerId` is not running; fails naming it after `milliseconds`. */
export async function untilStopped(
  containerId: string,
  milliseconds: number,
): Promise<void> {
  await waitFor(
    `container ${containerId} to stop`,
    async () => {
      const state = await stateOf(containerId);
      return state === 'gone' || state.status !== 'running';
    },
    milliseconds,
  );
}

/** The seconds after a close in which a container that the close stops is read to have stopped, with a margin of 3 s. */
export const STOP_WINDOW = {from: 10, to: 15} as const;

/** Whether every state read was running. */
export function stayedRunning(outcome: Outcome): boolean {
  return outcome.states.every(
    state => state !== 'gone' && state.status === 'running',
  );
}

/** Whether the container was exited with code `exitCode` and stopped within `window` of the close. */
export function stoppedWithin(
  outcome: Outcome,
  exitCode: number,
  window: {from: number; to: number} = STOP_WINDOW,
): boolean {
  const last = outcome.states.at(-1);
  return (
    outcome.stoppedAfter !== undefined &&
    outcome.stoppedAfter >= window.from &&
    outcome.stoppedAfter <= window.to &&
    last !== undefined &&
    last !== 'gone' &&
    last.status === 'exited' &&
    last.exitCode === exitCode
  );
}

/** The actions Docker's events name for container `containerId` from `sinceMilliseconds` (epoch) until now. */
export async function eventsSince(
  containerId: string,
  sinceMilliseconds: number,
): Promise<string[]> {
  const {stdout} = await execFileAsync('docker', [
    'events',
    '--since',
    String(Math.floor(sinceMilliseconds / 1000)),
    '--until',
    String(Math.ceil(Date.now() / 1000) + 1),
    '--filter',
    `container=${containerId}`,
    '--format',
    '{{.Action}}',
  ]);
  return stdout.split('\n').filter(line => line !== '');
}

/** The events that end or start a container: the kill, the stop, the die and the start. */
export function lifecycleEvents(actions: readonly string[]): string[] {
  return actions.filter(action =>
    ['kill', 'stop', 'die', 'start'].includes(action),
  );
}

/** The process ids of the run's user's shutdown helpers: none once the last window's check has run. */
export async function helperProcesses(): Promise<string[]> {
  try {
    const {stdout} = await execFileAsync('pgrep', [
      '-f',
      'shutdown-helper[.]js',
    ]);
    return stdout.split('\n').filter(line => line !== '');
  } catch {
    return [];
  }
}

/** The parent process id of `pid`, read from `/proc`; 0 for none. */
export function parentOf(pid: string): string {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1] ?? '0';
  } catch {
    return '0';
  }
}

/** The process ids from `pid` up through its parents to the first process, `pid` first. */
export function chainOf(pid: string): string[] {
  const chain: string[] = [];
  let current = pid;
  while (current !== '0' && current !== '1' && !chain.includes(current)) {
    chain.push(current);
    current = parentOf(current);
  }
  return chain;
}

/** The id of the run's editor's main process: the one on the run's user data folder that is no helper of the editor. */
export async function editorMainProcess(userData: string): Promise<string[]> {
  try {
    const {stdout} = await execFileAsync('pgrep', [
      '-f',
      '--',
      `--user-data-dir=${userData}`,
    ]);
    return stdout
      .split('\n')
      .filter(line => line !== '')
      .filter(pid => {
        const command = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
        return !command.includes('--type=');
      });
  } catch {
    return [];
  }
}
