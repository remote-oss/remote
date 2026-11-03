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
import {RelayClosedBeforeReply, RelayUnreachable} from './socks.ts';
import {succeedsWithin, type WaitLimits} from './wait.ts';

/**
 * How many probes in a row the relay closes before replying for the host to be taken as refusing the forward: at the
 * probe pause of a tenth of a second, about two seconds.
 */
const REFUSAL_PROBES = 20;

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
  /** Twenty probes in a row were closed by the relay with no reply, or found nothing at its port: the forward the relay needs is refused or missing. */
  | {kind: 'relayRefused'; cause: 'closedBeforeReply' | 'unreachable'}
  /** The port accepted a connection and closed it at once: the host refuses the forward the session set up. */
  | {kind: 'forwardRefused'}
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
  /** Told each line the relay logs: a dial that failed, and the tunnel's end. */
  onLine?: (line: string) => void;
  /** Told once, when the first probe through the dialer did not work and the tunnel goes on waiting. */
  onWaiting?: () => void;
  /**
   * Asked once, when twenty probes in a row were closed by the relay or found no relay, with the cause: true ends the
   * wait as a refused forward; false goes on probing until the bound, as for any other failure. A request with no such function never ends it.
   */
  confirmRefusal?: (
    cause: 'closedBeforeReply' | 'unreachable',
  ) => Promise<boolean>;
}

/** What a line names of a target: its port, or that it is a socket. */
function targetText(target: TunnelTarget): string {
  return target.kind === 'port' ? `port ${String(target.port)}` : 'socket';
}

/** The reason a dial failed, as its error gives it. */
function reasonOf(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
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
  tell: (line: string) => void,
  targetName: string,
): void {
  const held: Uint8Array[] = [];
  let host: Duplex | undefined;
  let heldBytes = 0;
  let overflowed = false;
  let clientGone = false;
  let toHost = 0;
  let toClient = 0;
  let ended = false;
  function endedBy(side: string): void {
    if (!ended) {
      ended = true;
      tell(
        `a window connection ended: the ${side} closed it, after ${String(toHost)} bytes to the host and ${String(toClient)} bytes to the client`,
      );
    }
  }
  function sendToHost(opened: Duplex, chunk: Uint8Array): void {
    toHost += chunk.byteLength;
    if (!opened.send(chunk)) {
      client.pause();
    }
  }
  client.onData(chunk => {
    if (host === undefined) {
      if (overflowed) {
        return;
      }
      if (!(heldBytes + chunk.byteLength <= heldBytesMaximum)) {
        overflowed = true;
        ended = true;
        held.length = 0;
        tell(
          'a window connection was closed: it sent more than the relay holds before the host side opened',
        );
        client.close();
        return;
      }
      heldBytes += chunk.byteLength;
      held.push(chunk);
    } else {
      sendToHost(host, chunk);
    }
  });
  client.onClose(() => {
    clientGone = true;
    if (host === undefined) {
      if (!ended) {
        ended = true;
        tell('a window connection ended before the host side opened');
      }
    } else {
      endedBy('client');
    }
    host?.close();
  });
  opening.then(
    opened => {
      if (clientGone) {
        opened.close();
        return;
      }
      tell(
        `a connection to the window port was opened to the host's ${targetName}`,
      );
      track(opened);
      host = opened;
      for (const chunk of held.splice(0)) {
        sendToHost(opened, chunk);
      }
      opened.onDrain(() => {
        client.resume();
      });
      client.onDrain(() => {
        opened.resume();
      });
      opened.onData(chunk => {
        toClient += chunk.byteLength;
        if (!client.send(chunk)) {
          opened.pause();
        }
      });
      opened.onClose(() => {
        endedBy('host');
        client.close();
      });
    },
    (caught: unknown) => {
      ended = true;
      tell(
        `a connection to the window port could not be opened to the host's ${targetName}: ${reasonOf(caught)}`,
      );
      client.close();
    },
  );
}

/**
 * Opens the tunnel. The result is `tunnelNotReady` when no probe through the dialer worked within the bound, even if
 * the dialer never answered; the port is closed again then. It is `relayRefused` as soon as twenty probes in a row were
 * closed by the relay before its reply or found no relay to connect to.
 */
export async function openRelayTunnel(
  request: RelayTunnelRequest,
): Promise<WindowTunnelOutcome> {
  const {dialer, target} = request;
  const tell = request.onLine ?? (() => undefined);
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
          tell,
          targetText(target),
        );
      },
      detail => {
        ended = {detail};
        tell(
          `the window port ${String(request.localPort)} stopped listening by itself: ${detail}`,
        );
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
  /** Closes the port and its connections, once, and says nothing of why. */
  function shut(): boolean {
    if (closeRan) {
      return false;
    }
    closeRan = true;
    listening.close();
    closeConnections();
    return true;
  }
  function close(): void {
    if (shut()) {
      tell(
        `the window port ${String(request.localPort)} was closed by its owner`,
      );
    }
  }
  let waitingTold = false;
  let lastProbeFailure = '';
  const failures = {
    closedInARow: 0,
    asked: false,
    confirmed: false,
    cause: 'closedBeforeReply' as 'closedBeforeReply' | 'unreachable',
  };
  const refusal = new AbortController();
  const ready = await succeedsWithin(
    async () => {
      try {
        (await dialer.dial(target)).close();
      } catch (caught) {
        const reason = reasonOf(caught);
        if (reason !== lastProbeFailure) {
          lastProbeFailure = reason;
          tell(`a probe to the host's ${targetText(target)} failed: ${reason}`);
        }
        if (
          caught instanceof RelayClosedBeforeReply ||
          caught instanceof RelayUnreachable
        ) {
          failures.closedInARow += 1;
          failures.cause =
            caught instanceof RelayUnreachable
              ? 'unreachable'
              : 'closedBeforeReply';
          if (failures.closedInARow >= REFUSAL_PROBES && !failures.asked) {
            failures.asked = true;
            if ((await request.confirmRefusal?.(failures.cause)) === true) {
              failures.confirmed = true;
              refusal.abort();
            }
          }
        } else {
          failures.closedInARow = 0;
        }
        if (!waitingTold) {
          waitingTold = true;
          request.onWaiting?.();
        }
        throw caught;
      }
    },
    request.limits,
    request.scheduler,
    refusal.signal,
  );
  if (ended !== undefined) {
    return {kind: 'listenFailed', detail: ended.detail};
  }
  if (!ready) {
    shut();
    tell(
      failures.confirmed
        ? `the window port ${String(request.localPort)} was closed: the host refuses the forward`
        : `the window port ${String(request.localPort)} was closed: no probe worked before the bound`,
    );
    return failures.confirmed
      ? {kind: 'relayRefused', cause: failures.cause}
      : {kind: 'tunnelNotReady'};
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
