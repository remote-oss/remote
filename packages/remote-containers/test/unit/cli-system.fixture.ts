import {PassThrough} from 'node:stream';
import type {NodeCliPorts} from '../../src/cli/node-cli-ports.ts';

/** The preload's marker line, saying whether it loaded `node-pty`. */
export function markerLine(loaded: boolean): string {
  return `${JSON.stringify({marker: 'remote-oss-cli-preload', nodePty: {loaded, from: loaded ? 'editor' : 'none'}})}\n`;
}

/** What a test sees of the fake system. */
export interface Fake {
  ports: NodeCliPorts;
  spawns: Array<{
    program: string;
    programArguments: readonly string[];
    options: unknown;
  }>;
  signals: Array<[number, string]>;
  /** What a test wrote to the process's stdin. */
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  stdinWrote: string[];
  /** Ends the process with `status`. */
  exit(status: number | null): void;
}

/** A system whose one process the test drives: its streams, its end, and the signals sent to its group. */
export function fakeSystem(
  options: {
    failure?: string;
    gone?: boolean;
  } = {},
): Fake {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdinWrote: string[] = [];
  stdin.on('data', (chunk: Buffer) => stdinWrote.push(chunk.toString()));
  const ends: Array<(status: number | null) => void> = [];
  const exited = new Promise<number | null>(resolve => {
    ends.push(resolve);
  });
  const spawns: Fake['spawns'] = [];
  const signals: Fake['signals'] = [];
  return {
    spawns,
    signals,
    stdin,
    stdout,
    stderr,
    stdinWrote,
    exit: status => {
      stdout.end();
      stderr.end();
      ends[0]?.(status);
    },
    ports: {
      spawn: (program, programArguments, spawnOptions) => {
        spawns.push({program, programArguments, options: spawnOptions});
        return Promise.resolve(
          options.failure === undefined
            ? {
                kind: 'spawned',
                process: {processId: 4242, stdin, stdout, stderr, exited},
              }
            : {kind: 'failed', message: options.failure},
        );
      },
      killGroup: (processId, signal) => {
        signals.push([processId, signal]);
        if (options.gone === true) {
          throw new Error('ESRCH');
        }
      },
    },
  };
}
