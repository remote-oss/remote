/**
 * @fileoverview The host's side of a connection: a listener on the loopback that relays each connection into the
 * container with `docker exec`, on the server's own port when the host has it free.
 */

import {
  type Dialer,
  findFreePort,
  type LocalPort,
  openRelayTunnel,
  type PortProber,
  TUNNEL_WAIT_LIMITS,
} from 'lib-forwarding';
import type {Failed} from 'lib-authority';
import type {Scheduler} from 'lib-helper';
import type {Logger} from 'lib-log';
import type {EngineHost} from '../engine/engine-host.ts';
import {execDialer} from '../exec/exec-dialer.ts';
import {relayFailed} from './failures.ts';

/** What the relay is made from. */
export interface RelayDependencies {
  local: LocalPort;
  prober: PortProber;
  scheduler: Scheduler;
  logger: Logger;
}

/** What one relay is asked to carry. */
export interface RelayRequest {
  engine: EngineHost;
  containerId: string;
  remoteUser: string;
  /** The installed server's own `node`, and the relay script, both inside the container. */
  nodePath: string;
  relayPath: string;
  containerPort: number;
  /** Told each time a relayed connection ends, once the relay is open. */
  onConnectionClosed: () => void;
}

/** An open relay. */
export interface OpenRelay {
  kind: 'open';
  hostPort: number;
  close(): void;
  /** Calls `listener` once, when the listener fails by itself. */
  onClosed(listener: () => void): void;
}

/** The dialer of the container, told when a connection it opened ends and the relay is armed. */
function watchedDialer(
  dialer: Dialer,
  armed: () => boolean,
  onConnectionClosed: () => void,
): Dialer {
  return {
    dial: async target => {
      // A connection dialed while the relay was still being proven is a probe, whenever it ends.
      const counts = armed();
      const connection = await dialer.dial(target);
      connection.onClose(() => {
        if (counts) {
          onConnectionClosed();
        }
      });
      return connection;
    },
  };
}

/** Opens the listener and the relay, or says why not. */
export async function openHostRelay(
  dependencies: RelayDependencies,
  request: RelayRequest,
): Promise<OpenRelay | {kind: 'failed'; failure: Failed}> {
  const {logger} = dependencies;
  const same = await findFreePort(dependencies.prober, {
    first: request.containerPort,
    last: request.containerPort,
  });
  const chosen =
    'port' in same ? same : await findFreePort(dependencies.prober, undefined);
  if (!('port' in chosen)) {
    logger.info('no free port on the host for the relay');
    return {kind: 'failed', failure: relayFailed()};
  }
  const hostPort = chosen.port;
  let armed = false;
  const outcome = await openRelayTunnel({
    dialer: watchedDialer(
      execDialer(
        request.engine,
        request.containerId,
        request.remoteUser,
        request.nodePath,
        request.relayPath,
      ),
      () => armed,
      request.onConnectionClosed,
    ),
    local: dependencies.local,
    scheduler: dependencies.scheduler,
    target: {kind: 'port', port: request.containerPort},
    localPort: hostPort,
    limits: TUNNEL_WAIT_LIMITS,
  });
  if (outcome.kind !== 'open') {
    logger.info(`the relay did not open: ${outcome.kind}`);
    return {kind: 'failed', failure: relayFailed()};
  }
  armed = true;
  logger.info(
    `forwarding local port ${String(hostPort)} to container port ${String(request.containerPort)}`,
  );
  return {
    kind: 'open',
    hostPort,
    close: () => {
      outcome.close();
    },
    onClosed: listener => {
      outcome.onClosed(() => {
        listener();
      });
    },
  };
}
