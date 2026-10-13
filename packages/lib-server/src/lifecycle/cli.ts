/**
 * @fileoverview The CLI on the host (contracts V7a): its install as the single file `<data>/<applicationName>-<commit>`,
 * and its start with the connection token in the script's environment only.
 */

import type {HostChannel} from 'lib-host';
import type {Plan} from '../install/plan.ts';
import type {ScriptParameters} from '../scripts/bootstrap.ts';
import {
  installPlaced,
  transfer,
  type TransferDependencies,
  type TransferFailure,
  type TransferInput,
} from '../transfer/transfer.ts';
import {runStep, type StepRun} from './run-step.ts';
import {blockOfStart, type HostLockLoop, type StartOutcome} from './runtime.ts';

/** The variable the CLI reads its connection token from. */
const TOKEN_VARIABLE = 'VSCODE_CLI_REQUIRE_TOKEN';

/** The script parameters' key for the CLI's name, data folder and the process to stop. */
const CLI_PARAMETERS = 'cli';

/** The highest TCP port. */
const MAXIMUM_PORT = 65535;

/** What a start says when the CLI was refused for want of its token. */
const TOKEN_MISSING_DETAIL = "the CLI's token did not reach the host";

/** The detail of a host whose connection token file is not one this extension would have made: it's never replaced. */
const TOKEN_INVALID_DETAIL =
  "the host's connection token file is not a private file holding a token";

/** Where the CLI goes and where its archive comes from. */
export interface CliPlacement {
  /** The plan's `cli` kind. */
  plan: Extract<Plan, {kind: 'cli'}>;
  /** The CLI archive's address. */
  address: string;
  /** The transfer's own inputs: the client side's folders, limits and checks. */
  transfer: Omit<
    TransferInput,
    'plan' | 'step' | 'parameters' | 'cancellation'
  >;
}

/** What the start of the CLI needs from its surroundings. */
export interface CliStartDependencies {
  lockLoop: HostLockLoop;
}

/** The outcome of an install of the CLI. */
export type CliInstallOutcome =
  {kind: 'placed'; path: string} | {kind: 'failed'; failure: TransferFailure};

/**
 * Places the CLI on the host in the host lock loop: from the archive when the plan says to download, else by the
 * install step alone, which reports the file that is already there. `base.launcher` is the CLI's name in the
 * archive and `base.cli` its place.
 */
export async function installCli(
  base: ScriptParameters,
  placement: CliPlacement,
  dependencies: TransferDependencies,
  cancellation: AbortSignal,
): Promise<CliInstallOutcome> {
  const {plan} = placement;
  const input: TransferInput = {
    ...placement.transfer,
    plan: {
      kind: 'download',
      where: plan.where,
      clientFallback: plan.clientFallback,
      address: placement.address,
      installFolder: plan.cliPath,
      dataFolder: plan.dataFolder,
      launcher: base.launcher,
      lockPlace: plan.lockPlace,
      notes: plan.notes,
    },
    step: 'installCli',
    parameters: base,
    cancellation,
  };
  const outcome = await (plan.download
    ? transfer(input, dependencies)
    : installPlaced(input, dependencies));
  return outcome.kind === 'transferred'
    ? {kind: 'placed', path: plan.cliPath}
    : outcome;
}

function failed(
  failure: Extract<StartOutcome, {kind: 'failed'}>['failure'],
): StartOutcome {
  return {kind: 'failed', failure};
}

/** The start outcome of a finished `startCli` run. */
/** Why a start failed, from the facts the script reported. */
function startFailureOf(
  facts: Readonly<Record<string, string>>,
): Extract<StartOutcome, {kind: 'failed'}>['failure'] {
  if (facts.tokenMissing === 'yes') {
    return {kind: 'serverStart', detail: TOKEN_MISSING_DETAIL};
  }
  if (facts.tokenInvalid === 'yes') {
    return {kind: 'serverStart', detail: TOKEN_INVALID_DETAIL};
  }
  return {kind: 'serverStart'};
}

/** The start outcome of a finished `startCli` run, with the host's connection token the script reported. */
function outcomeOf(stepRun: StepRun | 'retriesExhausted'): StartOutcome {
  const read = blockOfStart(stepRun);
  if ('unfinished' in read) {
    return read.unfinished;
  }
  const {block} = read;
  if (block.status === 'ServerFailedToStart') {
    return failed(startFailureOf(block.cliFacts));
  }
  if (block.status !== 'Ok') {
    return failed({kind: 'scriptFailed', status: block.status});
  }
  const port = Number(block.cliFacts.port);
  const processId = Number(block.cliFacts.pid);
  const connectionToken = block.cliFacts.connectionToken ?? '';
  return Number.isInteger(port) &&
    port >= 1 &&
    port <= MAXIMUM_PORT &&
    Number.isInteger(processId) &&
    processId > 1 &&
    connectionToken !== ''
    ? {
        kind: 'started',
        server: {
          endpoint: {kind: 'port', port},
          processId,
          connectionToken,
          reused: false,
        },
        notices: [],
      }
    : failed({kind: 'unreadableServerFacts'});
}

/**
 * Starts the placed CLI. The token goes in `VSCODE_CLI_REQUIRE_TOKEN` and nowhere else, and the script refuses to start
 * the CLI without it: a CLI that requires no token accepts any.
 */
export async function startCli(
  channel: HostChannel,
  base: ScriptParameters,
  token: string,
  dependencies: CliStartDependencies,
  cancellation: AbortSignal,
): Promise<StartOutcome> {
  const stepRun = await dependencies.lockLoop(
    () =>
      runStep(channel, {installMode: 'singleScript', step: 'startCli'}, base, {
        cancellation,
        environment: {[TOKEN_VARIABLE]: token},
      }),
    cancellation,
  );
  return outcomeOf(stepRun);
}

/** The outcome of a stop of the CLI: it was ended, it no longer ran as that CLI, or the step could not finish. */
export type CliStopOutcome =
  | {kind: 'stopped'}
  | {kind: 'notRunning'}
  | {
      kind: 'failed';
      failure: Extract<StartOutcome, {kind: 'failed'}>['failure'];
    };

/**
 * Ends the CLI that `startCli` started, `processId`, only while that process is still the CLI. No host lock is taken:
 * stopping one process changes nothing another connect relies on.
 */
export async function stopCli(
  channel: HostChannel,
  base: ScriptParameters & {cli: NonNullable<ScriptParameters['cli']>},
  processId: number,
  cancellation: AbortSignal,
): Promise<CliStopOutcome> {
  const stepRun = await runStep(
    channel,
    {installMode: 'singleScript', step: 'stopCli'},
    {...base, [CLI_PARAMETERS]: {...base.cli, stopProcessId: processId}},
    {cancellation},
  );
  const read = blockOfStart(stepRun);
  if ('unfinished' in read) {
    return read.unfinished;
  }
  if (read.block.status !== 'Ok') {
    return {
      kind: 'failed',
      failure: {kind: 'scriptFailed', status: read.block.status},
    };
  }
  return read.block.cliFacts.stopped === 'yes'
    ? {kind: 'stopped'}
    : {kind: 'notRunning'};
}
