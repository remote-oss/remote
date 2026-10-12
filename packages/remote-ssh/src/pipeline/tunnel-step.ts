/**
 * @fileoverview The step that opens the window's tunnel to the server: through the connection's SOCKS relay, the path
 * the default settings select. The socket and second-ssh paths are not built yet; they fail without a reason, and the
 * log names the path.
 */

import type {Scheduler} from 'lib-helper';
import {
  type Dialer,
  factoryFor,
  type LocalPort,
  openRelayTunnel,
  selectTunnelPath,
  type TunnelSettings,
  type WaitLimits,
} from 'lib-forwarding';
import type {Logger} from 'lib-log';
import type {ConnectSteps, StepFailure} from './steps.ts';

/** What the window gets besides the tunnel: the variables of its extension host and its environment tunnels. */
interface WindowEnvironment {
  extensionHostEnv: Readonly<Record<string, string | null>>;
  environmentTunnels: readonly unknown[];
}

/** What the step is made of. */
export interface TunnelStepDependencies {
  /** The settings that select the tunnel's path, as they are now. */
  settings: () => TunnelSettings;
  local: LocalPort;
  scheduler: Scheduler;
  limits: WaitLimits;
  /** The dialer through the connection's SOCKS relay on `socksPort`; the extension gives lib-forwarding's `socksDialer`. */
  dialerFor(socksPort: number): Dialer;
  /** The window's port on this machine's loopback, or nothing when none is free. */
  chooseLocalPort(): Promise<number | undefined>;
  /** The window's environment for the connection that is being set up. */
  environment(): WindowEnvironment;
  logger: Logger;
}

/** A failure that names no reason of its own: the dialog names only the host. */
function failedPlainly(
  kind: StepFailure['kind'],
): Awaited<ReturnType<ConnectSteps['openTunnel']>> {
  return {kind: 'failed', failure: {kind}};
}

/** The step over the connection's SOCKS relay. */
export function openTunnelStep(
  dependencies: TunnelStepDependencies,
): ConnectSteps['openTunnel'] {
  return async (...given) => {
    const [, lease, server] = given;
    const path = selectTunnelPath(dependencies.settings());
    if (path !== 'socks') {
      dependencies.logger.warn(
        `the window tunnel's ${path} path is not built yet`,
      );
      return failedPlainly('unknown');
    }
    const localPort = await dependencies.chooseLocalPort();
    if (localPort === undefined) {
      return failedPlainly('channelClosed');
    }
    const dialer = dependencies.dialerFor(lease.socksPort);
    const outcome = await openRelayTunnel({
      dialer,
      local: dependencies.local,
      scheduler: dependencies.scheduler,
      target: {kind: 'port', port: server.port},
      localPort,
      limits: dependencies.limits,
    });
    if (outcome.kind !== 'open') {
      return failedPlainly('channelClosed');
    }
    const factory = factoryFor({
      dialer,
      local: dependencies.local,
      scheduler: dependencies.scheduler,
      limits: dependencies.limits,
    });
    const {extensionHostEnv, environmentTunnels} = dependencies.environment();
    return {
      kind: 'done',
      value: {
        opened: {
          address: outcome.address,
          extensionHostEnv,
          environmentTunnels,
          tunnelFeatures: factory.features,
          tunnelFactory: factory,
        },
        close: () => {
          factory.closeAll();
          outcome.close();
        },
      },
    };
  };
}
