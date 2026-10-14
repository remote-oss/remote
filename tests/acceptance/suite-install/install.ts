/**
 * @fileoverview What the install rows read back: the download host's requests of this case, the server folders on the
 * host, and the files the client may have left.
 */

import {readdirSync, readFileSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import * as path from 'node:path';
import {onHost} from '../suite/harness.ts';

/** One request the download host logged: its path and the user agent that sent it. */
export interface DownloadRequest {
  path: string;
  userAgent: string;
}

/** A harness variable of the run; an error names it when the run does not set it. */
function runVariable(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(
      `${name} is not set; run the tests with pnpm test:acceptance:vscodium`,
    );
  }
  return value;
}

/**
 * The requests the download host logged since a launch began: the lines after the count the run noted for the launch
 * in `<run folder>/<launch>-requests-start`.
 */
export function requestsOfLaunch(launch: string): DownloadRequest[] {
  const start = Number(
    readFileSync(
      path.join(runVariable('HARNESS_RUN_FOLDER'), `${launch}-requests-start`),
      'utf8',
    ).trim(),
  );
  return readFileSync(runVariable('HARNESS_DOWNLOADS_LOG'), 'utf8')
    .split('\n')
    .filter(line => line !== '')
    .slice(start)
    .map(line => {
      const [, , requestPath = '', ...agent] = line.split(' ');
      return {path: requestPath, userAgent: agent.join(' ')};
    });
}

/** The requests the download host logged since the launch of this install case began. */
export function downloadRequests(label: string): DownloadRequest[] {
  return requestsOfLaunch(`install-${label}`);
}

/** Whether a user agent is one of the host's downloaders, not the editor. */
export function isHostDownloader(userAgent: string): boolean {
  return /wget|curl/i.test(userAgent);
}

/** The commit folders under `<dataFolder>/bin` on the host: the names of 40 hexadecimal digits. */
export async function installedCommits(dataFolder: string): Promise<string[]> {
  return (
    await onHost('sh', '-c', `ls -1 '${dataFolder}/bin' 2>/dev/null; true`)
  )
    .split('\n')
    .filter(name => /^[0-9a-f]{40}$/.test(name));
}

/** The entries under `<dataFolder>/bin` on the host, whatever their names. */
export async function binEntries(dataFolder: string): Promise<string[]> {
  return (
    await onHost('sh', '-c', `ls -1A '${dataFolder}/bin' 2>/dev/null; true`)
  )
    .split('\n')
    .filter(name => name !== '');
}

/** Whether a path exists on the host. */
export async function existsOnHost(hostPath: string): Promise<boolean> {
  return (
    (
      await onHost('sh', '-c', `test -e '${hostPath}' && echo yes || echo no`)
    ).trim() === 'yes'
  );
}

/** The size of the server archive the download host serves, from a `HEAD` of its `ok` path. */
export async function archiveSize(): Promise<number> {
  const answer = await fetch(
    `${runVariable('HARNESS_DOWNLOADS_LOCAL')}/ok/size/check`,
    {method: 'HEAD'},
  );
  return Number(answer.headers.get('content-length'));
}

/** When this case's launch began: the time the run noted its requests' start. */
function caseStart(label: string): number {
  return statSync(
    path.join(
      runVariable('HARNESS_RUN_FOLDER'),
      `install-${label}-requests-start`,
    ),
  ).mtimeMs;
}

/**
 * The files under `folder`, at any depth, whose size is `size` and which changed at or after `since`; a folder or a
 * file that cannot be read gives none.
 */
function filesOfSize(folder: string, size: number, since: number): string[] {
  let entries: string[];
  try {
    entries = readdirSync(folder);
  } catch {
    return [];
  }
  return entries.flatMap(entry => {
    const file = path.join(folder, entry);
    try {
      const stats = statSync(file);
      if (stats.isDirectory()) {
        return filesOfSize(file, size, since);
      }
      return stats.isFile() && stats.size === size && stats.mtimeMs >= since
        ? [file]
        : [];
    } catch {
      return [];
    }
  });
}

/**
 * The files of the archive's size the client may have left since this case began, in its temporary folder and in the
 * run's user data. Only files changed since the case began count, so another run's files never do.
 */
export function archiveCopiesLeft(label: string, size: number): string[] {
  const since = caseStart(label);
  return [
    ...filesOfSize(tmpdir(), size, since),
    ...filesOfSize(
      path.join(runVariable('HARNESS_RUN_FOLDER'), 'user-data'),
      size,
      since,
    ),
  ];
}
