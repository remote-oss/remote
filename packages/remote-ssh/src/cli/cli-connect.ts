/**
 * @fileoverview The connect's path through the editor's command-line program: place it, start it with a control token,
 * reach its control port through the window's tunnel, check that it requires its token, authenticate, and give the
 * window a local bridge. The window resolves here; the server is installed and started by the first connection on the
 * bridge. A failure before the window resolves falls back to the direct install; one after it closes the window's
 * transport and shows the failure.
 */

import type {Connected, Failed} from 'lib-authority';
import type {Logger} from 'lib-log';
import {openCliControl, type Plan, type ProbedHost} from 'lib-server';
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
  cancellation: AbortSignal;
}

/** A failure as the fallback's log line names it: its kind, and its detail when it has one. */
function causeOf(detail: FailureDetail): string {
  return detail.logDetail === undefined
    ? detail.kind
    : `${detail.kind}: ${detail.logDetail}`;
}

/** Runs the CLI path. */
export async function connectOverCli(
  context: CliConnectContext,
): Promise<CliConnectResult> {
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
  const serveParams = {
    commit: context.serve.commit,
    quality: context.serve.quality,
    connectionToken: started.server.connectionToken,
    useLocalDownload: false,
  };
  const bridge = await steps.openBridge(control, serveParams, {
    onServeLog: line => {
      logger[LOG_LEVELS[line.level] ?? 'info'](line.text);
    },
    onControlEnded: listener => {
      controlEnded.push(listener);
    },
  });
  if (bridge === undefined) {
    await abandon();
    return {kind: 'fallback', cause: 'no local port for the bridge'};
  }
  let released = false;
  function giveBack(): void {
    lease.release();
  }
  return {
    kind: 'connected',
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
