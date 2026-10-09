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

/**
 * Joins a client of the window's port to a connection to the host, which is still being opened. The bytes the client
 * sends before the host side exists are held and sent first, in order. Each side ends the other, and a client that
 * leaves before the host side opens closes it as soon as it does.
 */
function bridge(
  client: Duplex,
  opening: Promise<Duplex>,
  track: (connection: Duplex) => void,
): void {
  const held: Uint8Array[] = [];
  let host: Duplex | undefined;
  let clientGone = false;
  client.onData(chunk => {
    if (host === undefined) {
      held.push(chunk);
    } else if (!host.send(chunk)) {
      client.pause();
    }
  });
  client.onClose(() => {
    clientGone = true;
    host?.close();
  });
  opening.then(
    opened => {
      if (clientGone) {
        opened.close();
        return;
      }
      track(opened);
      host = opened;
      for (const chunk of held.splice(0)) {
        if (!opened.send(chunk)) {
          client.pause();
        }
      }
      opened.onDrain(() => {
        client.resume();
      });
      client.onDrain(() => {
        opened.resume();
      });
      opened.onData(chunk => {
        if (!client.send(chunk)) {
          opened.pause();
        }
      });
      opened.onClose(() => {
        client.close();
      });
    },
    () => {
      client.close();
    },
  );
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
      bridge(accepted, dialer.dial(target), track);
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
