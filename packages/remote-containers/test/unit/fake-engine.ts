/**
 * @fileoverview A `docker` that tests control: each spawn records its arguments and environment, hands the test a
 * handle on the process (what it was fed on stdin, what it prints, how it ends), and kills like the real client.
 */

import {PassThrough, Writable} from 'node:stream';
import type {
  EngineHost,
  EngineOptions,
  EngineProcess,
  EngineRunOutcome,
  EngineSpawn,
} from '../../src/engine/engine-host.ts';

/** What a test sees of one spawned process. */
export interface FakeProcess {
  argv: readonly string[];
  environment: Readonly<Record<string, string>> | undefined;
  /** Everything written to stdin so far. */
  stdin(): Buffer;
  /** Settles when stdin has ended. */
  stdinEnded: Promise<void>;
  /** The number of writes that said false, and the number of drains told. */
  pressure: {fulls: number; drains: number};
  killed: boolean;
  print(text: string | Uint8Array): void;
  printError(text: string | Uint8Array): void;
  /** Makes every later write wait for ever, so stdin never drains. */
  stall(): void;
  /** Breaks stdin with an error, as a pipe to a dead process does. */
  breakStdin(): void;
  /** Ends the streams, then the process, with the status (undefined for a signal). */
  exit(status: number | undefined): void;
}

/** What a test does with a spawned process. */
export type ProcessScript = (process: FakeProcess) => void | Promise<void>;

/** What the next spawn does: runs a script, or fails with a detail. */
export type SpawnPlan = ProcessScript | {failure: string};

/** The fake `docker` and the processes it spawned. */
export interface FakeEngine extends EngineHost {
  readonly processes: FakeProcess[];
  /** The arguments of every one-shot run, in order. */
  readonly runs: Array<readonly string[]>;
  /** What a one-shot run answers; a rejection when absent. */
  answer: EngineRunOutcome | undefined;
}

/** One fake process and the streams the channel sees. */
function fakeProcess(
  argv: readonly string[],
  options: EngineOptions,
): {handle: FakeProcess; process: EngineProcess} {
  const chunks: Buffer[] = [];
  const pressure = {fulls: 0, drains: 0};
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const endings: Array<() => void> = [];
  const stdinEnded = new Promise<void>(resolve => {
    endings.push(resolve);
  });
  let stalled = false;
  const stdin = new Writable({
    highWaterMark: 1,
    write: (chunk: Buffer, encoding, done) => {
      chunks.push(chunk);
      if (!stalled) {
        setImmediate(done);
      }
    },
    final: done => {
      endings[0]?.();
      done();
    },
  });
  stdin.on('drain', () => {
    pressure.drains += 1;
  });
  const written = stdin.write.bind(stdin) as (chunk: unknown) => boolean;
  stdin.write = ((chunk: unknown) => {
    const taken = written(chunk);
    if (!taken) {
      pressure.fulls += 1;
    }
    return taken;
  }) as typeof stdin.write;
  const settlers: Array<(status: number | undefined) => void> = [];
  const exited = new Promise<number | undefined>(resolve => {
    settlers.push(resolve);
  });
  function exit(status: number | undefined): void {
    stdout.end();
    stderr.end();
    setImmediate(() => {
      settlers[0]?.(status);
    });
  }
  const handle: FakeProcess = {
    argv,
    environment: options.environment,
    stdin: () => Buffer.concat(chunks),
    stdinEnded,
    pressure,
    killed: false,
    print: text => {
      stdout.write(text);
    },
    printError: text => {
      stderr.write(text);
    },
    stall: () => {
      stalled = true;
    },
    breakStdin: () => {
      stdin.destroy(new Error('broken pipe'));
    },
    exit,
  };
  function kill(): void {
    handle.killed = true;
    exit(undefined);
  }
  if (options.cancellation.aborted) {
    kill();
  }
  options.cancellation.addEventListener('abort', kill);
  return {handle, process: {stdin, stdout, stderr, exited, kill}};
}

/** A fake `docker` whose spawns follow `plans` in order; a spawn with no plan does nothing but record. */
export function fakeEngine(...plans: SpawnPlan[]): FakeEngine {
  const processes: FakeProcess[] = [];
  const runs: Array<readonly string[]> = [];
  const remaining = [...plans];
  function spawn(
    argv: readonly string[],
    options: EngineOptions,
  ): Promise<EngineSpawn> {
    const plan = remaining.shift();
    if (plan !== undefined && 'failure' in plan) {
      return Promise.resolve({kind: 'failed', detail: plan.failure});
    }
    const {handle, process} = fakeProcess(argv, options);
    processes.push(handle);
    void plan?.(handle);
    return Promise.resolve({kind: 'spawned', process});
  }
  const engine: FakeEngine = {
    processes,
    runs,
    answer: undefined,
    // eslint-disable-next-line id-length -- the port's method is named run
    run: argv => {
      runs.push(argv);
      return engine.answer === undefined
        ? Promise.reject(new Error('no answer was given for a one-shot run'))
        : Promise.resolve(engine.answer);
    },
    spawn,
  };
  return engine;
}
