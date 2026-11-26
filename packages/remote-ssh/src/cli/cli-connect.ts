/**
 * @fileoverview The connect's path through the editor's command-line program: place it, start it with a control token,
 * reach its control port through the window's tunnel, check that it requires its token, authenticate, and give the
 * window a local bridge. A window's first resolve waits for the first `serve`, which installs and starts the server, so
 * the connection's notification shows the download and the install while they last; a reconnection resolves at once
 * and its first connection serves. A failure before the control is authenticated falls back to the direct install;
 * a `serve` that fails fails the resolve; one after the resolve closes the window's transport and shows the failure.
 */

import {busyRangeReason} from '../pipeline/port-choice.ts';
import type {Connected, Failed} from 'lib-authority';
import type {Logger} from 'lib-log';
import {
  type CliControl,
  cliServerFolderOf,
  openCliControl,
  type Plan,
  type ProbedHost,
  s045EventOf,
  type StartedServer,
} from 'lib-server';
import {
  type FailureDetail,
  ofCliServe,
  ofStart,
  ofTransfer,
} from '../pipeline/failure.ts';
import type {
  ConnectInput,
  ConnectionLease,
  ConnectSteps,
  TunnelOpening,
} from '../pipeline/steps.ts';
import type {CliBridgeLoss} from './cli-bridge.ts';

/** The error a CLI that requires a token gives to a challenge with another token. */
const BAD_TOKEN = 'CodeError(AuthChallengeBadToken)';

/** The logger's levels by the CLI's, from trace (0) to critical (5), which the log has no level of its own for. */
const LOG_LEVELS = [
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'error',
] as const;

/** The detail of a CLI that did not require its token: the connect fails rather than use it. */
export const TOKEN_NOT_REQUIRED = 'the CLI did not require its token';

/** What the CLI path gives the connect. */
export type CliConnectResult =
  | {
      kind: 'connected';
      connected: Connected;
      /** The control connection the window's bridge rides on, for the exec server of the window. */
      control: CliControl;
      release(): void;
      onTransport: (listener: (event: 'lost' | 'closed') => void) => () => void;
    }
  | {kind: 'failed'; failure: FailureDetail}
  | {kind: 'fallback'; cause: string};

/** What the CLI path needs besides the steps. */
export interface CliConnectContext {
  input: ConnectInput;
  lease: ConnectionLease;
  host: ProbedHost;
  plan: Extract<Plan, {kind: 'cli'}>;
  steps: ConnectSteps;
  logger: Logger;
  /** The editor's commit and quality, which `serve` names: the CLI expands its server template only for its own. */
  serve: {commit: string; quality: string};
  /** The value of `remote.SSH.useExecServer`, which the reason of a failed start depends on. */
  useExecServer: boolean;
  /** Builds the window's failure from a detail, as the connect does for its own failures. */
  failedOf: (detail: FailureDetail) => Failed;
  /** Shows a stage of the server's setup, or of the window's connection to it, in the connection's notification. */
  onServerPhase: (
    phase:
      {kind: 'downloading'} | {kind: 'installing'} | {kind: 'settingUpTunnel'},
  ) => void;
  cancellation: AbortSignal;
}

/** A failure as the fallback's log line names it: its kind, and its detail when it has one. */
function causeOf(detail: FailureDetail): string {
  return detail.logDetail === undefined
    ? detail.kind
    : `${detail.kind}: ${detail.logDetail}`;
}

/** What the CLI path needs to reach and authenticate the CLI's control connection. */
export type CliControlContext = Pick<
  CliConnectContext,
  | 'input'
  | 'lease'
  | 'host'
  | 'plan'
  | 'steps'
  | 'logger'
  | 'useExecServer'
  | 'cancellation'
>;

/** The CLI started, reached and authenticated: its control connection, and what gives everything back. */
interface OpenedControl {
  kind: 'opened';
  control: CliControl;
  server: StartedServer;
  tunnel: TunnelOpening;
  /** Hears the end of the control connection; the listener runs once. */
  onControlEnded: (listener: () => void) => void;
  /** Closes the control connection and the tunnel, and stops the CLI. */
  abandon: () => Promise<void>;
  /** Stops the CLI. */
  stop: () => Promise<void>;
}

/**
 * Places the CLI, starts it with a control token, reaches its control port through a tunnel, checks that it requires
 * its token, and authenticates. A failure before the window resolves falls back to the direct install.
 */
