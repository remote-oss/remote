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
  | {
      kind: 'open';
      address: WindowAddress;
      close: () => void;
      /** Registers a listener for the tunnel ending without being asked to, with the reason. */
      onClosed: (listener: (detail: string) => void) => void;
    }
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
  /** Told once, when the first probe through the dialer did not work and the tunnel goes on waiting. */
  onWaiting?: () => void;
}

/**
 * Joins a client of the window's port to a connection to the host, which is still being opened. The bytes the client
 * sends before the host side exists are held and sent first, in order. The held bytes count toward
 * `heldBytesMaximum`: a chunk that would take the total past it is not held, the client is closed at once, and
 * nothing more the client sends is held or sent; the host side, when its dial completes, is closed without sending
 * anything. Each side ends the other, and a client that leaves before the host side opens closes it as soon as it
 * does.
 */
function bridge(
  client: Duplex,
  opening: Promise<Duplex>,
  track: (connection: Duplex) => void,
  heldBytesMaximum: number,
): void {
  const held: Uint8Array[] = [];
  let host: Duplex | undefined;
  let heldBytes = 0;
  let overflowed = false;
  let clientGone = false;
  client.onData(chunk => {
    if (host === undefined) {
      if (overflowed) {
        return;
      }
      if (!(heldBytes + chunk.byteLength <= heldBytesMaximum)) {
        overflowed = true;
        held.length = 0;
        client.close();
        return;
      }
      heldBytes += chunk.byteLength;
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
  const closedListeners: Array<(detail: string) => void> = [];
  let ended: {detail: string} | undefined;
  function closeConnections(): void {
    for (const connection of [...active]) {
      connection.close();
    }
  }
  let listening: Listening;
  try {
    listening = await request.local.listen(
      request.localPort,
      accepted => {
        track(accepted);
        bridge(
          accepted,
          dialer.dial(target),
          track,
          request.limits.heldBytesMaximum,
        );
      },
      detail => {
        ended = {detail};
        closeConnections();
        for (const listener of closedListeners.splice(0)) {
          listener(detail);
        }
      },
    );
  } catch (caught) {
    return {
      kind: 'listenFailed',
      detail: caught instanceof Error ? caught.message : String(caught),
    };
  }
  let closeRan = false;
  function close(): void {
    if (closeRan) {
      return;
    }
    closeRan = true;
    listening.close();
    closeConnections();
  }
  let waitingTold = false;
  const ready = await succeedsWithin(
    async () => {
      try {
        (await dialer.dial(target)).close();
      } catch (caught) {
        if (!waitingTold) {
          waitingTold = true;
          request.onWaiting?.();
        }
        throw caught;
      }
    },
    request.limits,
    request.scheduler,
  );
  if (ended !== undefined) {
    return {kind: 'listenFailed', detail: ended.detail};
  }
  if (!ready) {
    close();
    return {kind: 'tunnelNotReady'};
  }
  return {
    kind: 'open',
    address: {host: '127.0.0.1', port: request.localPort},
    close,
    onClosed: listener => {
      if (ended === undefined) {
        closedListeners.push(listener);
      } else {
        listener(ended.detail);
      }
    },
  };
}
