/**
 * @fileoverview A one-shot `docker` run over any way of spawning one: the input given, both outputs collected, and the
 * exit awaited. The local adapter and the exec server's share it.
 */

import {createReadStream} from 'node:fs';
import {finished} from 'node:stream/promises';
import type {
  EngineHost,
  EngineInput,
  EngineOptions,
  EngineProcess,
  EngineRunOutcome,
  EngineSpawn,
} from './engine-host.ts';

/** Gives the process its input and closes its standard input. */
function feed(process: EngineProcess, input: EngineInput): void {
  // A process that ends before reading its input must not fail the run with a broken pipe.
  process.stdin.on('error', () => undefined);
  if (input.kind === 'file') {
    createReadStream(input.localFile).pipe(process.stdin);
  } else if (input.kind === 'text') {
    process.stdin.end(input.text);
  } else {
    process.stdin.end();
  }
}

/** The engine host over `spawn`: its spawns as they are, and runs that collect what the command prints. */
export function spawnedEngineHost(
  spawn: (
    argv: readonly string[],
    options: EngineOptions,
  ) => Promise<EngineSpawn>,
): EngineHost {
  async function runOnce(
    argv: readonly string[],
    input: EngineInput,
    options: EngineOptions,
  ): Promise<EngineRunOutcome> {
    const spawned = await spawn(argv, options);
    if (spawned.kind === 'failed') {
      return spawned;
    }
    const {process} = spawned;
    const printed: Buffer[] = [];
    const complaints: Buffer[] = [];
    process.stdout.on('data', (chunk: Buffer) => printed.push(chunk));
    process.stderr.on('data', (chunk: Buffer) => complaints.push(chunk));
    feed(process, input);
    const status = await process.exited;
    await Promise.all([
      finished(process.stdout).catch(() => undefined),
      finished(process.stderr).catch(() => undefined),
    ]);
    return {
      kind: 'ran',
      status,
      stdout: Buffer.concat(printed).toString('utf8'),
      stderr: Buffer.concat(complaints).toString('utf8'),
    };
  }

  // eslint-disable-next-line id-length -- the port's method is named run
  return {run: runOnce, spawn};
}
