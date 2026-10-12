/**
 * @fileoverview The identity of an acceptance run, the one start of the SSH host container the editor and server
 * suites share, and the clean-up that leaves a shared self-hosted runner as the run found it.
 *
 *     node tools/acceptance-run.ts --clean
 *
 * Every Docker object of a run carries the run's label, so the clean-up removes only what one run made: its
 * containers, forced, and its image tag. What is already gone is not an error, and the shared machine is never
 * pruned.
 */

import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {isMainModule, messageOf} from './repository.ts';

/** The label every Docker object of an acceptance run carries; its value is the run's id. */
export const RUN_LABEL = 'remote-oss.acceptance.run';

/** The image name of the SSH host; the run's tag keeps each run's build and container its own. */
export const HOST_IMAGE = 'remote-oss-acceptance-host';

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

/**
 * The run's id: `GITHUB_RUN_ID-GITHUB_RUN_ATTEMPT-GITHUB_JOB` in CI, else `local-<process id>`. The job's id is
 * in the id because the acceptance jobs of one workflow run share the run and the attempt, and may run at the
 * same time on runners that share a Docker daemon.
 */
export function acceptanceRunId(
  environment: NodeJS.ProcessEnv,
  processId: number,
): string {
  const runId = environment.GITHUB_RUN_ID;
  const attempt = environment.GITHUB_RUN_ATTEMPT;
  const jobId = environment.GITHUB_JOB;
  if (
    runId !== undefined &&
    runId !== '' &&
    attempt !== undefined &&
    attempt !== '' &&
    jobId !== undefined &&
    jobId !== ''
  ) {
    return `${runId}-${attempt}-${jobId}`;
  }
  return `local-${String(processId)}`;
}

/** The image tag of the run: `remote-oss-acceptance-host:<run id>`. */
export function hostImageOf(runId: string): string {
  return `${HOST_IMAGE}:${runId}`;
}

/** What a started host container is: its id, its mapped SSH port, and the key file of the run. */
export interface HostContainer {
  container: string;
  port: number;
  keyFile: string;
}

/** The host port Docker maps to the container's port 22, from `docker port` output such as `127.0.0.1:49153`. */
export function mappedPort(dockerPortOutput: string): number {
  const match = /:(\d+)\s*$/m.exec(dockerPortOutput);
  if (match?.[1] === undefined) {
    throw new Error(`no mapped port in '${dockerPortOutput.trim()}'`);
  }
  return Number(match[1]);
}

/**
 * Builds the run's image, makes the run's key in `runFolder`, and runs the labelled container: the one start of
 * the host both acceptance harnesses share. `extraArguments` go to `docker run` before the image, such as the
 * `--env` of a host variant.
 */
export function startHostContainer(
  command: CommandRunner,
  root: string,
  runId: string,
  runFolder: string,
  extraArguments: readonly string[] = [],
): HostContainer {
  checked(command, 'docker', [
    'build',
    '--load',
    '--quiet',
    '--tag',
    hostImageOf(runId),
    path.join(root, 'tests', 'acceptance', 'host'),
  ]);
  const keyFile = path.join(runFolder, 'id_ed25519');
  checked(command, 'ssh-keygen', [
    '-q',
    '-t',
    'ed25519',
    '-N',
    '',
    '-C',
    'acceptance',
    '-f',
    keyFile,
  ]);
  const publicKey = readFileSync(`${keyFile}.pub`, 'utf8').trim();
  const container = checked(command, 'docker', [
    'run',
    '--detach',
    '--rm',
    '--label',
    `${RUN_LABEL}=${runId}`,
    '--env',
    `AUTHORIZED_KEY=${publicKey}`,
    '--publish',
    '127.0.0.1::22',
    ...extraArguments,
    hostImageOf(runId),
  ]).trim();
  const port = mappedPort(
    checked(command, 'docker', ['port', container, '22']),
  );
  return {container, port, keyFile};
}

/** The container ids of a `docker ps --quiet` answer. */
function containersOf(quiet: string): string[] {
  return quiet
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '');
}

/**
 * Removes the run's containers (by the run's label, forced) and its image tag; what is already gone is not an
 * error. A container that still carries the run's label afterwards makes it throw, naming the ids, so a failed
 * removal fails the run instead of keeping the run's state on the shared machine.
 */
export function cleanRun(command: CommandRunner, runId: string): void {
  const filter = `label=${RUN_LABEL}=${runId}`;
  for (const containerId of containersOf(
    checked(command, 'docker', ['ps', '--all', '--quiet', '--filter', filter]),
  )) {
    checked(command, 'docker', ['rm', '--force', containerId]);
  }
  // The image may already be gone: its removal's status is ignored.
  command('docker', ['image', 'rm', '--force', hostImageOf(runId)]);
  const remaining = containersOf(
    checked(command, 'docker', ['ps', '--all', '--quiet', '--filter', filter]),
  );
  if (remaining.length > 0) {
    throw new Error(
      `the run ${runId} still owns containers after the clean-up: ${remaining.join(', ')}`,
    );
  }
}

if (isMainModule(import.meta.url)) {
  try {
    cleanRun(runCommand, acceptanceRunId(process.env, process.pid));
  } catch (error) {
    console.error(`acceptance: ${messageOf(error)}`);
    process.exitCode = 1;
  }
}
