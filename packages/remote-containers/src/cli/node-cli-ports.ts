/**
 * @fileoverview The operating system calls under the CLI host, behind a port so that the host's rows can fake them:
 * starting the program, and signalling a process group.
 */

import {spawn} from 'node:child_process';

/** A process that started, with its streams and its end. */
export interface SpawnedCli {
  processId: number | undefined;
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  /** Settles once, with the exit status, or null after a signal. */
  exited: Promise<number | null>;
}

/** How a start ended. */
type CliSpawn =
  {kind: 'spawned'; process: SpawnedCli} | {kind: 'failed'; message: string};

/** What the host asks of the system. */
export interface NodeCliPorts {
  spawn(
    program: string,
    programArguments: readonly string[],
    options: {
      shell: false;
      detached: true;
      stdio: ['ignore', 'pipe', 'pipe'];
      env: Readonly<Record<string, string | undefined>>;
    },
  ): Promise<CliSpawn>;
  /** Signals the process group led by `pid`; it throws when the group is gone. */
  killGroup(processId: number, signal: 'SIGTERM' | 'SIGKILL'): void;
}

/** The ports over `node:child_process` and `process.kill`. */
export const systemCliPorts: NodeCliPorts = {
  spawn: (program, programArguments, options) =>
    new Promise(resolve => {
      const child = spawn(program, [...programArguments], options);
      child.once('error', error => {
        resolve({kind: 'failed', message: error.message});
      });
      child.once('spawn', () => {
        resolve({
          kind: 'spawned',
          process: {
            processId: child.pid,
            stdout: child.stdout,
            stderr: child.stderr,
            exited: new Promise(done => {
              child.once('close', (code: number | null) => {
                done(code);
              });
            }),
          },
        });
      });
    }),
  killGroup: (processId, signal) => {
    process.kill(-processId, signal);
  },
};