async function openControl(
  context: CliControlContext,
): Promise<
  | OpenedControl
  | {kind: 'failed'; failure: FailureDetail}
  | {kind: 'fallback'; cause: string}
> {
  const {input, lease, host, plan, steps, logger, cancellation} = context;
  const installed = await steps.installCli(
    input,
    lease,
    host,
    plan,
    () => undefined,
    cancellation,
  );
  if (installed.kind === 'failed') {
    return {
      kind: 'fallback',
      cause: causeOf(ofTransfer(installed.failure)),
    };
  }
  const controlToken = steps.newSecret();
  const started = await steps.startCli(
    input,
    lease,
    host,
    plan,
    controlToken,
    cancellation,
  );
  if (started.kind === 'failed') {
    return {
      kind: 'fallback',
      cause: causeOf(
        ofStart(started.failure, {useExecServer: context.useExecServer}),
      ),
    };
  }
  const processId = started.server.processId;
  function stop(): Promise<void> {
    return steps.stopCli(input, lease, host, plan, processId);
  }
  const tunnelResult = await steps.openTunnel(
    input,
    lease,
    started.server,
    () => undefined,
    cancellation,
  );
  if (tunnelResult.kind === 'failed') {
    await stop();
    return {
      kind: 'fallback',
      cause: `no tunnel to the CLI: ${tunnelResult.failure.kind}`,
    };
  }
  const tunnel: TunnelOpening = tunnelResult.value;
  let controlEnded: Array<() => void> = [];
  const stream = await steps.connectControl(tunnel.opened.address.port);
  if (stream === undefined) {
    tunnel.close();
    await stop();
    return {kind: 'fallback', cause: 'the CLI refused a control connection'};
  }
  stream.onClose(() => {
    for (const listener of controlEnded) {
      listener();
    }
    controlEnded = [];
  });
  const control = openCliControl(stream);

  async function abandon(): Promise<void> {
    control.close();
    tunnel.close();
    await stop();
  }

  const probe = await control.authenticate(steps.newSecret());
  if (probe.kind !== 'challengeRefused' || probe.message !== BAD_TOKEN) {
    await abandon();
    logger.warn(`the CLI accepted a token it did not issue: ${probe.kind}`);
    return {
      kind: 'failed',
      failure: {kind: 'serverStart', logDetail: TOKEN_NOT_REQUIRED},
    };
  }
  const authenticated = await control.authenticate(controlToken);
  if (authenticated.kind !== 'authenticated') {
    await abandon();
    return {
      kind: 'fallback',
      cause: `the CLI refused its token: ${authenticated.kind}`,
    };
  }
  return {
    kind: 'opened',
    control,
    server: started.server,
    tunnel,
    onControlEnded: listener => {
      controlEnded.push(listener);
    },
    abandon,
    stop,
  };
}

/**
 * Shows the download stage when the CLI has no server folder for the window's commit: its first `serve` then fetches
 * the server, and logs that only to its own files. A folder it can't check shows nothing, with one log line.
 */
async function showDownload(
  context: CliConnectContext,
  control: CliControl,
): Promise<void> {
  const folder = cliServerFolderOf(
    context.plan.cliDataFolder,
    context.serve.quality,
    context.serve.commit,
  );
  const checked = await control.fsStat(folder);
  if (checked.kind !== 'stat') {
    context.logger.info(
      `the CLI's server folder ${folder} could not be checked (${checked.kind}): no download stage`,
    );
    return;
  }
  if (!checked.stat.exists) {
    context.onServerPhase({kind: 'downloading'});
  }
}

/** The failure of a resolve whose first `serve` did not serve. */
function ofFirstServe(loss: CliBridgeLoss): FailureDetail {
  return loss.kind === 'serveFailed'
    ? ofCliServe(loss.error, loss.errorLine)
    : {kind: 'serverStart'};
}

