/**
 * @fileoverview The Docker CLI on a remote host, reached through the host's exec server: a dev container opened from a
 * Remote - SSH window runs every `docker` there. The engine's variables go in the spawn's environment, which the host
 * merges onto its own, never in the arguments. The host is a POSIX one: the command starts under `sh`, which reports
 * the process id that a stop kills.
 */

import {type ExecServer, spawnOnHost} from 'lib-server';
import type {EngineHost, EngineOptions, EngineSpawn} from './engine-host.ts';
import {spawnedEngineHost} from './engine-runs.ts';

/**
 * The `docker` named `dockerPath` on the exec server's host. A cancelled spawn and a kill end the process's standard
 * input and kill the process by the id it reported.
 */
export function execServerEngineHost(
  server: Pick<ExecServer, 'spawn' | 'kill'>,
  dockerPath: string,
): EngineHost {
  function spawn(
    argv: readonly string[],
    options: EngineOptions,
  ): Promise<EngineSpawn> {
    return spawnOnHost(server, {
      command: [dockerPath, ...argv],
      environment: options.environment,
      cancellation: options.cancellation,
      endById: processId => server.kill(processId),
    });
  }

  return spawnedEngineHost(spawn);
}
