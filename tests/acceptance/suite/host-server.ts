/**
 * @fileoverview What the connect left on the harness host: the server our resolver installed and started, read in
 * the container outside SSH, and the record of it one launch keeps for the next.
 */

import {readFileSync, writeFileSync} from 'node:fs';
import * as path from 'node:path';
import {onHost} from './harness.ts';

/** The data folder of the VSCodium server in the home of the host's user. */
const DATA_FOLDER = '/home/harness/.vscodium-server-insiders';

/** The server on the host: its commit folders under `bin`, and the process id of the first one's start. */
export interface HostServer {
  commits: string[];
  processId: string;
}

/** The server the host has now. */
export async function hostServer(): Promise<HostServer> {
  const commits = (await onHost('ls', '-1', `${DATA_FOLDER}/bin`))
    .split('\n')
    .filter(name => name !== '');
  const processId = (
    await onHost('cat', `${DATA_FOLDER}/.${commits[0] ?? ''}.pid`)
  ).trim();
  return {commits, processId};
}

/** Whether a process with `processId` runs on the host. */
export async function isRunning(processId: string): Promise<boolean> {
  return (
    (
      await onHost(
        'sh',
        '-c',
        `kill -0 ${processId} 2>/dev/null && echo yes || echo no`,
      )
    ).trim() === 'yes'
  );
}

/** The file in the run's folder where one launch leaves the host's server for the next. */
function keptFile(): string {
  return path.join(process.env.HARNESS_RUN_FOLDER ?? '', 'first-server.json');
}

/** Keeps `server` for the next launch. */
export function keepServer(server: HostServer): void {
  writeFileSync(keptFile(), JSON.stringify(server));
}

/** The server an earlier launch kept. */
export function keptServer(): HostServer {
  return JSON.parse(readFileSync(keptFile(), 'utf8')) as HostServer;
}
