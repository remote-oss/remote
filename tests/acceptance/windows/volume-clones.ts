/**
 * @fileoverview What the clone rows read of the engine: the volumes and containers of a repository's clone, and their
 * removal.
 */

import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);

/** The lines `docker` prints for `argv`, without empty ones. */
export async function dockerLines(...argv: string[]): Promise<string[]> {
  const {stdout} = await execFileAsync('docker', argv);
  return stdout.split('\n').filter(line => line !== '');
}

/** The volumes of the clone of `repository`, as `<name> <unique label>` lines. */
export function clonedVolumes(repository: string): Promise<string[]> {
  return dockerLines(
    'volume',
    'ls',
    '--filter',
    `label=vsch.local.repository=${repository}`,
    '--format',
    '{{.Name}} {{.Label "vsch.local.repository.unique"}}',
  );
}

/** The containers, in any state, that carry `label`, as their ids. */
export function containersWith(label: string): Promise<string[]> {
  return dockerLines('ps', '-a', '-q', '--filter', `label=${label}`);
}

/**
 * Removes what a clone of `repository` left: every container, in any state, that mounts one of its volumes (its dev
 * containers and its recovery container, which carries other labels), then its volumes.
 */
export async function removeClone(repository: string): Promise<void> {
  const volumes = (await clonedVolumes(repository)).map(line =>
    String(line.split(' ')[0]),
  );
  const containers = new Set(
    await containersWith(`vsch.local.repository=${repository}`),
  );
  for (const volume of volumes) {
    for (const container of await dockerLines(
      'ps',
      '-a',
      '-q',
      '--filter',
      `volume=${volume}`,
    )) {
      containers.add(container);
    }
  }
  if (containers.size > 0) {
    await execFileAsync('docker', ['rm', '-f', ...containers]);
  }
  for (const volume of volumes) {
    await execFileAsync('docker', ['volume', 'rm', '-f', volume]);
  }
}
