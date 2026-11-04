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

/** Removes what a clone of `repository` left: its dev containers, then its volumes. */
export async function removeClone(repository: string): Promise<void> {
  const containers = await containersWith(
    `vsch.local.repository=${repository}`,
  );
  if (containers.length > 0) {
    await execFileAsync('docker', ['rm', '-f', ...containers]);
  }
  for (const line of await clonedVolumes(repository)) {
    await execFileAsync('docker', [
      'volume',
      'rm',
      '-f',
      String(line.split(' ')[0]),
    ]);
  }
}
