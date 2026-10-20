/**
 * @fileoverview The connect pipeline (R1): the steps of one connect in their order, with the phase events the
 * window shows, a bound on every wait of the machine's that could otherwise hang, the cancellation between steps,
 * and the one place where a failure of any step becomes the failure the window gets. What the connect has made (the
 * lease on the connection, the window's tunnel) is given back on every failure, also when a step throws or finishes
 * after it was given up on; on success it goes to the window. The waits for the user (the platform question, the
 * login's questions, the licence) have no limit of their own.
 */

import type {Connected, Failed} from 'lib-authority';
import {shouldApplyDefaults} from 'lib-forwarding';
import type {Logger} from 'lib-log';
import type {StartedServer, TransferPhase} from 'lib-server';
import {
  type FailureContext,
  type FailureDetail,
  failedWith,
  ofPlan,
  ofProbe,
  ofStart,
  ofTransfer,
} from './failure.ts';
import {connectOverCli} from '../cli/cli-connect.ts';
import type {ForwardingPlans} from '../environment/forwarding.ts';
import {hostPlatformLine} from '../diagnostics/log-content.ts';
import type {
  ConnectInput,
  ConnectionLease,
  ConnectSteps,
  ConnectWaits,
  StepFailure,
  StepResult,
} from './steps.ts';

/** What the window is told while the connect runs, in the order the steps happen. */
export type PhaseEvent =
  | {kind: 'initializing'; quiet?: true}
  | {kind: 'promptShown'}
  | {kind: 'waitingForOtherWindow'}
  | {kind: 'downloading'}
  | {kind: 'downloadingLocally'}
  | {kind: 'copyingWithScp'}
  | {kind: 'installing'}
  | {kind: 'serverDownloadPercent'; percent: number}
  | {kind: 'settingUpTunnel'}
  | {kind: 'waitingForForwarding'};

/** What one connect is given besides its steps. */
export interface ConnectOptions {
  cancellation: AbortSignal;
  onPhase: (event: PhaseEvent) => void;
  /** The value of `remote.SSH.maxReconnectionAttempts`, as the user wrote it. */
  maximumReconnectionAttempts: unknown;
  /** How long the pre-connection script may take, with its question to the user. */
  preconnectMilliseconds: number;
  logger: Logger;
  /** The editor's commit and quality, which the CLI path's `serve` names. */
  serve: {commit: string; quality: string};
  /** The value of `remote.SSH.useExecServer`, read when the connect starts. */
  useExecServer: boolean;
}

/** How a bounded step ended when it did not give its value. */
type Interrupted = 'cancelled' | 'timeout';

/** The port of a server that listens on one; a server on a socket must not reach a path that needs a port. */
export function portOf(server: StartedServer): number {
  if (server.endpoint.kind !== 'port') {
    throw new Error('a socket-mode server reached the port path');
  }
  return server.endpoint.port;
}

/** Whether the signal has been aborted by now; read through a call because it changes while a step runs. */
export function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

/**
 * Runs `work` with a signal that ends at the caller's cancellation or at the limit; a step with no limit is ended by the
 * cancellation alone. The result does not wait for a step that ignores its signal; what such a step gives later is
 * handed to `discard`, so that it is not leaked.
 */
