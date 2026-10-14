/**
 * @fileoverview The connect of a server maintenance command: a connection to a host outside any window, by the steps
 * a window's connect takes up to the probe, then the kill or the uninstall, then the lease given back. Nothing here
 * shows anything; the caller turns the result into the notice or the error the command shows.
 */

import type {SshTarget} from 'lib-ssh';
import {connectTargetOf, payloadOf} from '../connect/connect-commands.ts';
import type {ConnectInput, ConnectSteps} from '../pipeline/steps.ts';
import type {StepResult} from './own-host.ts';

/** How a maintenance run ended: the step ran on the host, or the host could not be reached or the step did not run. */
export interface MaintenanceRun {
  result: StepResult;
  /** What went wrong, for the log; empty when the step ran. */
  cause: string;
}

/** The steps a maintenance run takes from a connect. */
export type MaintenanceSteps = Pick<
  ConnectSteps,
  | 'validate'
  | 'checkInstallFolder'
  | 'locateClient'
  | 'decideTerms'
  | 'openConnection'
  | 'probe'
  | 'maintain'
>;

/** The input of a connect to `target` outside any window: the host as the authority would name it. */
export function maintenanceInputOf(target: SshTarget): ConnectInput {
  return {
    target: connectTargetOf(target),
    rawHostString: payloadOf(target),
    attempt: 1,
    isReconnection: false,
    windowId: 'maintenance',
    windowWorkspace: undefined,
  };
}

/** The checks a Kill takes before it connects. */
const KILL_CHECKS = ['validate', 'checkInstallFolder'] as const;

/** The checks an Uninstall takes before it connects. */
const UNINSTALL_CHECKS = ['validate'] as const;

const STEP_RAN: MaintenanceRun = {result: 'stepRan', cause: ''};

function failed(cause: string): MaintenanceRun {
  return {result: 'connectionFailed', cause};
}

/**
 * Runs `action` on the host of `input`. The lease is given back whatever the outcome, so the login the run took is
 * ended right after.
 */
export async function runMaintenance(
  steps: MaintenanceSteps,
  input: ConnectInput,
  action: 'kill' | 'uninstall',
  cancellation: AbortSignal,
): Promise<MaintenanceRun> {
  // Uninstall never reads the install folder setting; Kill acts on the folder it names.
  const checks = action === 'kill' ? KILL_CHECKS : UNINSTALL_CHECKS;
  for (const check of checks) {
    const checked = steps[check](input);
    if (checked.kind === 'failed') {
      return failed(`the target is not valid: ${checked.failure.kind}`);
    }
  }
  const located = await steps.locateClient(input);
  if (located.kind === 'failed') {
    return failed(`the ssh client was not found: ${located.failure.kind}`);
  }
  const terms = await steps.decideTerms(input, cancellation);
  if (terms.kind === 'failed') {
    return failed(`the platform was not decided: ${terms.failure.kind}`);
  }
  const opened = await steps.openConnection(input, terms.value, cancellation);
  if (opened.kind === 'failed') {
    return failed(`the connection failed: ${opened.failure.kind}`);
  }
  const lease = opened.value;
  try {
    const probed = await steps.probe(input, lease, cancellation);
    if (probed.kind === 'failed') {
      return failed(`the probe failed: ${probed.failure.kind}`);
    }
    const outcome = await steps.maintain(input, lease, action, cancellation);
    return outcome.kind === 'done'
      ? STEP_RAN
      : failed(`the ${action} did not run: ${outcome.kind}`);
  } finally {
    lease.release();
  }
}
