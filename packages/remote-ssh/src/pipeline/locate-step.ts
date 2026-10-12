/**
 * @fileoverview The step that finds the `ssh` client and reads the host's configuration: each candidate run once with
 * `-V`, the first whose banner names OpenSSH accepted with `scp` beside it, then `ssh -G` for the options OpenSSH
 * computes for the target. Both are kept for the connect, which starts that `ssh` with those options, and the host's
 * connect timeout gives the waits of the probe and the tunnel.
 */

import {
  buildOptionsQuery,
  type ClientCandidate,
  type ClientEnvironment,
  type ClientPlatform,
  candidates,
  classify,
  type ConnectionMode,
  type EffectiveOptions,
  judge,
  LineSplitter,
  parseEffectiveOptions,
  type ProcessSpawner,
  scpProgram,
  VERSION_ARGUMENTS,
} from 'lib-ssh';
import type {Logger} from 'lib-log';
import {sshTargetOf} from './host-settings.ts';
import {connectWaitsFor, effectiveConnectTimeoutSeconds} from './bounds.ts';
import type {ConnectSteps, ConnectTarget, StepFailure} from './steps.ts';

/** The `ssh` and `scp` programs the check accepted. */
interface ClientPrograms {
  sshProgram: string;
  scpProgram: string;
}

/** What one connect finds before it connects: the client, and the options OpenSSH computes for the target. */
export interface ConnectState {
  programs?: ClientPrograms;
  effective?: EffectiveOptions;
}

/** What the step reads and where it keeps what it found. */
export interface LocateStepDependencies {
  /** The value of `remote.SSH.path`, as the user wrote it; empty when unset. */
  settingValue: () => string;
  /** The value of `remote.SSH.configFile`, as the user wrote it; empty when unset. */
  configFile: () => string;
  /** How the connection runs, which the reading of a failed lookup depends on. */
  mode: () => ConnectionMode;
  /** The value of `remote.SSH.connectTimeout`, as the user wrote it, for a host that names none. */
  connectTimeout: () => unknown;
  environment: ClientEnvironment;
  platform: ClientPlatform;
  homeFolder: string;
  spawner: ProcessSpawner;
  /** The editor's environment, given to each run as it is. */
  processEnvironment: Readonly<Record<string, string>>;
  /** How long one check, and the lookup, may run before it counts as not answering. */
  checkMilliseconds: number;
  /** This connect's state, where the step keeps what it found. */
  state: ConnectState;
  logger: Logger;
}

/** What a run printed on each stream, and how it ended; `undefined` status when it did not end in time. */
interface RunOutcome {
  started: boolean;
  output: string;
  errorOutput: string;
  status: number | undefined;
}

/** Runs a program once, bounded, collecting each stream apart. */
async function runBounded(
  program: string,
  programArguments: readonly string[],
  dependencies: LocateStepDependencies,
): Promise<RunOutcome> {
  let handle: Awaited<ReturnType<ProcessSpawner>>;
  try {
    handle = await dependencies.spawner({
      program,
      programArguments,
      environment: dependencies.processEnvironment,
    });
  } catch {
    // A program that cannot be started gives no output.
    return {started: false, output: '', errorOutput: '', status: undefined};
  }
  const started = handle;
  const outcome: RunOutcome = {
    started: true,
    output: '',
    errorOutput: '',
    status: undefined,
  };
  started.onOutput(chunk => {
    outcome.output += chunk;
  });
  started.onError(chunk => {
    outcome.errorOutput += chunk;
  });
  outcome.status = await new Promise<number | undefined>(resolve => {
    const timer = setTimeout(() => {
      started.kill();
      resolve(undefined);
    }, dependencies.checkMilliseconds);
    started.onExit(exitStatus => {
      clearTimeout(timer);
      resolve(exitStatus);
    });
  });
  return outcome;
}

/** Whether the candidate printed a banner naming OpenSSH, on either stream, and exited cleanly. */
async function accepted(
  candidate: ClientCandidate,
  dependencies: LocateStepDependencies,
): Promise<boolean> {
  const outcome = await runBounded(
    candidate.program,
    VERSION_ARGUMENTS,
    dependencies,
  );
  return (
    outcome.started &&
    judge(outcome.status, `${outcome.output}${outcome.errorOutput}`)
  );
}

/** Reads the host's options with `ssh -G`; a failure is read the way the connection's own run would be. */
async function lookUp(
  target: ConnectTarget,
  sshProgram: string,
  dependencies: LocateStepDependencies,
): Promise<{effective: EffectiveOptions} | {failure: StepFailure}> {
  const query = buildOptionsQuery({
    target: sshTargetOf(target),
    configFile: dependencies.configFile(),
    sshProgram,
    homeFolder: dependencies.homeFolder,
    platform: dependencies.platform,
  });
  const outcome = await runBounded(
    query.program,
    query.arguments,
    dependencies,
  );
  if (outcome.started && outcome.status === undefined) {
    return {failure: {kind: 'timeout'}};
  }
  if (outcome.status === 0) {
    const parsed = parseEffectiveOptions(outcome.output);
    if ('options' in parsed) {
      return {effective: parsed.options};
    }
    dependencies.logger.warn(`ssh -G: ${parsed.parseError}`);
    return {failure: {kind: 'unknown'}};
  }
  const errorLines: string[] = [];
  const splitter = new LineSplitter(line => {
    if (line !== '') {
      errorLines.push(line);
    }
  });
  splitter.push(outcome.errorOutput);
  splitter.flush();
  for (const line of errorLines) {
    dependencies.logger.warn(line);
  }
  const classified = classify(
    errorLines,
    outcome.status,
    'connection',
    dependencies.mode(),
  );
  return {
    failure: {
      kind: classified.kind,
      ...(classified.reason === undefined ? {} : {reason: classified.reason}),
      hints: classified.hints,
    },
  };
}

/** The step over the candidates of the setting, the search path and, on Windows, Git for Windows. */
export function locateClientStep(
  dependencies: LocateStepDependencies,
): ConnectSteps['locateClient'] {
  return async input => {
    for (const candidate of candidates(
      dependencies.settingValue(),
      dependencies.environment,
      dependencies.platform,
    )) {
      if (await accepted(candidate, dependencies)) {
        const looked = await lookUp(
          input.target,
          candidate.program,
          dependencies,
        );
        if ('failure' in looked) {
          return {kind: 'failed', failure: looked.failure};
        }
        dependencies.state.programs = {
          sshProgram: candidate.program,
          scpProgram: scpProgram(candidate, dependencies.platform),
        };
        dependencies.state.effective = looked.effective;
        return {
          kind: 'done',
          value: connectWaitsFor(
            effectiveConnectTimeoutSeconds(
              looked.effective.connectTimeout,
              dependencies.connectTimeout(),
            ),
          ),
        };
      }
    }
    return {
      kind: 'failed',
      failure: {kind: 'prerequisiteMissing', reason: {id: 'S009'}},
    };
  };
}
