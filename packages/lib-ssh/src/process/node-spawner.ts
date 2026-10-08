/**
 * @fileoverview The process port on Node.js: a child process with piped standard streams, started with exactly the
 * environment it is given.
 */

import {spawn} from 'node:child_process';
import type {ProcessHandle, ProcessSpecification} from './ports.ts';

/** Starts a client process; rejects with the system's error, which carries a code, when it cannot start it. */
export function nodeProcessSpawner(
  specification: ProcessSpecification,
): Promise<ProcessHandle> {
  return new Promise<ProcessHandle>((resolve, reject) => {
    const child = spawn(
      specification.program,
      [...specification.programArguments],
      {
        env: {...specification.environment},
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    // The system's error carries its code and message, which is what a StartError is.
    child.once('error', reject);
    child.once('spawn', () => {
      // A write to a closed pipe is reported through the process's exit, not as an unhandled error.
      child.stdin.on('error', () => undefined);
      resolve({
        onOutput: listener => child.stdout.on('data', listener),
        onError: listener => child.stderr.on('data', listener),
        onExit: listener => {
          child.once('close', (status: number | null) => {
            listener(status ?? undefined);
          });
        },
        write: data =>
          new Promise<void>(resolve => {
            // The callback runs once the data is flushed or the pipe has failed; a failure shows in the exit.
            child.stdin.write(data, () => {
              resolve();
            });
          }),
        endInput: () => child.stdin.end(),
        kill: () => child.kill(),
      });
    });
  });
}
