/**
 * @fileoverview Whether the server a running connection server holds still runs on the host, read from the data folder
 * it was installed in, before a window takes it up. The step starts nothing, takes no lock and changes nothing.
 */

import type {HostChannel} from 'lib-host';
import type {BootstrapRequest, ScriptParameters} from '../scripts/bootstrap.ts';
import {runStep} from './run-step.ts';

/** What the host says of the held server: it runs, and on which port its log last named, or why it can't be used. */
export type HeldServerOutcome =
  {kind: 'alive'; port: number} | {kind: 'notAlive'; reason: string};

const REQUEST: BootstrapRequest = {
  installMode: 'singleScript',
  step: 'heldServer',
};

/** Asks the host whether the server of the parameters' data folder and commit still runs, and on which port. */
export async function heldServer(
  channel: HostChannel,
  parameters: ScriptParameters,
  cancellation: AbortSignal,
): Promise<HeldServerOutcome> {
  const stepRun = await runStep(channel, REQUEST, parameters, {cancellation});
  if (stepRun.kind === 'channelFailed') {
    return {
      kind: 'notAlive',
      reason: `the check could not run: ${stepRun.failure.kind}`,
    };
  }
  if (stepRun.kind === 'noResultBlock') {
    return {kind: 'notAlive', reason: 'the check gave no result'};
  }
  const {status, serverFacts} = stepRun.block;
  if (status !== 'Ok') {
    return {kind: 'notAlive', reason: `the check ended with ${status}`};
  }
  if (serverFacts.alive !== 'yes') {
    return {kind: 'notAlive', reason: 'no server of this commit runs there'};
  }
  const port = Number(serverFacts.port);
  return Number.isInteger(port) && port > 0
    ? {kind: 'alive', port}
    : {kind: 'notAlive', reason: 'the server runs but names no port'};
}
