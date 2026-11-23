/**
 * @fileoverview The relay's two WebSocket legs (the relay brief's section 5). The host leg is an SSH session whose
 * server the relay is, with key exchange, host key and cipher all `none` (`[dev-tunnels] rs/src/connections/
 * relay_tunnel_host.rs:367-383,951-956`). Each client leg is piped, unread, through a `client-ssh-session-stream`
 * channel the relay opens on its tunnel's host session (`:82-106,958-969`). A leg that sends nothing for a minute is
 * pinged, and closed when no pong comes within ten seconds (`ws.rs:147-187`), so a silent leg never reaches the
 * brief's two idle minutes.
 */

import type {IncomingMessage} from 'node:http';
import type {Duplex} from 'node:stream';
import devTunnelsSsh from '@microsoft/dev-tunnels-ssh';
import {WebSocketServer, type WebSocket} from 'ws';
import {problem, type Answer} from '../problem.ts';
import type {Authenticate, TunnelLegs} from '../routes.ts';
import {sendCopies} from './copies.ts';

const {
  SshServerSession,
  SshSessionConfiguration,
  WebSocketStream,
  SshDisconnectReason,
} = devTunnelsSsh;

type HostSession = InstanceType<typeof SshServerSession>;

const HOST_PROTOCOL = 'tunnel-relay-host';
const CLIENT_PROTOCOL = 'tunnel-relay-client';
const CLIENT_CHANNEL = 'client-ssh-session-stream';

/** How long a leg may send nothing before the relay pings it, in milliseconds. */
const PING_AFTER = 60 * 1000;

/** How long the relay waits for the pong, in milliseconds. */
const PONG_WITHIN = 10 * 1000;

/** The timers the keep-alive runs on. */
export interface Timers {
  /** Runs `work` after `delay` milliseconds, and returns a handle that stops it. */
  start(work: () => void, delay: number): unknown;
  /** Stops the timer `handle`. */
  stop(handle: unknown): void;
}

const NODE_TIMERS: Timers = {
  start(work, delay) {
    return setTimeout(work, delay);
  },
  stop(handle) {
    clearTimeout(handle as NodeJS.Timeout);
  },
};

/** The legs of the relay: the host session of each tunnel, and the clients piped through it. */
export class Legs implements TunnelLegs {
  private readonly authenticate: Authenticate;
  private readonly timers: Timers;
  private readonly hosts = new Map<string, HostSession>();
  private readonly sockets = {
    host: socketsSpeaking(HOST_PROTOCOL),
    client: socketsSpeaking(CLIENT_PROTOCOL),
  };

  /** Legs authorized by `authenticate`, kept alive on `timers`. */
  constructor(authenticate: Authenticate, timers = NODE_TIMERS) {
    this.authenticate = authenticate;
    this.timers = timers;
  }

