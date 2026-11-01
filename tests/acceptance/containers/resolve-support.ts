import {execFile, execFileSync} from 'node:child_process';
import {chmodSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  containersLog,
  devContainerFolder,
  reopenInContainer,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {dialogOf, notificationCentre} from '../windows/renderer.ts';

const execFileAsync = promisify(execFile);

/** The pattern of our log's line for the port of the server a window connects to. */
const LISTENING = /^server listening on 127\.0\.0\.1:(\d+)$/;

/** How long a window is left after the connect, so core's remote status listener has settled. */
export const SETTLE_MILLISECONDS = 5000;

/** The output of `docker` run with `parameters`, without its ends' white space. */
export async function docker(...parameters: string[]): Promise<string> {
  const {stdout} = await execFileAsync('docker', parameters);
  return stdout.trim();
}

/** The ports that the lines of the Dev Containers log name as the server's, in order. */
export function serverPortsOf(lines: readonly string[]): number[] {
  return lines.flatMap(line => {
    const match = LISTENING.exec(line);
    return match === null ? [] : [Number(match[1])];
  });
}

/** What the Dev Containers log holds after its first `mark` lines. */
export function logSince(mark: number): string[] {
  return containersLog().slice(mark);
}

/** A server process in a container: its id and its command line's words. */
export interface ServerProcess {
  processId: number;
  argv: string[];
}

/**
 * The server processes of container `containerId`: those whose command line holds the connection token file option.
 * The pattern's bracket keeps the scanning shell's own command line out of the answer.
 */
export async function serverProcessesOf(
  containerId: string,
): Promise<ServerProcess[]> {
  const output = await docker(
    'exec',
    containerId,
    'sh',
    '-c',
    'for each in /proc/[0-9]*; do if tr "\\0" " " < "$each/cmdline" 2>/dev/null | grep -q -- "--connection-token-fil[e]"; then echo "${each#/proc/}"; fi; done',
  );
  const processes: ServerProcess[] = [];
  for (const line of output.split('\n').filter(each => each !== '')) {
    const words = await docker(
      'exec',
      containerId,
      'sh',
      '-c',
      `tr "\\0" "\\n" < /proc/${line}/cmdline`,
    );
    processes.push({processId: Number(line), argv: words.split('\n')});
  }
  return processes;
}

/** Waits until container `containerId` runs no server process. */
export async function untilNoServer(containerId: string): Promise<void> {
  await waitFor(
    'the server to be gone',
    async () => (await serverProcessesOf(containerId)).length === 0,
    30_000,
  );
}

/** Connects a window on a new folder named `label` with `configuration`, and gives the window, its container and the folder. */
export async function connectedWindow(
  label: string,
  configuration: Readonly<Record<string, unknown>> = {},
): Promise<{name: string; containerId: string; folder: string}> {
  const folder = devContainerFolder(label, {name: label, ...configuration});
  const name = await openFolderWindow(folder);
  await reopenInContainer(name);
  const containerId = await docker(
    'ps',
    '--all',
    '--quiet',
    '--filter',
    `label=devcontainer.local_folder=${folder}`,
  );
  return {name, containerId, folder};
}

/** Polls `read` every 100 ms until it holds; a reading that fails because the window reloads counts as not holding. */
export async function whenShown(
  description: string,
  read: () => Promise<boolean>,
  milliseconds: number,
): Promise<void> {
  await waitFor(description, () => read().catch(() => false), milliseconds);
}

/** The start of the reopen notification's message, to find it by (F-0402). */
export const NOTICE_START =
  'Folder contains a Dev Container configuration file.';

/** Whether window `name` shows the reopen notification within `milliseconds` of its agent's activation. */
export async function showsNotice(
  name: string,
  milliseconds = 10_000,
): Promise<boolean> {
  try {
    await whenShown(
      `the reopen notification in window ${name}`,
      async () =>
        (await notificationCentre(name)).some(text =>
          text.startsWith(NOTICE_START),
        ),
      milliseconds,
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * The first text of window `name`'s dialog, toasts or notification centre that holds `needle`, within `milliseconds`;
 * the whole text of a notification, or the dialog's message and details.
 */
export async function shownContaining(
  name: string,
  needle: string,
  milliseconds: number,
): Promise<string> {
  let found = '';
  await whenShown(
    `a text holding ${needle}`,
    async () => {
      const dialog = await dialogOf(name);
      const texts = [
        ...(dialog === undefined ? [] : [dialog.message, dialog.details]),
        ...(await notificationCentre(name)),
      ];
      found = texts.find(text => text.includes(needle)) ?? '';
      return found !== '';
    },
    milliseconds,
  );
  return found;
}

/** A `docker` program for `dev.containers.dockerPath` whose engine endpoint answers nothing; its path. */
export function noDaemonDocker(): string {
  const wrapper = path.join(variable('HARNESS_RUN_FOLDER'), 'docker-no-daemon');
  writeFileSync(
    wrapper,
    `#!/bin/sh\nDOCKER_HOST=unix:///tmp/remote-oss-no-daemon.sock exec ${execFileSync('sh', ['-c', 'command -v docker']).toString().trim()} "$@"\n`,
  );
  chmodSync(wrapper, 0o755);
  return wrapper;
}

/** The countdown text of core's reconnection dialog and notification. */
export const COUNTDOWN = /^Attempting to reconnect in \d+ seconds\.\.\.$/;

/** Waits, for up to `milliseconds`, until `read` gives something, reading every 500 ms. */
export async function eventually<Value>(
  what: string,
  read: () => Promise<Value | undefined>,
  milliseconds: number,
): Promise<Value> {
  const deadline = Date.now() + milliseconds;
  for (;;) {
    const value = await read().catch(() => undefined);
    if (value !== undefined) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

/** Like `connectedWindow`, and leaves the window `SETTLE_MILLISECONDS` after the connect: core draws no dialog for a permanent failure in about the first second. */
export async function settledWindow(
  label: string,
  configuration: Readonly<Record<string, unknown>> = {},
): Promise<{name: string; containerId: string; folder: string}> {
  const connected = await connectedWindow(label, configuration);
  await new Promise(resolve => setTimeout(resolve, SETTLE_MILLISECONDS));
  return connected;
}
