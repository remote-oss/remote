/**
 * @fileoverview The Docker CLI inside a WSL distro, as the engine host: `docker` is started by D1 with the distro's
 * environment plus the variables of the run, and its streams are the process's own, byte for byte.
 */

import {PassThrough, Writable} from 'node:stream';
import type {LiveProcess, WslRunner} from 'lib-wsl';
import type {
  EngineHost,
  EngineOptions,
  EngineProcess,
  EngineSpawn,
} from './engine-host.ts';
import {spawnedEngineHost} from './engine-runs.ts';

/** The callback of a stream's write. */
type Done = (error?: Error | null) => void;

/** The engine process over a live process of the distro: its streams, and how it ended. */
function processOf(live: LiveProcess): EngineProcess {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new Writable({
    write: (chunk: Buffer, ...rest: [unknown, Done]) => {
      const done = rest[1];
      live.write(chunk).then(
        () => {
          done();
        },
        (error: unknown) => {
          done(error instanceof Error ? error : new Error(String(error)));
        },
      );
    },
    final: done => {
      live.endInput();
      done();
    },
  });
  let ended = false;
  live.onOutput(chunk => {
    if (!ended) {
      stdout.write(chunk);
    }
  });
  live.onError(chunk => {
    if (!ended) {
      stderr.write(chunk);
    }
  });
  return {
    stdin,
    stdout,
    stderr,
    exited: live.exited.then(outcome => {
      if (outcome.kind === 'failed') {
        // `wsl.exe` or the system ended the run: the reason is what the process complained of.
        stderr.write(`${outcome.failure.kind}: ${outcome.failure.detail}\n`);
      }
      ended = true;
      stdout.end();
      stderr.end();
      return outcome.kind === 'exited' ? outcome.status : undefined;
    }),
    kill: () => {
      live.kill();
    },
  };
}

/** The `docker` of the distro `distro`, started in its home folder through `runner`. */
export function wslEngineHost(runner: WslRunner, distro: string): EngineHost {
  async function spawn(
    argv: readonly string[],
    options: EngineOptions,
  ): Promise<EngineSpawn> {
    const started = await runner.start({
      distro,
      folder: '~',
      program: 'docker',
      programArguments: argv,
      environment: options.environment ?? {},
      cancellation: options.cancellation,
    });
    return started.kind === 'failed'
      ? {
          kind: 'failed',
          detail: `${started.failure.kind}: ${started.failure.detail}`,
        }
      : {kind: 'spawned', process: processOf(started.process)};
  }
  return spawnedEngineHost(spawn);
}
