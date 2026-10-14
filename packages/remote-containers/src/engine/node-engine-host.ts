/**
 * @fileoverview The Docker CLI over `child_process.spawn`, with no shell: the only module that starts a `docker`
 * process.
 */

import {
  type ChildProcessByStdio,
  spawn as spawnProcess,
} from 'node:child_process';
import {createReadStream} from 'node:fs';
import type {Readable, Writable} from 'node:stream';
import type {
  EngineHost,
  EngineInput,
  EngineOptions,
  EngineProcess,
  EngineRunOutcome,
  EngineSpawn,
} from './engine-host.ts';

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
