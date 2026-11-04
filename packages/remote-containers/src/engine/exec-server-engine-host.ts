/**
 * @fileoverview The Docker CLI on a remote host, reached through the host's exec server: a dev container opened from a
 * Remote - SSH window runs every `docker` there. The engine's variables go in the spawn's environment, which the host
 * merges onto its own, never in the arguments.
 */

import {PassThrough, Writable} from 'node:stream';
import type {ExecReadStream, ExecServer} from 'lib-server';
import type {
  EngineHost,
  EngineOptions,
  EngineProcess,
  EngineSpawn,
} from './engine-host.ts';
import {spawnedEngineHost} from './engine-runs.ts';

/** A Node stream that carries what the host sends on `remote`, and ends when it does. */
function readableOf(remote: ExecReadStream): PassThrough {
  const local = new PassThrough();
  const listening = remote.onDidReceiveMessage(data => {
    local.write(Buffer.from(data));
  });
  void remote.onEnd.then(() => {
    listening.dispose();
    local.end();
  });
  return local;
}

/**
 * The `docker` named `dockerPath` on the exec server's host. A cancelled spawn ends the process's standard input, the
 * only way the exec server's spawned command can be told to stop.
 */
export function execServerEngineHost(
  server: Pick<ExecServer, 'spawn'>,
  dockerPath: string,
): EngineHost {
  async function spawn(
    argv: readonly string[],
    options: EngineOptions,
  ): Promise<EngineSpawn> {
    let command;
    try {
      command = await server.spawn(dockerPath, [...argv], {
        env: {...options.environment},
      });
    } catch (caught) {
      return {
        kind: 'failed',
        detail: caught instanceof Error ? caught.message : String(caught),
      };
    }
    const stdin = new Writable({
      write: (chunk: Buffer, encoding, done) => {
        command.stdin.write(new Uint8Array(chunk));
        done();
      },
      final: done => {
        command.stdin.end();
        done();
      },
    });
    function end(): void {
      stdin.end();
    }
    if (options.cancellation.aborted) {
      end();
    }
    options.cancellation.addEventListener('abort', end, {once: true});
    const process: EngineProcess = {
      stdin,
      stdout: readableOf(command.stdout),
      stderr: readableOf(command.stderr),
      exited: command.onExit.then(
        exit => exit.status,
        () => undefined,
      ),
      kill: end,
    };
    return {kind: 'spawned', process};
  }

  return spawnedEngineHost(spawn);
}
