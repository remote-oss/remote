/**
 * @fileoverview The step that finds the `ssh` client: each candidate run once with `-V`, the first whose banner names
 * OpenSSH accepted, and `scp` taken beside it. What it accepts is kept for the connection, which starts that `ssh`.
 */

import {
  type ClientCandidate,
  type ClientEnvironment,
  type ClientPlatform,
  candidates,
  judge,
  type ProcessSpawner,
  scpProgram,
  VERSION_ARGUMENTS,
} from 'lib-ssh';
import type {ConnectSteps} from './steps.ts';

/** The `ssh` and `scp` programs the check accepted. */
export interface ClientPrograms {
  sshProgram: string;
  scpProgram: string;
}

/** What the step reads and where it keeps what it found. */
export interface LocateStepDependencies {
  /** The value of `remote.SSH.path`, as the user wrote it; empty when unset. */
  settingValue: () => string;
  environment: ClientEnvironment;
  platform: ClientPlatform;
  spawner: ProcessSpawner;
  /** The editor's environment, given to each check as it is. */
  processEnvironment: Readonly<Record<string, string>>;
  /** How long one check may run before it counts as not accepted. */
  checkMilliseconds: number;
  /** Keeps the programs of the latest connect that found a client, for the connection to start. */
  keep(programs: ClientPrograms): void;
}

/** The check's outcome: whether the candidate printed a banner naming OpenSSH and exited cleanly. */
async function accepted(
  candidate: ClientCandidate,
  dependencies: LocateStepDependencies,
): Promise<boolean> {
  let handle: Awaited<ReturnType<ProcessSpawner>>;
  try {
    handle = await dependencies.spawner({
      program: candidate.program,
      programArguments: VERSION_ARGUMENTS,
      environment: dependencies.processEnvironment,
    });
  } catch {
    // A program that cannot be started is not a client.
    return false;
  }
  const started = handle;
  let output = '';
  started.onOutput(chunk => {
    output += chunk;
  });
  started.onError(chunk => {
    output += chunk;
  });
  const status = await new Promise<number | undefined>(resolve => {
    const timer = setTimeout(() => {
      started.kill();
      resolve(undefined);
    }, dependencies.checkMilliseconds);
    started.onExit(exitStatus => {
      clearTimeout(timer);
      resolve(exitStatus);
    });
  });
  return judge(status, output);
}

/** The step over the candidates of the setting, the search path and, on Windows, Git for Windows. */
export function locateClientStep(
  dependencies: LocateStepDependencies,
): ConnectSteps['locateClient'] {
  return async () => {
    for (const candidate of candidates(
      dependencies.settingValue(),
      dependencies.environment,
      dependencies.platform,
    )) {
      if (await accepted(candidate, dependencies)) {
        dependencies.keep({
          sshProgram: candidate.program,
          scpProgram: scpProgram(candidate, dependencies.platform),
        });
        return {kind: 'done', value: undefined};
      }
    }
    return {
      kind: 'failed',
      failure: {kind: 'prerequisiteMissing', reason: {id: 'S009'}},
    };
  };
}
