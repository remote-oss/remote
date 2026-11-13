/**
 * @fileoverview Running a program and waiting for it: the result of a command, the runner type that rows replace with a
 * fake, the runner over `spawnSync` (a Windows batch file through `cmd.exe`), and the check that a command succeeded.
 * It imports nothing of the repository, so the acceptance suites can bundle it into the editor.
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

/** A program and its arguments as `spawnSync` takes them, and whether Node passes the arguments on as they are. */
export interface SpawnedCommand {
  file: string;
  fileArguments: readonly string[];
  verbatim: boolean;
}

/**
 * How a program is started on `platform`. On Windows a batch file (`.cmd`, `.bat`) runs only through `cmd.exe`, and
 * Node refuses to spawn one without a shell, so it is run as `cmd.exe /d /s /c "<command line>"` with every word in
 * double quotes, the line Node itself builds for a shell. A word holding `"` or `%` can't pass through `cmd.exe`
 * unchanged, and is refused. Every other program is started as it is.
 */
export function spawnedCommandOf(
  program: string,
  programArguments: readonly string[],
  platform: NodeJS.Platform,
): SpawnedCommand {
  if (platform !== 'win32' || !/\.(?:bat|cmd)$/i.test(program)) {
    return {file: program, fileArguments: programArguments, verbatim: false};
  }
  const words = [program, ...programArguments];
  const unsafe = words.find(word => /["%]/.test(word));
  if (unsafe !== undefined) {
    throw new Error(`cmd.exe can't pass ${unsafe} to ${program} unchanged`);
  }
  const line = words.map(word => `"${word}"`).join(' ');
  return {
    file: 'cmd.exe',
    fileArguments: ['/d', '/s', '/c', `"${line}"`],
    verbatim: true,
  };
}

/** Runs a program and collects its exit status and output. */
export function runCommand(
  program: string,
  programArguments: readonly string[],
): CommandResult {
  const {file, fileArguments, verbatim} = spawnedCommandOf(
    program,
    programArguments,
    process.platform,
  );
  const result = spawnSync(file, fileArguments, {
    encoding: 'utf8',
    windowsVerbatimArguments: verbatim,
  });
  // A program that did not start (not installed, not executable) has no output at all: its error is the answer.
  if (result.error !== undefined) {
    return {status: 1, stdout: '', stderr: result.error.message};
  }
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
