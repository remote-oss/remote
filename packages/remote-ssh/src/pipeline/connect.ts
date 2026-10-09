/**
 * @fileoverview The connect pipeline (R1): the steps of one connect in their order, with the phase events the
 * window shows, a bound on every wait of the machine's that could otherwise hang, the cancellation between steps,
 * and the one place where a failure of any step becomes the failure the window gets. What the connect has made (the
 * lease on the connection, the window's tunnel) is given back on every failure, also when a step throws or finishes
 * after it was given up on; on success it goes to the window. The waits for the user (the platform question, the
 * login's questions, the licence) have no limit of their own.
 */

import type {Connected, Failed} from 'lib-authority';
import type {Logger} from 'lib-log';
import type {TransferPhase} from 'lib-server';
import {
  type FailureContext,
  type FailureDetail,
  failedWith,
  ofPlan,
  ofProbe,
  ofStart,
  ofTransfer,
} from './failure.ts';
import type {
  ConnectInput,
  ConnectionLease,
  ConnectSteps,
  StepFailure,
  StepResult,
} from './steps.ts';

/** What the window is told while the connect runs, in the order the steps happen. */
export type PhaseEvent =
  | {kind: 'initializing'}
  | {kind: 'downloading'}
  | {kind: 'downloadingLocally'}
  | {kind: 'copyingWithScp'}
  | {kind: 'installing'}
  | {kind: 'serverDownloadPercent'; percent: number}
  | {kind: 'settingUpTunnel'}
  | {kind: 'waitingForForwarding'};

/** The longest each step that waits on the machine may take, in milliseconds. */
interface StepLimits {
  preconnectMilliseconds: number;
  probeMilliseconds: number;
  tunnelMilliseconds: number;
}

/** What one connect is given besides its steps. */
export interface ConnectOptions {
  cancellation: AbortSignal;
  onPhase: (event: PhaseEvent) => void;
  /** The value of `remote.SSH.maxReconnectionAttempts`, as the user wrote it. */
  maximumReconnectionAttempts: unknown;
  limits: StepLimits;
  logger: Logger;
}

/** How a bounded step ended when it did not give its value. */
type Interrupted = 'cancelled' | 'timeout';

/** Whether the signal has been aborted by now; read through a call because it changes while a step runs. */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

/**
 * Runs `work` with a signal that ends at the caller's cancellation or at the limit. The result does not wait for a
 * step that ignores its signal; what such a step gives later is handed to `discard`, so that it is not leaked.
 */
async function bounded<Value>(
  work: (signal: AbortSignal) => Promise<Value>,
  milliseconds: number,
  cancellation: AbortSignal,
  discard: (late: Value) => void,
): Promise<{value: Value} | {interrupted: Interrupted}> {
  if (cancellation.aborted) {
    return {interrupted: 'cancelled'};
  }
  const signal = AbortSignal.any([
    cancellation,
    AbortSignal.timeout(milliseconds),
  ]);
  const ended = new Promise<'ended'>(resolve => {
    signal.addEventListener('abort', () => {
      resolve('ended');
    });
  });
  const running = work(signal);
  const result = await Promise.race([running.then(value => ({value})), ended]);
  if (result === 'ended') {
    running.then(discard, () => undefined);
    return {interrupted: isAborted(cancellation) ? 'cancelled' : 'timeout'};
  }
  return result;
}

/** The phase a transfer stage is, or none for a stage the window does not show. */
function phaseOfTransfer(phase: TransferPhase): PhaseEvent | undefined {
  switch (phase.kind) {
    case 'downloading':
    case 'downloadingLocally':
    case 'installing':
      return {kind: phase.kind};
    case 'copying':
      return {kind: 'copyingWithScp'};
    default:
      return phase.step === 'download'
        ? {kind: 'serverDownloadPercent', percent: phase.percent}
        : undefined;
  }
}

/** A connect that worked: what the window gets, and the end of the connection when the window ends. */
export interface Connection {
  connected: Connected;
  /** Closes the tunnel and gives the lease on the connection back; the connector calls it when the window ends. */
  release(): void;
}

/** What a connect has made so far, to give back when it fails; the tunnel is last, and it is the window's to close. */
interface Held {
  lease?: ConnectionLease;
}

/** The text of anything a step throws. */
function messageOf(caught: unknown): string {
  return String(caught);
}

/** One connect: runs the steps in order and returns the connection, or the failure. */
export async function connect(
  input: ConnectInput,
  steps: ConnectSteps,
  options: ConnectOptions,
): Promise<Connection | Failed> {
  const held: Held = {};

  function failure(step: StepFailure): Failed {
    held.lease?.release();
    const context: FailureContext = {
      attempt: input.attempt,
      isReconnection: input.isReconnection,
      maximumReconnectionAttempts: options.maximumReconnectionAttempts,
      userAlreadyNotified: step.userAlreadyNotified ?? false,
      hints: step.hints ?? [],
      diagnostics: step.diagnostics ?? [],
    };
    options.logger.warn(`connect failed: ${step.kind}`);
    return failedWith(step, context);
  }

  try {
    return await runSteps(input, steps, options, held, failure);
  } catch (caught) {
    return failure({kind: 'unknown', reason: {text: messageOf(caught)}});
  }
}

