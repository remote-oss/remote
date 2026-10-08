/**
 * @fileoverview The maintenance of a host's server (V8): stop it, remove it, and prune the older installs.
 */

import type {ChannelFailure, HostChannel} from 'lib-host';
import type {
  BootstrapRequest,
  ScriptParameters,
  ScriptStep,
} from '../scripts/bootstrap.ts';
import type {ScriptStatus} from '../scripts/result-block.ts';
import {runStep} from './run-step.ts';

/** How a maintenance step ended. */
export type MaintenanceOutcome =
  | {kind: 'done'}
  | {kind: 'channelFailed'; failure: ChannelFailure}
  | {kind: 'noResultBlock'}
  | {kind: 'scriptFailed'; status: ScriptStatus};

async function maintain(
  channel: HostChannel,
  step: Extract<ScriptStep, 'kill' | 'uninstall' | 'cleanup'>,
  parameters: ScriptParameters,
  cancellation: AbortSignal,
): Promise<MaintenanceOutcome> {
  const request: BootstrapRequest = {installMode: 'singleScript', step};
  const stepRun = await runStep(channel, request, parameters, {cancellation});
  if (stepRun.kind === 'channelFailed') {
    return stepRun;
  }
  if (stepRun.kind === 'noResultBlock') {
    return {kind: 'noResultBlock'};
  }
  return stepRun.block.status === 'Ok'
    ? {kind: 'done'}
    : {kind: 'scriptFailed', status: stepRun.block.status};
}

/** Stops the data folder's servers and removes `bin/`. Nothing running is a success. */
export function kill(
  channel: HostChannel,
  parameters: ScriptParameters,
  cancellation: AbortSignal,
): Promise<MaintenanceOutcome> {
  return maintain(channel, 'kill', parameters, cancellation);
}

/** Stops the servers and deletes the data folder, and only that folder. Nothing to remove is a success. */
export function uninstall(
  channel: HostChannel,
  parameters: ScriptParameters,
  cancellation: AbortSignal,
): Promise<MaintenanceOutcome> {
  return maintain(channel, 'uninstall', parameters, cancellation);
}

/**
 * Prunes the older installs by the policy in the parameters. The caller does not act on a failure of this step: the
 * outcome is returned so that it can be logged.
 */
export function cleanup(
  channel: HostChannel,
  parameters: ScriptParameters,
  cancellation: AbortSignal,
): Promise<MaintenanceOutcome> {
  return maintain(channel, 'cleanup', parameters, cancellation);
}