async function bounded<Value>(
  work: (signal: AbortSignal) => Promise<Value>,
  milliseconds: number | undefined,
  cancellation: AbortSignal,
  discard: (late: Value) => void,
): Promise<{value: Value} | {interrupted: Interrupted}> {
  if (cancellation.aborted) {
    return {interrupted: 'cancelled'};
  }
  const signal =
    milliseconds === undefined
      ? cancellation
      : AbortSignal.any([cancellation, AbortSignal.timeout(milliseconds)]);
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

/** What happened to the connection after the connect: lost (it may come back) or closed (it will not). */
export type TransportEvent = 'lost' | 'closed';

/** A connect that worked: what the window gets, and the end of the connection when the window ends. */
export interface Connection {
  connected: Connected;
  /** The TCP port the server listens on at the host's loopback. */
  serverPort: number;
  /** The window's agent link and display plans, which set its terminals' environment. */
  forwarding: ForwardingPlans;
  /** Closes the tunnel and gives the lease on the connection back; the connector calls it when the window ends. */
  release(): void;
  /** Hears what happens to the connection's transport; the returned function stops it. */
  onTransport(listener: (event: TransportEvent) => void): () => void;
}

/** What a connect has made so far, to give back when it fails; the tunnel is last, and it is the window's to close. */
interface Held {
  lease?: ConnectionLease;
}

/** The text of anything a step throws. */
function messageOf(caught: unknown): string {
  return String(caught);
}

/** What the window's failure says around its detail: the attempt, and what the step found. */
function contextOf(
  input: ConnectInput,
  options: ConnectOptions,
  step: StepFailure,
): FailureContext {
  return {
    attempt: input.attempt,
    isReconnection: input.isReconnection,
    maximumReconnectionAttempts: options.maximumReconnectionAttempts,
    userAlreadyNotified: step.userAlreadyNotified ?? false,
    hints: step.hints ?? [],
    diagnostics: step.diagnostics ?? [],
  };
}

/** The checks that come first, in the order of their failures. */
const CHECKS = [
  'checkConfigFile',
  'checkStartSettings',
  'validate',
  'checkInstallFolder',
] as const;

/** One connect: runs the steps in order and returns the connection, or the failure. */
export async function connect(
  input: ConnectInput,
  steps: ConnectSteps,
  options: ConnectOptions,
): Promise<Connection | Failed> {
  const held: Held = {};

  function failure(step: StepFailure): Failed {
    held.lease?.release();
    const context = contextOf(input, options, step);
    if (step.sshExitStatus !== undefined) {
      options.logger.warn(
        step.sshExitStatus === null
          ? 'ssh ended on a signal'
          : `ssh exited with status ${String(step.sshExitStatus)}`,
      );
    }
    options.logger.warn(`connect failed: ${step.kind}`);
    if (step.logDetail !== undefined) {
      options.logger.warn(`the ${step.kind} failure: ${step.logDetail}`);
    }
    return failedWith(step, context);
  }

  try {
    return await runSteps(input, steps, options, held, failure);
  } catch (caught) {
    return failure({kind: 'unknown', logDetail: messageOf(caught)});
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
  const {cancellation} = options;

  /** A bounded step that gives a result; a result that is not its value is the failure to return. */
  async function runBounded<Value>(
    work: (signal: AbortSignal) => Promise<StepResult<Value>>,
    milliseconds: number | undefined,
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

  /** Starts the default forwards of a connect that has worked, unless it is a reconnection; never awaited. */
  function startDefaultForwards(): void {
    if (shouldApplyDefaults(input.isReconnection)) {
      void quietly('the default forwards', () => steps.applyDefaults(input));
    }
  }

  function cancelled(): Failed | undefined {
    return cancellation.aborted ? failure({kind: 'cancelled'}) : undefined;
  }

  options.onPhase({kind: 'initializing', quiet: true});
  for (const check of CHECKS) {
    const invalid = steps[check](input);
    if (invalid.kind === 'failed') {
      return failure(invalid.failure);
    }
  }
  if (input.attempt === 1) {
    const script = await runBounded(
      signal => steps.preconnect(input, signal),
      options.preconnectMilliseconds,
      {kind: 'preconnectFailed'},
      () => undefined,
    );
    if ('failed' in script) {
      return script.failed;
    }
  }
  const terms = await steps.decideTerms(input, cancellation);
  if (terms.kind === 'failed') {
    return failure(terms.failure);
  }
  const undecided = cancelled();
  if (undecided !== undefined) {
    return undecided;
  }
  let waits: ConnectWaits | undefined;
  if (steps.lookupBeforeConnection()) {
    const located = await steps.locateClient(input);
    if (located.kind === 'failed') {
      return failure(located.failure);
    }
    const unlocated = cancelled();
    if (unlocated !== undefined) {
      return unlocated;
    }
    waits = located.value;
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
  waits ??= lease.waits;
  if (waits === undefined) {
    throw new Error('the connection was opened with no waits and no lookup');
  }
  const dropped = cancelled();
  if (dropped !== undefined) {
    return dropped;
  }
  const probed = await bounded(
    signal => steps.probe(input, lease, signal),
    waits.probeMilliseconds,
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
  options.logger.info(hostPlatformLine(host));
  const forwarding = await steps.planForwarding(
    input,
    lease,
    host,
    cancellation,
  );
  let planned = steps.plan(input, host);
  if ('failure' in planned) {
    return failure(ofPlan(planned.failure));
  }
  const gate = await steps.gate(input, cancellation);
  const stopped = cancelled();
  if (stopped !== undefined) {
    return stopped;
  }
  if (gate.kind === 'licenceDeclined') {
    return failure({kind: 'licenceDeclined', reason: {id: 'S027'}});
  }
  if (gate.kind === 'cancelled') {
    return failure({kind: 'cancelled'});
  }
  if (planned.plan.kind === 'cli') {
    const overCli = await connectOverCli({
      input,
      lease,
      host,
      plan: planned.plan,
      steps,
      logger: options.logger,
      serve: options.serve,
      useExecServer: options.useExecServer,
      failedOf: detail => failedWith(detail, contextOf(input, options, detail)),
      cancellation,
    });
    if (overCli.kind === 'connected') {
      void quietly('the platform setting', () =>
        steps.rememberPlatform(input, host.operatingSystem),
      );
      startDefaultForwards();
      steps.linkAgent(lease, forwarding.agentLink);
      return {
        connected: overCli.connected,
        serverPort: 0,
        forwarding,
        release: () => {
          overCli.release();
        },
        onTransport: listener => overCli.onTransport(listener),
      };
    }
    if (overCli.kind === 'failed') {
      return failure(overCli.failure);
    }
    const dropped = cancelled();
    if (dropped !== undefined) {
      return dropped;
    }
    options.logger.warn(
      `the CLI path failed (${overCli.cause}); installing the server directly`,
    );
    planned = steps.plan(input, host, {direct: true});
    if ('failure' in planned) {
      return failure(ofPlan(planned.failure));
    }
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
      return failure(
        ofTransfer(transferred.failure, {
          step: planned.step,
          architecture: host.architecture,
          address: planned.plan.address,
        }),
      );
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
    return failure(
      ofStart(started.failure, {useExecServer: options.useExecServer}),
    );
  }
  if (
    started.notices.some(notice => notice.kind === 'requirementsHelperMissing')
  ) {
    options.logger.warn(
      "the server has no requirements helper; the host's requirements weren't checked",
    );
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
    // A second `ssh` has bounds of its own and a login to wait for, which a limit sized for the relay would cut off.
    steps.tunnelPath() === 'socks' ? waits.tunnelMilliseconds : undefined,
    {kind: 'timeout'},
    late => {
      late.close();
    },
  );
  if ('failed' in tunnel) {
    return tunnel.failed;
  }
  const {endpoint} = started.server;
  if (endpoint.kind === 'port') {
    await quietly('the shared record', () =>
      lease.storeSharedRecord({
        remotePort: endpoint.port,
        operatingSystem: host.operatingSystem,
        architecture: host.architecture,
        temporaryFolder: host.temporaryFolder,
        connectionToken: started.server.connectionToken,
        agentLink: forwarding.agentLink,
        display: forwarding.display,
      }),
    );
  }
  void quietly('the platform setting', () =>
    steps.rememberPlatform(input, host.operatingSystem),
  );
  startDefaultForwards();
  const {opened} = tunnel.value;
  steps.linkAgent(lease, forwarding.agentLink);
  return {
    connected: {
      ...opened,
      connectionToken: started.server.connectionToken,
      trusted: false,
    },
    serverPort: endpoint.kind === 'port' ? endpoint.port : 0,
    forwarding,
    release: () => {
      tunnel.value.close();
      lease.release();
    },
    onTransport: listener => {
      let tunnelEndActive = true;
      const stopLease = lease.onNotice(notice => {
        if (notice.type === 'transportLost') {
          listener('lost');
        } else if (notice.type === 'helperGone') {
          listener('closed');
        }
      });
      tunnel.value.onClosed(detail => {
        if (!tunnelEndActive) {
          return;
        }
        options.logger.warn(`the window tunnel ended: ${detail}`);
        listener('lost');
      });
      return () => {
        tunnelEndActive = false;
        stopLease();
      };
    },
  };
}
