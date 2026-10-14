/**
 * @fileoverview Running a program and waiting for it: the result of a command, the runner type that rows replace with a
 * fake, the runner over `spawnSync`, and the check that a command succeeded. It imports nothing of the repository, so
 * the acceptance suites can bundle it into the editor.
 */

import {spawnSync} from 'node:child_process';

/** The result of one command: its exit status and its standard output and error. */
export interface CommandResult {
  status: number;
  stdout: string;
  stderr: string;
}

/** Runs a program and waits for it. */
export type CommandRunner = (
  program: string,
  programArguments: readonly string[],
) => CommandResult;

/** Runs a program and collects its exit status and output. */
export function runCommand(
  program: string,
  programArguments: readonly string[],
): CommandResult {
  const result = spawnSync(program, programArguments, {encoding: 'utf8'});
  return {
    status: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

/** Runs a program and waits for it to succeed; it throws with the command and its standard error otherwise. */
export function checked(
  command: CommandRunner,
  program: string,
  programArguments: readonly string[],
): string {
  const result = command(program, programArguments);
  if (result.status !== 0) {
    throw new Error(
      `${program} ${programArguments.join(' ')} failed (${String(result.status)}): ${result.stderr.trim()}`,
    );
  }
  return result.stdout;
}