/** The steps in their order; a failure is returned through `failure`, which gives back what `held` holds. */
async function runSteps(
  input: ConnectInput,
  steps: ConnectSteps,
  options: ConnectOptions,
  held: Held,
  failure: (step: StepFailure) => Failed,
): Promise<Connection | Failed> {
  const {cancellation, limits} = options;

  /** A bounded step that gives a result; a result that is not its value is the failure to return. */
  async function runBounded<Value>(
    work: (signal: AbortSignal) => Promise<StepResult<Value>>,
    milliseconds: number,
    onTimeout: FailureDetail,
    discard: (late: Value) => void,
  ): Promise<{value: Value} | {failed: Failed}> {
    const result = await bounded(work, milliseconds, cancellation, late => {
      if (late.kind === 'done') {
        discard(late.value);
      }
    });
    if ('interrupted' in result) {
      return {
        failed: failure(
          result.interrupted === 'cancelled' ? {kind: 'cancelled'} : onTimeout,
        ),
      };
    }
    return result.value.kind === 'done'
      ? {value: result.value.value}
      : {failed: failure(result.value.failure)};
  }

  /** Runs a step whose failure must never fail the connect: it is logged and the connect goes on. */
  async function quietly(
    name: string,
    work: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await work();
    } catch (caught) {
      options.logger.warn(`${name} did not work: ${messageOf(caught)}`);
    }
  }

  function cancelled(): Failed | undefined {
    return cancellation.aborted ? failure({kind: 'cancelled'}) : undefined;
  }

  options.onPhase({kind: 'initializing'});
  const invalid = steps.validate(input);
  if (invalid.kind === 'failed') {
    return failure(invalid.failure);
  }
  if (input.attempt === 1) {
    const script = await runBounded(
      signal => steps.preconnect(input, signal),
      limits.preconnectMilliseconds,
      {kind: 'preconnectFailed'},
      () => undefined,
    );
    if ('failed' in script) {
      return script.failed;
    }
  }
  const located = await steps.locateClient(input);
  if (located.kind === 'failed') {
    return failure(located.failure);
  }
  const terms = await steps.decideTerms(input, cancellation);
  if (terms.kind === 'failed') {
    return failure(terms.failure);
  }
  const undecided = cancelled();
  if (undecided !== undefined) {
    return undecided;
  }
  const connection = await steps.openConnection(
    input,
    terms.value,
    cancellation,
  );
  if (connection.kind === 'failed') {
    return failure(connection.failure);
  }
  const lease = connection.value;
  held.lease = lease;
  const dropped = cancelled();
  if (dropped !== undefined) {
    return dropped;
  }
  const probed = await bounded(
    signal => steps.probe(input, lease, signal),
    limits.probeMilliseconds,
    cancellation,
    () => undefined,
  );
  if ('interrupted' in probed) {
    return failure(
      probed.interrupted === 'cancelled'
        ? {kind: 'cancelled'}
        : {kind: 'timeout'},
    );
  }
  if (probed.value.kind === 'failed') {
    return failure(ofProbe(probed.value.failure));
  }
  const {host} = probed.value;
  const planned = steps.plan(input, host);
  if ('failure' in planned) {
    return failure(ofPlan(planned.failure));
  }
  const gate = await steps.gate(input, cancellation);
  const stopped = cancelled();
  if (stopped !== undefined) {
    return stopped;
  }
  if (gate.kind === 'licenceDeclined') {
    return failure({kind: 'licenceDeclined'});
  }
  if (planned.plan.kind === 'download') {
    const transferred = await steps.transfer(
      input,
      lease,
      host,
      planned.plan,
      phase => {
        const event = phaseOfTransfer(phase);
        if (event !== undefined) {
          options.onPhase(event);
        }
      },
      cancellation,
    );
    if (transferred.kind === 'failed') {
      return failure(ofTransfer(transferred.failure));
    }
  }
  const interrupted = cancelled();
  if (interrupted !== undefined) {
    return interrupted;
  }
  const started = await steps.start(
    input,
    lease,
    host,
    gate.acceptanceFlag,
    cancellation,
  );
  if (started.kind === 'failed') {
    return failure(ofStart(started.failure));
  }
  if (started.server.reused) {
    await quietly('the default extensions', () =>
      steps.installExtensions(input, lease, cancellation),
    );
  }
  options.onPhase({kind: 'settingUpTunnel'});
  const tunnel = await runBounded(
    signal =>
      steps.openTunnel(
        input,
        lease,
        started.server,
        () => {
          options.onPhase({kind: 'waitingForForwarding'});
        },
        signal,
      ),
    limits.tunnelMilliseconds,
    {kind: 'timeout'},
    late => {
      late.close();
    },
  );
  if ('failed' in tunnel) {
    return tunnel.failed;
  }
  await quietly('the shared record', () =>
    lease.storeSharedRecord({
      remotePort: started.server.port,
      operatingSystem: host.operatingSystem,
      architecture: host.architecture,
      temporaryFolder: host.temporaryFolder,
      connectionToken: started.server.connectionToken,
    }),
  );
  await quietly('the platform setting', () =>
    steps.rememberPlatform(input, host.operatingSystem),
  );
  const {opened} = tunnel.value;
  return {
    connected: {
      ...opened,
      connectionToken: started.server.connectionToken,
      trusted: false,
    },
    release: () => {
      tunnel.value.close();
      lease.release();
    },
  };
}
