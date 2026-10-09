/**
 * @fileoverview The window tunnel through the shared connection's relay: this library listens on the window's port
 * on 127.0.0.1 and, for each connection, opens one to the target on the host through the dialer and passes the bytes
 * both ways. The tunnel is open once a probe connection through the dialer has worked.
 */

import type {Scheduler} from 'lib-helper';
import type {
  Dialer,
  Duplex,
  Listening,
  LocalPort,
  TunnelTarget,
} from './ports.ts';
import {succeedsWithin, type WaitLimits} from './wait.ts';

/** The address the window connects to. */
export interface WindowAddress {
  host: '127.0.0.1';
  port: number;
}

/** How a tunnel ended up: open, or why not. */
export type WindowTunnelOutcome =
  | {kind: 'open'; address: WindowAddress; close: () => void}
  | {kind: 'tunnelNotReady'}
  | {kind: 'listenFailed'; detail: string};

/** Everything a relay tunnel is made from. */
export interface RelayTunnelRequest {
  dialer: Dialer;
  local: LocalPort;
  scheduler: Scheduler;
  target: TunnelTarget;
  /** The port on this machine's loopback the window connects to. */
  localPort: number;
  limits: WaitLimits;
}

/** Passes the bytes of two connections to each other, and ends each when the other ends. */
export function pipeConnections(first: Duplex, second: Duplex): void {
  first.onData(chunk => {
    second.send(chunk);
  });
  second.onData(chunk => {
    first.send(chunk);
  });
  first.onClose(() => {
    second.close();
  });
  second.onClose(() => {
    first.close();
  });
}

/**
 * Opens the tunnel. The result is `tunnelNotReady` when no probe through the dialer worked within the bound, even if
 * the dialer never answered; the port is closed again then.
 */
export async function openRelayTunnel(
  request: RelayTunnelRequest,
): Promise<WindowTunnelOutcome> {
  const {dialer, target} = request;
  const active = new Set<Duplex>();
  function track(connection: Duplex): void {
    active.add(connection);
    connection.onClose(() => {
      active.delete(connection);
    });
  }
  let listening: Listening;
  try {
    listening = await request.local.listen(request.localPort, accepted => {
      track(accepted);
      dialer.dial(target).then(
        remote => {
          track(remote);
          pipeConnections(accepted, remote);
        },
        () => {
          accepted.close();
        },
      );
    });
  } catch (caught) {
    return {
      kind: 'listenFailed',
      detail: caught instanceof Error ? caught.message : String(caught),
    };
  }
  function close(): void {
    listening.close();
    for (const connection of [...active]) {
      connection.close();
    }
  }
  const ready = await succeedsWithin(
    async () => {
      (await dialer.dial(target)).close();
    },
    request.limits,
    request.scheduler,
  );
  if (!ready) {
    close();
    return {kind: 'tunnelNotReady'};
  }
  return {
    kind: 'open',
    address: {host: '127.0.0.1', port: request.localPort},
    close,
  };
}
