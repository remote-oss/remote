/**
 * @fileoverview What the clone rows read of the engine: the volumes and containers of a repository's clone, and their
 * removal.
 */

import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {waitFor} from '../windows/harness.ts';

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

/**
 * What the engine says of `container` for a failure to carry: its state (status, exit code, start and finish times,
 * the engine's error) and its events since the epoch second `since`, each with its time as ISO text. Never throws: what
 * cannot be read is said.
 */
export async function containerFacts(
  container: string,
  since: number,
): Promise<string> {
  const state = await execFileAsync('docker', [
    'inspect',
    '--format',
    '{{json .State}}',
    container,
  ]).then(
    result => result.stdout.trim(),
    (caught: unknown) => `unreadable: ${String(caught)}`,
  );
  const events = await execFileAsync('docker', [
    'events',
    '--since',
    String(since),
    '--until',
    String(Math.floor(Date.now() / 1000) + 1),
    '--filter',
    `container=${container}`,
    '--format',
    '{{.TimeNano}} {{.Action}}',
  ]).then(
    result =>
      result.stdout
        .split('\n')
        .filter(line => line !== '')
        .map(line => {
          const [nano = '0', action = ''] = line.split(' ');
          return `${new Date(Number(nano) / 1e6).toISOString()} ${action}`;
        }),
    (caught: unknown) => [`unreadable: ${String(caught)}`],
  );
  return `${container}: state ${state}; events since the reach began ${JSON.stringify(events)}`;
}

/** The containers, in any state, that carry `label`, as their ids. */
export function containersWith(label: string): Promise<string[]> {
  return dockerLines('ps', '-a', '-q', '--filter', `label=${label}`);
}

/** Docker's words for a container whose removal another process already started, or that is already gone. */
const REMOVED_ELSEWHERE =
  /removal of container \S+ is already in progress|No such container/;

/**
 * Removes `containers`. One whose removal is already under way, or that is already gone, counts as removed once Docker
 * no longer lists it, so the volumes are free when this resolves.
 */
async function removeContainersOf(
  containers: readonly string[],
): Promise<void> {
  try {
    await execFileAsync('docker', ['rm', '-f', ...containers]);
  } catch (caught) {
    const stderr = String((caught as {stderr?: unknown}).stderr ?? caught);
    if (!REMOVED_ELSEWHERE.test(stderr)) {
      throw caught;
    }
  }
  await waitFor(
    "the clone's containers to be gone",
    async () =>
      (
        await Promise.all(
          containers.map(container =>
            dockerLines('ps', '-a', '-q', '--filter', `id=${container}`),
          ),
        )
      ).every(lines => lines.length === 0),
    60_000,
  );
}

/**
 * Removes what a clone of `repository` left: every container, in any state, that mounts one of its volumes or carries
 * one as its recovery label (its dev containers, its recovery container and any stopped one a row made with that
 * label), then its volumes.
 */
export async function removeClone(repository: string): Promise<void> {
  const volumes = (await clonedVolumes(repository)).map(line =>
    String(line.split(' ')[0]),
  );
  const containers = new Set(
    await containersWith(`vsch.local.repository=${repository}`),
  );
  for (const volume of volumes) {
    for (const container of [
      ...(await dockerLines('ps', '-a', '-q', '--filter', `volume=${volume}`)),
      ...(await containersWith(`vsch.local.volume=${volume}`)),
    ]) {
      containers.add(container);
    }
  }
  if (containers.size > 0) {
    await removeContainersOf([...containers]);
  }
  for (const volume of volumes) {
    await execFileAsync('docker', ['volume', 'rm', '-f', volume]);
  }
}
