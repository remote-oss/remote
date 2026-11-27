/**
 * @fileoverview The relay's two WebSocket legs (the relay brief's section 5). The host leg is an SSH session whose
 * server the relay is, with key exchange, host key and cipher all `none` (`[dev-tunnels] rs/src/connections/
 * relay_tunnel_host.rs:367-383,951-956`). Each client leg is piped, unread, through a `client-ssh-session-stream`
 * channel the relay opens on its tunnel's host session (`:82-106,958-969`). A leg that sends nothing for a minute is
 * pinged, and ended when no pong comes within ten seconds (`ws.rs:147-187`). Each direction of a client's pipe waits
 * for the side it writes to: the host's window opens again only once the client's socket has taken the bytes, and the
 * client's socket is not read while its bytes wait for the host's window.
 */

import type {IncomingMessage} from 'node:http';
import type {Duplex} from 'node:stream';
import devTunnelsSsh from '@microsoft/dev-tunnels-ssh';
import {WebSocketServer, type WebSocket} from 'ws';
import {NO_LONGER_ADMITTED} from '../auth/authenticate.ts';
import {problem, type Answer} from '../problem.ts';
import type {Authenticate, TunnelLegs} from '../routes.ts';
import {sendCopies} from './copies.ts';

const {
  SshServerSession,
  SshSessionConfiguration,
  WebSocketStream,
  SshDisconnectReason,
  CancellationTokenSource,
} = devTunnelsSsh;

type HostSession = InstanceType<typeof SshServerSession>;

const HOST_PROTOCOL = 'tunnel-relay-host';
const CLIENT_PROTOCOL = 'tunnel-relay-client';
const CLIENT_CHANNEL = 'client-ssh-session-stream';

/** How long a leg may send nothing before the relay pings it, in milliseconds. */
const PING_AFTER = 60 * 1000;

/** How long the relay waits for the pong, in milliseconds. */
const PONG_WITHIN = 10 * 1000;

