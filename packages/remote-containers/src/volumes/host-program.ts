/**
 * @fileoverview A program run on this machine for a clone's check: its arguments as a list, never through a shell,
 * the editor's environment with the added variables, nothing on its standard streams, and its exit status.
 */

import {spawn} from 'node:child_process';

/** Runs `program` with `programArguments`; gives its exit status, or `null` when it ended on a signal or didn't start. */
export function runHostProgram(
  program: string,
  programArguments: readonly string[],
  environment: Readonly<Record<string, string>>,
  cancellation: AbortSignal,
): Promise<number | null> {
  return new Promise(resolve => {
    const child = spawn(program, [...programArguments], {
      env: {...process.env, ...environment},
      stdio: 'ignore',
      signal: cancellation,
    });
    child.once('error', () => {
      resolve(null);
    });
    child.once('close', status => {
      resolve(status);
    });
  });
}
