/**
 * @fileoverview The dialer of the shared connection's SOCKS relay: it opens a connection to the relay's loopback
 * port, speaks SOCKS5 with no authentication to ask for the target on the host's IPv4 loopback, and hands back the
 * connection once the relay says it is open. Every wait for the relay is bounded.
 */

import type {Scheduler} from 'lib-helper';
import type {Dialer, Duplex, LocalPort, TunnelTarget} from './ports.ts';

/** What the dialer is made from. */
export interface SocksDialerInit {
  local: LocalPort;
  /** The loopback port of the relay. */
  socksPort: number;
  scheduler: Scheduler;
  /** The most the relay may take to open a connection, from the greeting to the reply, in milliseconds. */
  handshakeMilliseconds: number;
}

const VERSION = 5;
const NO_AUTHENTICATION = 0;
const CONNECT = 1;
const ADDRESS_IPV4 = 1;
const ADDRESS_NAME = 3;
const ADDRESS_IPV6 = 4;
const REPLY_SUCCEEDED = 0;
const HOST_LOOPBACK = [127, 0, 0, 1];
const PORT_BYTES = 2;
const IPV4_BYTES = 4;
const IPV6_BYTES = 16;
const REPLY_HEAD_BYTES = 4;
const BYTE_RANGE = 256;
const PORT_MAXIMUM = 65535;

function concatenated(first: Uint8Array, second: Uint8Array): Uint8Array {
  const joined = new Uint8Array(first.length + second.length);
  joined.set(first);
  joined.set(second, first.length);
  return joined;
}

/** The request to connect to a port on the host's IPv4 loopback. */
function connectRequest(port: number): Uint8Array {
  return Uint8Array.of(
    VERSION,
    CONNECT,
    0,
    ADDRESS_IPV4,
    ...HOST_LOOPBACK,
    Math.floor(port / BYTE_RANGE),
    port % BYTE_RANGE,
  );
}

/** How many bytes the reply is in all, or undefined while its head does not say yet, or null for an address kind. */
function replyLength(reply: Uint8Array): number | undefined | null {
  if (reply.length < REPLY_HEAD_BYTES) {
    return undefined;
  }
  switch (reply[3]) {
    case ADDRESS_IPV4:
      return REPLY_HEAD_BYTES + IPV4_BYTES + PORT_BYTES;
    case ADDRESS_IPV6:
      return REPLY_HEAD_BYTES + IPV6_BYTES + PORT_BYTES;
    case ADDRESS_NAME:
      return reply.length < REPLY_HEAD_BYTES + 1
        ? undefined
        : REPLY_HEAD_BYTES + 1 + (reply[4] ?? 0) + PORT_BYTES;
    default:
      return null;
  }
}

/** Asks the relay on `relay` for a connection to `port` and gives the connection once it is open. */
function openThroughRelay(
  relay: Duplex,
  port: number,
  init: SocksDialerInit,
): Promise<Duplex> {
  return new Promise<Duplex>((resolve, reject) => {
    let stage: 'greeting' | 'reply' | 'open' = 'greeting';
    let received: Uint8Array = new Uint8Array(0);
    const dataListeners: Array<(chunk: Uint8Array) => void> = [];
    const closeListeners: Array<() => void> = [];
    const held: Uint8Array[] = [];
    let relayClosed = false;
    const cancelTimer = init.scheduler.setTimer(
      init.handshakeMilliseconds,
      () => {
        fail('the relay did not answer in time');
      },
    );
    function fail(reason: string): void {
      stage = 'open';
      cancelTimer();
      relay.close();
      reject(new Error(reason));
    }
    function deliver(chunk: Uint8Array): void {
      if (dataListeners.length === 0) {
        held.push(chunk);
      } else {
        for (const listener of dataListeners) {
          listener(chunk);
        }
      }
    }
    const stream: Duplex = {
      send: chunk => relay.send(chunk),
      onDrain: listener => {
        relay.onDrain(listener);
      },
      pause: () => {
        relay.pause();
      },
      resume: () => {
        relay.resume();
      },
      onData: listener => {
        dataListeners.push(listener);
        for (const chunk of held.splice(0)) {
          listener(chunk);
        }
      },
      onClose: listener => {
        if (relayClosed) {
          queueMicrotask(listener);
        } else {
          closeListeners.push(listener);
        }
      },
      close: () => {
        relay.close();
      },
    };
    function advance(): void {
      if (stage === 'greeting' && received.length >= 2) {
        if (received[0] !== VERSION || received[1] !== NO_AUTHENTICATION) {
          fail('the relay refused to connect without authentication');
          return;
        }
        received = received.slice(2);
        stage = 'reply';
        relay.send(connectRequest(port));
      }
      if (stage !== 'reply') {
        return;
      }
      const length = replyLength(received);
      if (length === null) {
        fail('the relay answered with an address kind that is not known');
      } else if (length !== undefined && received.length >= length) {
        if (received[1] !== REPLY_SUCCEEDED) {
          fail(`the relay could not connect: reply ${String(received[1])}`);
          return;
        }
        const rest = received.slice(length);
        stage = 'open';
        cancelTimer();
        resolve(stream);
        if (rest.length > 0) {
          deliver(rest);
        }
      }
    }
    relay.onClose(() => {
      if (stage === 'open') {
        relayClosed = true;
        for (const listener of closeListeners) {
          listener();
        }
      } else {
        fail('the relay closed the connection');
      }
    });
    relay.onData(chunk => {
      if (stage === 'open') {
        deliver(chunk);
      } else {
        received = concatenated(received, chunk);
        advance();
      }
    });
    relay.send(Uint8Array.of(VERSION, 1, NO_AUTHENTICATION));
  });
}

/** The dialer of the SOCKS relay at `socksPort`; it reaches a port on the host, never a socket path. */
export function socksDialer(init: SocksDialerInit): Dialer {
  return {
    dial: async (target: TunnelTarget) => {
      if (target.kind !== 'port') {
        throw new Error('the SOCKS relay reaches a port, not a socket path');
      }
      if (
        !Number.isInteger(target.port) ||
        target.port < 1 ||
        target.port > PORT_MAXIMUM
      ) {
        throw new Error(`the port ${String(target.port)} is not 1 to 65535`);
      }
      return openThroughRelay(
        await init.local.connect(init.socksPort),
        target.port,
        init,
      );
    },
  };
}
