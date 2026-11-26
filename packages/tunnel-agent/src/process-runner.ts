/**
 * @fileoverview The runner the agent starts its programs with: an argument list, never a shell string, and what the
 * program printed.
 */

import {execFile} from 'node:child_process';
import type {ProgramOutcome} from './service.ts';

/** Runs `program` on this machine. */
export function runProgram(
  program: string,
  programArguments: readonly string[],
): Promise<ProgramOutcome> {
  return new Promise<ProgramOutcome>(settle => {
    execFile(
      program,
      [...programArguments],
      {encoding: 'utf8'},
      (error, stdout, stderr) => {
        if (error === null) {
          settle({kind: 'exited', status: 0, stdout, stderr});
          return;
        }
        const {code} = error as NodeJS.ErrnoException & {
          code?: number | string;
        };
        settle(
          typeof code === 'number'
            ? {kind: 'exited', status: code, stdout, stderr}
            : {kind: 'failedToStart', message: error.message},
        );
      },
    );
  });
}