  /** Takes an HTTP upgrade of the relay's server: a leg when it is one and authorized, a refusal otherwise. */
  async upgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    const [, relay, side, tunnelId, ...rest] = new URL(
      request.url ?? '/',
      'https://relay.invalid',
    ).pathname.split('/');
    if (
      relay !== 'relay' ||
      (side !== 'host' && side !== 'client') ||
      tunnelId === undefined ||
      rest.length > 0
    ) {
      refuse(socket, problem(404, 'There is no such leg.'));
      return;
    }
    const wanted = side === 'host' ? HOST_PROTOCOL : CLIENT_PROTOCOL;
    const offered = (request.headers['sec-websocket-protocol'] ?? '')
      .split(',')
      .map(each => each.trim());
    if (!offered.includes(wanted)) {
      refuse(socket, problem(400, `The leg needs the subprotocol ${wanted}.`));
      return;
    }
    let caller: Awaited<ReturnType<Authenticate>>;
    try {
      caller = await this.authenticate({
        authorization: request.headers.authorization,
      });
    } catch (error) {
      refuse(socket, problem(500, `The relay failed: ${String(error)}`));
      return;
    }
    if ('status' in caller) {
      refuse(socket, caller);
      return;
    }
    const scope = side === 'host' ? 'host' : 'connect';
    if (
      caller.kind !== 'tunnel' ||
      caller.tunnelId !== tunnelId ||
      caller.scope !== scope
    ) {
      refuse(
        socket,
        problem(403, `The leg needs a ${scope} token for its tunnel.`),
      );
      return;
    }
    if (side === 'host') {
      this.sockets.host.handleUpgrade(request, socket, head, websocket => {
        this.keepAlive(websocket);
        void this.hostLeg(websocket, tunnelId);
      });
      return;
    }
    const host = this.hosts.get(tunnelId);
    if (host === undefined) {
      refuse(socket, problem(503, 'No host is connected to the tunnel.'));
      return;
    }
    this.sockets.client.handleUpgrade(request, socket, head, websocket => {
      this.keepAlive(websocket);
      void clientLeg(websocket, host);
    });
  }

  /** Closes the legs of tunnel `tunnelId`, as its deletion does: its host's session, and so its clients' channels. */
  closeTunnel(tunnelId: string): void {
    void this.hosts
      .get(tunnelId)
      ?.close(SshDisconnectReason.byApplication, 'The tunnel was deleted.');
  }

  /** Serves the host leg of tunnel `tunnelId`; a later host leg replaces this one, which is closed. */
  private async hostLeg(websocket: WebSocket, tunnelId: string): Promise<void> {
    websocket.binaryType = 'arraybuffer';
    sendCopies(websocket);
    const session = new SshServerSession(new SshSessionConfiguration(false));
    session.onClosed(() => {
      if (this.hosts.get(tunnelId) === session) {
        this.hosts.delete(tunnelId);
      }
      websocket.close();
    });
    try {
      await session.connect(new WebSocketStream(websocket as never));
    } catch {
      websocket.close();
      return;
    }
    const earlier = this.hosts.get(tunnelId);
    this.hosts.set(tunnelId, session);
    void earlier?.close(
      SshDisconnectReason.byApplication,
      'Another host connected to the tunnel.',
    );
  }

  /** Pings `websocket` once it has sent nothing for a minute, and ends it when no pong follows within ten seconds. */
  private keepAlive(websocket: WebSocket): void {
    const timers = this.timers;
    let pinged = false;
    let handle = timers.start(lapse, PING_AFTER);
    function lapse(): void {
      if (pinged) {
        websocket.terminate();
        return;
      }
      pinged = true;
      websocket.ping();
      handle = timers.start(lapse, PONG_WITHIN);
    }
    function heard(): void {
      pinged = false;
      timers.stop(handle);
      handle = timers.start(lapse, PING_AFTER);
    }
    websocket.on('message', heard);
    websocket.on('ping', heard);
    websocket.on('pong', heard);
    websocket.on('close', () => {
      timers.stop(handle);
    });
  }
}

/** The upgrades of one side of the relay, which answer with its subprotocol. */
function socketsSpeaking(protocol: string): WebSocketServer {
  return new WebSocketServer({noServer: true, handleProtocols: () => protocol});
}

/** Pipes a client leg through a new channel of `host`, holding what the client sends before the channel is open. */
async function clientLeg(
  websocket: WebSocket,
  host: HostSession,
): Promise<void> {
  const opening = host.openChannel(CLIENT_CHANNEL);
  let sending: Promise<unknown> = opening;
  websocket.on('message', (data: Buffer) => {
    const copy = Buffer.from(data);
    sending = sending
      .then(async () => (await opening).send(copy))
      .catch(() => undefined);
  });
  let channel: Awaited<typeof opening>;
  try {
    channel = await opening;
  } catch {
    websocket.close(1011, 'The host refused the client.');
    return;
  }
  channel.onDataReceived(data => {
    websocket.send(Buffer.from(data));
    channel.adjustWindow(data.length);
  });
  channel.onClosed(() => {
    websocket.close();
  });
  websocket.on('close', () => {
    void channel.close().catch(() => undefined);
  });
}

/** Refuses an upgrade with `answer` as an HTTP answer, and ends the socket. */
function refuse(socket: Duplex, answer: Answer): void {
  const body = JSON.stringify(answer.body);
  socket.end(
    `HTTP/1.1 ${String(answer.status)} Refused\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: ${String(Buffer.byteLength(body))}\r\n\r\n${body}`,
  );
}