/** Runs the CLI path. */
export async function connectOverCli(
  context: CliConnectContext,
): Promise<CliConnectResult> {
  const {lease, steps, logger} = context;
  const opened = await openControl(context);
  if (opened.kind !== 'opened') {
    return opened;
  }
  const {control, server, tunnel, abandon, stop} = opened;
  const serveParams = {
    commit: context.serve.commit,
    quality: context.serve.quality,
    connectionToken: server.connectionToken,
    useLocalDownload: false,
  };
  let resolving = !context.input.isReconnection;
  let installing = false;
  const bridge = await steps.openBridge(control, serveParams, {
    onServeLog: line => {
      logger[LOG_LEVELS[line.level] ?? 'info'](line.text);
      if (resolving && !installing && s045EventOf(line)?.kind === 'hold') {
        installing = true;
        context.onServerPhase({kind: 'installing'});
      }
    },
    onControlEnded: opened.onControlEnded,
  });
  if (bridge !== undefined && 'busyRange' in bridge) {
    await abandon();
    return {
      kind: 'failed',
      failure: {kind: 'unknown', reason: busyRangeReason(bridge.busyRange)},
    };
  }
  if (bridge === undefined) {
    await abandon();
    return {kind: 'fallback', cause: 'no local port for the bridge'};
  }
  if (resolving) {
    await showDownload(context, control);
    const served = await bridge.firstServe();
    resolving = false;
    if (served.kind !== 'serving') {
      await abandon();
      return {kind: 'failed', failure: ofFirstServe(served)};
    }
    context.onServerPhase({kind: 'settingUpTunnel'});
  }
  let released = false;
  function giveBack(): void {
    lease.release();
  }
  return {
    kind: 'connected',
    control,
    connected: {
      ...tunnel.opened,
      address: bridge.address,
      connectionToken: serveParams.connectionToken,
      trusted: false,
    },
    release: () => {
      if (released) {
        return;
      }
      released = true;
      bridge.close();
      tunnel.close();
      // The lease goes back once the stop has settled, which the step bounds: the stop runs over the lease's channel.
      void stop().then(giveBack, giveBack);
    },
    onTransport: listener => {
      let active = true;
      bridge.onLost((cause: CliBridgeLoss) => {
        if (!active) {
          return;
        }
        if (cause.kind === 'serveFailed') {
          const detail = ofCliServe(cause.error, cause.errorLine);
          logger.warn(
            `the CLI could not serve: ${cause.error.kind}: ${cause.errorLine ?? JSON.stringify(cause.error)}`,
          );
          steps.presentLateFailure(context.failedOf(detail));
          listener('closed');
        } else {
          listener('lost');
        }
      });
      tunnel.onClosed(detail => {
        if (active) {
          logger.warn(`the tunnel to the CLI ended: ${detail}`);
          listener('lost');
        }
      });
      return () => {
        active = false;
      };
    },
  };
}

/** What the CLI path gives an exec server: the control connection held, with no server and no window tunnel. */
export type CliHoldResult =
  | {
      kind: 'held';
      control: CliControl;
      release: () => void;
      onTransport: (listener: (event: 'lost' | 'closed') => void) => () => void;
    }
  | {kind: 'failed'; failure: FailureDetail}
  | {kind: 'fallback'; cause: string};

/**
 * Runs the CLI path as far as the authenticated control connection and holds it, for an exec server: no `serve`, since
 * no VS Code server on the host belongs to this window, and no bridge. The control connection's end, or the end of the
 * tunnel it rides on, is the lost transport.
 */
export async function holdOverCli(
  context: CliControlContext,
): Promise<CliHoldResult> {
  const {lease, logger} = context;
  const opened = await openControl(context);
  if (opened.kind !== 'opened') {
    return opened;
  }
  let released = false;
  const listeners: Array<() => void> = [];
  function ended(): void {
    if (!released) {
      for (const listener of listeners) {
        listener();
      }
    }
  }
  opened.onControlEnded(ended);
  opened.tunnel.onClosed(detail => {
    logger.warn(`the tunnel to the CLI ended: ${detail}`);
    ended();
  });
  function giveBack(): void {
    lease.release();
  }
  return {
    kind: 'held',
    control: opened.control,
    release: () => {
      if (released) {
        return;
      }
      released = true;
      opened.control.close();
      opened.tunnel.close();
      // The lease goes back once the stop has settled, which the step bounds: the stop runs over the lease's channel.
      void opened.stop().then(giveBack, giveBack);
    },
    onTransport: listener => {
      function wrapped(): void {
        listener('lost');
      }
      listeners.push(wrapped);
      return () => {
        listeners.splice(listeners.indexOf(wrapped), 1);
      };
    },
  };
}
