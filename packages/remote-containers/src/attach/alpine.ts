/**
 * @fileoverview The Alpine step of an attached connect: the server needs `libstdc++` there, and the CLI does not add it.
 * Every command runs as root in the container and is read by its exit status alone.
 */

import type {EngineHost} from '../engine/engine-host.ts';

/** How the step ended. */
export type AlpineOutcome = 'notAlpine' | 'present' | 'installed' | 'failed';

/** The `docker exec` that runs `command` in the container as root. */
function asRoot(containerId: string, command: readonly string[]): string[] {
  return ['exec', '--user', 'root', containerId, ...command];
}

/** The exit status of `command` in the container; undefined when the engine could not run it. */
async function statusOf(
  engine: EngineHost,
  containerId: string,
  command: readonly string[],
  cancellation: AbortSignal,
): Promise<number | undefined> {
  const outcome = await engine.run(
    asRoot(containerId, command),
    {kind: 'none'},
    {cancellation},
  );
  return outcome.kind === 'ran' ? outcome.status : undefined;
}

/**
 * Makes sure an Alpine container has `libstdc++`: the container is Alpine when `/etc/os-release` says `ID=alpine`; when
 * the package is missing, the index is updated and the package added. A container that is not Alpine is left alone.
 */
export async function alpineStep(
  engine: EngineHost,
  containerId: string,
  cancellation: AbortSignal,
): Promise<AlpineOutcome> {
  const release = await statusOf(
    engine,
    containerId,
    ['grep', '-Eq', '^ID="?alpine"?$', '/etc/os-release'],
    cancellation,
  );
  if (release === undefined) {
    return 'failed';
  }
  if (release !== 0) {
    return 'notAlpine';
  }
  const present = await statusOf(
    engine,
    containerId,
    ['apk', 'info', '-e', 'libstdc++'],
    cancellation,
  );
  if (present === 0) {
    return 'present';
  }
  for (const command of [
    ['apk', 'update'],
    ['apk', 'add', 'libstdc++'],
  ]) {
    if ((await statusOf(engine, containerId, command, cancellation)) !== 0) {
      return 'failed';
    }
  }
  return 'installed';
}