/** The largest message a leg takes, in bytes: twice the largest SSH packet the SSH library reads, 1 MiB. */
export const LARGEST_MESSAGE = 2 * 1024 * 1024;

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
  private readonly report: (failure: unknown) => void;
  private readonly clientLimit: number;
  private readonly timers: Timers;
  private readonly hosts = new Map<
    string,
    {session: HostSession; owner: number}
  >();
  private readonly clients = new Map<string, number>();
  private readonly sockets = {
    host: socketsSpeaking(HOST_PROTOCOL),
    client: socketsSpeaking(CLIENT_PROTOCOL),
  };

  /** Legs authorized by `authenticate`, at most `clientLimit` clients per tunnel, kept alive on `timers`; a sign-in that fails goes to `report`. */
  constructor(
    authenticate: Authenticate,
    report: (failure: unknown) => void,
    clientLimit: number,
    timers = NODE_TIMERS,
  ) {
    this.authenticate = authenticate;
    this.report = report;
    this.clientLimit = clientLimit;
    this.timers = timers;
  }

  /** Takes an HTTP upgrade of the relay's server: a leg when it is one and authorized, a refusal otherwise. */
  async upgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    socket.on('error', () => {
      socket.destroy();
    });
    const parts = pathParts(request.url);
    if (parts === undefined) {
      refuse(socket, problem(400, "The leg's address is not valid."));
      return;
    }
    const [, relay, side, tunnelId, ...rest] = parts;
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
      caller = await this.authenticate(
        {authorization: request.headers.authorization},
        request.socket.remoteAddress ?? '',
      );
    } catch (error) {
      this.report(error);
      refuse(socket, problem(500, 'The relay failed.'));
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
        this.watch(websocket);
        void this.hostLeg(websocket, tunnelId, caller.owner);
      });
      return;
    }
    const host = this.hosts.get(tunnelId);
    if (host === undefined) {
      refuse(socket, problem(503, 'No host is connected to the tunnel.'));
      return;
    }
    if (this.clientCount(tunnelId) >= this.clientLimit) {
      refuse(
        socket,
        problem(
          403,
          `The tunnel already has ${String(this.clientLimit)} connected clients.`,
        ),
      );
      return;
    }
    this.sockets.client.handleUpgrade(request, socket, head, websocket => {
      this.clients.set(tunnelId, this.clientCount(tunnelId) + 1);
      websocket.on('close', () => {
        this.clients.set(tunnelId, this.clientCount(tunnelId) - 1);
      });
      this.watch(websocket);
      void clientLeg(websocket, host.session);
    });
  }

  /** How many clients tunnel `tunnelId` has connected. */
  clientCount(tunnelId: string): number {
    return this.clients.get(tunnelId) ?? 0;
  }

  /** Closes the legs of tunnel `tunnelId`, as its deletion does: its host's session, and so its clients' channels. */
  closeTunnel(tunnelId: string): void {
    void this.hosts
      .get(tunnelId)
      ?.session.close(
        SshDisconnectReason.byApplication,
        'The tunnel was deleted.',
      );
  }

  /** Closes the legs of every tunnel whose owner `admits` no longer takes: its host's session, and so its clients. */
  closeUnadmitted(admits: (owner: number) => boolean): void {
    for (const {session, owner} of this.hosts.values()) {
      if (!admits(owner)) {
        void session.close(
          SshDisconnectReason.byApplication,
          NO_LONGER_ADMITTED,
        );
      }
    }
  }

  /** Serves the host leg of tunnel `tunnelId`, owned by `owner`; a later host leg replaces this one, which is closed. */
  private async hostLeg(
    websocket: WebSocket,
    tunnelId: string,
    owner: number,
  ): Promise<void> {
    websocket.binaryType = 'arraybuffer';
    sendCopies(websocket);
    const session = new SshServerSession(new SshSessionConfiguration(false));
    session.onClosed(() => {
      if (this.hosts.get(tunnelId)?.session === session) {
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
    this.hosts.set(tunnelId, {session, owner});
    void earlier?.session.close(
      SshDisconnectReason.byApplication,
      'Another host connected to the tunnel.',
    );
  }

  /**
   * Reports an error of `websocket`, which `ws` ends; pings it once it has sent nothing for a minute, and ends it when
   * no pong follows within ten seconds.
   */
  private watch(websocket: WebSocket): void {
    websocket.on('error', this.report);
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
  return new WebSocketServer({
    noServer: true,
    maxPayload: LARGEST_MESSAGE,
    handleProtocols: () => protocol,
  });
}

/** The parts of the path of upgrade target `target`, or none when it is not a URL. */
function pathParts(target: string | undefined): string[] | undefined {
  try {
    return new URL(target ?? '/', 'https://relay.invalid').pathname.split('/');
  } catch {
    return undefined;
  }
}

/** Pipes a client leg through a new channel of `host`, holding what the client sends before the channel is open. */
async function clientLeg(
  websocket: WebSocket,
  host: HostSession,
): Promise<void> {
  const opening = host.openChannel(CLIENT_CHANNEL);
  const ending = new CancellationTokenSource();
  let sending: Promise<unknown> = opening;
  let waiting = 0;
  websocket.on('message', (data: Buffer) => {
    const copy = Buffer.from(data);
    waiting += 1;
    websocket.pause();
    sending = sending
      .then(async () => (await opening).send(copy, ending.token))
      .catch(() => undefined)
      .finally(() => {
        waiting -= 1;
        if (waiting === 0) {
          websocket.resume();
        }
      });
  });
  let channel: Awaited<typeof opening>;
  try {
    channel = await opening;
  } catch {
    websocket.close(1011, 'The host refused the client.');
    return;
  }
  channel.onDataReceived(data => {
    websocket.send(Buffer.from(data), () => {
      channel.adjustWindow(data.length);
    });
  });
  channel.onClosed(() => {
    if (waiting > 0) {
      // A paused socket would never read the client's answer to a close, and its bytes have nowhere to go.
      websocket.terminate();
      return;
    }
    websocket.close();
  });
  websocket.on('close', () => {
    ending.cancel();
    void channel.close().catch(() => undefined);
  });
}

/** Refuses an upgrade with `answer` as an HTTP answer, and ends the socket. */
function refuse(socket: Duplex, answer: Answer): void {
  const body = JSON.stringify(answer.body);
  const headers = Object.entries(answer.headers ?? {})
    .map(([name, value]) => `${name}: ${value}\r\n`)
    .join('');
  socket.end(
    `HTTP/1.1 ${String(answer.status)} Refused\r\nConnection: close\r\n${headers}Content-Type: application/json\r\nContent-Length: ${String(Buffer.byteLength(body))}\r\n\r\n${body}`,
  );
}
