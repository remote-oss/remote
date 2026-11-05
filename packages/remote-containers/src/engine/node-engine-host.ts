/**
 * @fileoverview The Docker CLI over `child_process.spawn`, with no shell: the only module that starts a `docker`
 * process.
 */

import {
  type ChildProcessByStdio,
  spawn as spawnProcess,
} from 'node:child_process';
import type {Readable, Writable} from 'node:stream';
import type {
  EngineHost,
  EngineOptions,
  EngineProcess,
  EngineSpawn,
} from './engine-host.ts';
import {spawnedEngineHost} from './engine-runs.ts';

type Child = ChildProcessByStdio<Writable, Readable, Readable>;

/** The process as the port shows it. */
function processOf(child: Child): EngineProcess {
  return {
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    exited: new Promise(resolve => {
      child.once('close', (code: number | null) => {
        resolve(code ?? undefined);
      });
    }),
    kill: () => {
      child.kill('SIGTERM');
    },
  };
}

/** The `docker` at `dockerPath` over `child_process.spawn`, which runs it without a shell. */
export function nodeEngineHost(dockerPath: string): EngineHost {
  function spawn(
    argv: readonly string[],
    options: EngineOptions,
  ): Promise<EngineSpawn> {
    return new Promise(resolve => {
      const child = spawnProcess(dockerPath, [...argv], {
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: {...process.env, ...options.environment},
      });
      child.once('error', error => {
        resolve({kind: 'failed', detail: error.message});
      });
      child.once('spawn', () => {
        function terminate(): void {
          child.kill('SIGTERM');
        }
        if (options.cancellation.aborted) {
          terminate();
        }
        options.cancellation.addEventListener('abort', terminate, {
          once: true,
        });
        resolve({kind: 'spawned', process: processOf(child)});
      });
    });
  }

  return spawnedEngineHost(spawn);
}
