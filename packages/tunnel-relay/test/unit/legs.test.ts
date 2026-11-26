import {deepStrictEqual} from 'node:assert';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createServer, type IncomingMessage, type Server} from 'node:http';
import {connect, type AddressInfo, type Socket} from 'node:net';
import devTunnelsSsh from '@microsoft/dev-tunnels-ssh';
import {PassThrough} from 'node:stream';
import {WebSocket, type ClientOptions} from 'ws';
import {Allowlist} from '../../src/auth/allowlist.ts';
import {sendCopies} from '../../src/legs/copies.ts';
import {LARGEST_MESSAGE, Legs, type Timers} from '../../src/legs/legs.ts';
import type {Authenticate} from '../../src/routes.ts';

const {
  SshClientSession,
  SshSessionConfiguration,
  WebSocketStream,
  SshChannelOpenFailureReason,
  ChannelOpenConfirmationMessage,
} = devTunnelsSsh;

type HostSide = InstanceType<typeof SshClientSession>;
type Opening = Parameters<Parameters<HostSide['onChannelOpening']>[0]>[0];
type Channel = Opening['channel'];

const HOST = 'tunnel-relay-host';
const CLIENT = 'tunnel-relay-client';

/** The addresses the legs gave `authenticate`, in order. */
const addresses: string[] = [];

/**
 * Takes `tunnel <id> <scope> [<owner>]` as that tunnel's token, of owner 7 unless one is named, `github <login>` as an
 * account, `refused` as a refusal, `broken` as a failure to ask, and `limited` as an address that has asked too often.
 */
function authenticate(
  headers: Parameters<Authenticate>[0],
  address: string,
): ReturnType<Authenticate> {
  addresses.push(address);
  const [scheme = '', first = '', second = '', owner = '7'] = (
    headers.authorization ?? ''
  ).split(' ');
  if (scheme === 'broken') {
    return Promise.reject(new Error('down'));
  }
  if (scheme === 'limited') {
    return Promise.resolve({
      status: 429,
      body: {title: 'Too Many Requests', detail: 'Wait.'},
      headers: {'Retry-After': '30'},
    });
  }
  if (scheme === 'tunnel' && (second === 'host' || second === 'connect')) {
    return Promise.resolve({
      kind: 'tunnel',
      tunnelId: first,
      owner: Number(owner),
      scope: second,
    });
  }
  if (scheme === 'github') {
    return Promise.resolve({kind: 'account', id: 7, login: first});
  }
  return Promise.resolve({
    status: 401,
    body: {title: 'Unauthorized', detail: 'Sign in with a GitHub account.'},
  });
}
/** Timers that run only when a row fires them. */
class FakeTimers implements Timers {
  private readonly pending = new Map<
    number,
    {work: () => void; delay: number}
  >();
  private count = 0;

  /** Keeps `work` until fired. */
  start(work: () => void, delay: number): unknown {
    this.count += 1;
    this.pending.set(this.count, {work, delay});
    return this.count;
  }

  /** Drops the timer `handle`. */
  stop(handle: unknown): void {
    this.pending.delete(handle as number);
  }

  /** The delays of the timers still pending. */
  delays(): number[] {
    return [...this.pending.values()].map(timer => timer.delay);
  }

  /** Runs every pending timer. */
  fire(): void {
    const firing = [...this.pending.entries()];
    this.pending.clear();
    for (const [, timer] of firing) {
      timer.work();
    }
  }
}

/** Does nothing; the place of a callback a row doesn't need. */
function ignore(): void {
  // Nothing to do.
}

/** Waits until `condition` holds, checking every few milliseconds. */
async function until(condition: () => boolean): Promise<void> {
  while (!condition()) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

/** What an upgrade gave: an open socket, or the refusal's status and detail. */
type Opened =
  {websocket: WebSocket} | {status: number; detail: string; retryAfter: string};

describe("the relay's WebSocket legs", () => {
  let server: Server;
  let timers: FakeTimers;
  let legs: Legs;
  let address: string;
  const opened: WebSocket[] = [];
  const sessions: HostSide[] = [];
  const sockets: Socket[] = [];
  let reported: unknown[];

  /** Hears a failure the legs report. */
  function reportOf(failure: unknown): void {
    reported.push(failure);
  }

  beforeEach(async () => {
    reported = [];
    timers = new FakeTimers();
    legs = new Legs(authenticate, reportOf, 2, timers);
    server = createServer();
    server.on('upgrade', (request, socket, head: Buffer) => {
      void legs.upgrade(request, socket, head);
    });
    await new Promise<void>(resolve => {
      server.listen(0, '127.0.0.1', resolve);
    });
    address = `ws://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  afterEach(async () => {
    for (const session of sessions.splice(0)) {
      session.dispose();
    }
    for (const websocket of opened.splice(0)) {
      websocket.terminate();
    }
    for (const socket of sockets.splice(0)) {
      socket.destroy();
    }
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });

  /**
   * Upgrades `path` offering `protocols` with `authorization`. `onOpen` runs as the socket opens, before any message
   * that came with the upgrade's answer is read.
   */
  function open(
    path: string,
    protocols: string[],
    authorization: string,
    options: ClientOptions = {},
    onOpen: (websocket: WebSocket) => void = ignore,
  ): Promise<Opened> {
    return new Promise((resolve, reject) => {
      const websocket = new WebSocket(`${address}${path}`, protocols, {
        ...options,
        headers: {authorization},
      });
      opened.push(websocket);
      websocket.on('open', () => {
        onOpen(websocket);
        resolve({websocket});
      });
      websocket.on('unexpected-response', (request, response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
            detail: string;
          };
          resolve({
            status: response.statusCode ?? 0,
            detail: body.detail,
            retryAfter: response.headers['retry-after'] ?? '',
          });
        });
      });
      websocket.on('error', reject);
    });
  }

  /** The open socket of `path`, failing the row when the upgrade was refused. */
  async function opening(
    path: string,
    protocols: string[],
    authorization: string,
    options: ClientOptions = {},
    onOpen: (websocket: WebSocket) => void = ignore,
  ): Promise<WebSocket> {
    const result = await open(path, protocols, authorization, options, onOpen);
    if (!('websocket' in result)) {
      throw new Error(`refused: ${String(result.status)} ${result.detail}`);
    }
    return result.websocket;
  }

  /** The status and detail of a refused upgrade, or `open`. */
  async function refusal(
    path: string,
    protocols: string[],
    authorization: string,
  ): Promise<unknown> {
    const result = await open(path, protocols, authorization);
    return 'websocket' in result ? 'open' : [result.status, result.detail];
  }

  /**
   * A host of tunnel `tunnelId` on its leg, as the TypeScript SDK's V1 host connects: an SSH client session with no
   * security. Each channel the relay opens goes to `onOpening`, which echoes it unless a row says otherwise.
   */
  async function host(
    tunnelId: string,
    onOpening: (event: Opening) => void = event => {
      echo(event.channel);
    },
    owner = 7,
  ): Promise<HostSide> {
    const session = new SshClientSession(new SshSessionConfiguration(false));
    sessions.push(session);
    session.onChannelOpening(onOpening);
    let stream: InstanceType<typeof WebSocketStream> | undefined;
    await opening(
      `/relay/host/${tunnelId}`,
      [HOST],
      `tunnel ${tunnelId} host ${String(owner)}`,
      {},
      websocket => {
        websocket.binaryType = 'arraybuffer';
        sendCopies(websocket);
        stream = new WebSocketStream(websocket as never);
      },
    );
    await session.connect(stream as never);
    await until(() => hostCount(tunnelId));
    return session;
  }

  /** Whether the relay takes a client of `tunnelId` now. */
  function hostCount(tunnelId: string): boolean {
    return (
      (legs as unknown as {hosts: Map<string, unknown>}).hosts.get(tunnelId) !==
      undefined
    );
  }

  /** Echoes every byte of `channel` back. */
  function echo(channel: Channel): void {
    channel.onDataReceived(data => {
      void channel.send(Buffer.from(data));
      channel.adjustWindow(data.length);
    });
  }

  /** A client of tunnel `tunnelId` on its leg, and the bytes it has received. */
  async function client(
    tunnelId: string,
    first?: Buffer[],
  ): Promise<{websocket: WebSocket; received: Buffer[]}> {
    const websocket = await opening(
      `/relay/client/${tunnelId}`,
      [CLIENT],
      `tunnel ${tunnelId} connect`,
    );
    const received: Buffer[] = [];
    websocket.on('message', (data: Buffer) => received.push(data));
    for (const each of first ?? []) {
      websocket.send(each);
    }
    return {websocket, received};
  }

  /** The bytes of `received` once there are `length` of them. */
  async function bytesOf(received: Buffer[], length: number): Promise<Buffer> {
    await until(() => Buffer.concat(received).length >= length);
    return Buffer.concat(received);
  }

  /** Resolves when `websocket` closes, with its close code. */
  function closed(websocket: WebSocket): Promise<number> {
    return websocket.readyState === WebSocket.CLOSED
      ? Promise.resolve(0)
      : new Promise(resolve => {
          websocket.once('close', resolve);
        });
  }

  describe('the upgrade', () => {
    it('refuses addresses that are not a leg', async () => {
      deepStrictEqual(
        [
          await refusal('/relay/host', [HOST], 'tunnel one host'),
          await refusal('/relay/host/one/more', [HOST], 'tunnel one host'),
          await refusal('/relay/side/one', [HOST], 'tunnel one host'),
          await refusal('/other/host/one', [HOST], 'tunnel one host'),
        ],
        Array(4).fill([404, 'There is no such leg.']),
      );
    });

    it("refuses a leg without its side's subprotocol: none, another's, or the -v2-dev ones alone", async () => {
      deepStrictEqual(
        [
          await refusal(
            '/relay/host/one',
            ['tunnel-relay-host-v2-dev'],
            'tunnel one host',
          ),
          await refusal(
            '/relay/client/one',
            ['tunnel-relay-client-v2-dev'],
            'tunnel one connect',
          ),
          await refusal('/relay/client/one', [HOST], 'tunnel one connect'),
          await refusal('/relay/host/one', [], 'tunnel one host'),
        ],
        [
          [400, 'The leg needs the subprotocol tunnel-relay-host.'],
          [400, 'The leg needs the subprotocol tunnel-relay-client.'],
          [400, 'The leg needs the subprotocol tunnel-relay-client.'],
          [400, 'The leg needs the subprotocol tunnel-relay-host.'],
        ],
      );
    });

    it("echoes the side's subprotocol when others are offered too", async () => {
      await host('one');
      const hostLeg = await opening(
        '/relay/host/one',
        ['tunnel-relay-host-v2-dev', HOST],
        'tunnel one host',
      );
      const clientLeg = await opening(
        '/relay/client/one',
        [HOST, CLIENT],
        'tunnel one connect',
      );
      deepStrictEqual([hostLeg.protocol, clientLeg.protocol], [HOST, CLIENT]);
    });

    it("needs its tunnel's token of the leg's scope: host for the host, connect for a client", async () => {
      deepStrictEqual(
        [
          await refusal('/relay/host/one', [HOST], 'tunnel one connect'),
          await refusal('/relay/host/one', [HOST], 'tunnel two host'),
          await refusal('/relay/host/one', [HOST], 'github octo'),
          await refusal('/relay/client/one', [CLIENT], 'tunnel one host'),
          await refusal('/relay/client/one', [CLIENT], 'tunnel two connect'),
        ],
        [
          [403, 'The leg needs a host token for its tunnel.'],
          [403, 'The leg needs a host token for its tunnel.'],
          [403, 'The leg needs a host token for its tunnel.'],
          [403, 'The leg needs a connect token for its tunnel.'],
          [403, 'The leg needs a connect token for its tunnel.'],
        ],
      );
    });

    it("passes on the sign-in's refusal, and answers 500 with one fixed line when it fails, reporting why to the relay alone", async () => {
      deepStrictEqual(
        [
          await refusal('/relay/host/one', [HOST], 'refused'),
          await refusal('/relay/host/one', [HOST], 'broken'),
          reported.map(String),
        ],
        [
          [401, 'Sign in with a GitHub account.'],
          [500, 'The relay failed.'],
          ['Error: down'],
        ],
      );
    });

    it('refuses a client past the limit with 403, counting clients as they connect and leave', async () => {
      await host('one');
      const first = await client('one');
      await client('one');
      const counted = legs.clientCount('one');
      const refused = await refusal(
        '/relay/client/one',
        [CLIENT],
        'tunnel one connect',
      );
      first.websocket.close();
      await until(() => legs.clientCount('one') === 1);
      deepStrictEqual(
        [
          counted,
          refused,
          await refusal('/relay/client/one', [CLIENT], 'tunnel one connect'),
          legs.clientCount('one'),
          legs.clientCount('other'),
        ],
        [2, [403, 'The tunnel already has 2 connected clients.'], 'open', 2, 0],
      );
    });

    it('gives the sign-in the address of the upgrade’s socket', async () => {
      addresses.length = 0;
      await refusal('/relay/host/one', [HOST], 'refused');
      deepStrictEqual(
        [
          addresses.length,
          /^(::ffff:)?127\.0\.0\.1$|^::1$/.test(addresses[0] ?? ''),
        ],
        [1, true],
      );
    });

    it('writes the headers of a refusal, such as the Retry-After of an address that has asked too often, before the body', async () => {
      const result = await open('/relay/host/one', [HOST], 'limited');
      deepStrictEqual(
        'websocket' in result
          ? 'open'
          : [result.status, result.detail, result.retryAfter],
        [429, 'Wait.', '30'],
      );
    });

    it('refuses a client with 503 while its tunnel has no host', async () => {
      await host('other');
      deepStrictEqual(
        await refusal('/relay/client/one', [CLIENT], 'tunnel one connect'),
        [503, 'No host is connected to the tunnel.'],
      );
    });
  });

  describe('the host leg', () => {
    it('is an SSH session with no key exchange, host key, cipher or MAC', async () => {
      const session = await host('one');
      deepStrictEqual(
        [
          session.sessionId,
          session.algorithms?.publicKeyAlgorithmName,
          session.algorithms?.cipher,
          session.algorithms?.messageSigner,
        ],
        [null, undefined, undefined, undefined],
      );
    });

    it('is replaced by a second host of the same tunnel, which then takes the clients', async () => {
      const first = await host('one');
      const firstClosed = new Promise(resolve => {
        first.onClosed(resolve);
      });
      const channels: string[] = [];
      await host('one', event => {
        channels.push(event.channel.channelType);
        echo(event.channel);
      });
      await firstClosed;
      const {received} = await client('one', [Buffer.from('to the second')]);
      deepStrictEqual(
        [String(await bytesOf(received, 13)), channels],
        ['to the second', ['client-ssh-session-stream']],
      );
    });

    it('takes no host when the SSH session never starts, so its clients are refused', async () => {
      const websocket = await opening(
        '/relay/host/one',
        [HOST],
        'tunnel one host',
      );
      websocket.close();
      await closed(websocket);
      await new Promise(resolve => setTimeout(resolve, 50));
      deepStrictEqual(
        await refusal('/relay/client/one', [CLIENT], 'tunnel one connect'),
        [503, 'No host is connected to the tunnel.'],
      );
    });

    it("closes with its tunnel's deletion, and the clients' legs with it", async () => {
      const session = await host('one');
      const hostClosed = new Promise(resolve => {
        session.onClosed(resolve);
      });
      const {websocket} = await client('one', [Buffer.from('hello')]);
      await until(() => session.channels.length === 1);
      legs.closeTunnel('one');
      legs.closeTunnel('none');
      await hostClosed;
      await closed(websocket);
      deepStrictEqual(hostCount('one'), false);
    });
  });

  describe('a client leg', () => {
    it('carries 64 KiB to the host and back byte for byte', async () => {
      await host('one');
      const payload = Buffer.alloc(64 * 1024);
      for (let index = 0; index < payload.length; index += 1) {
        payload[index] = (index * 31 + 7) % 251;
      }
      const pieces = [];
      for (let start = 0; start < payload.length; start += 4096) {
        pieces.push(payload.subarray(start, start + 4096));
      }
      const {received} = await client('one', pieces);
      const back = await bytesOf(received, payload.length);
      deepStrictEqual(
        createHash('sha256').update(back).digest('hex'),
        createHash('sha256').update(payload).digest('hex'),
      );
    });

    it('holds the bytes the client sends before its channel is open', async () => {
      await host('one', event => {
        echo(event.channel);
        event.openingPromise = new Promise(resolve => {
          setTimeout(() => {
            resolve(new ChannelOpenConfirmationMessage());
          }, 50);
        });
      });
      const {received} = await client('one', [
        Buffer.from('early '),
        Buffer.from('bytes'),
      ]);
      deepStrictEqual(String(await bytesOf(received, 11)), 'early bytes');
    });

    it('is closed when the host refuses its channel', async () => {
      await host('one', event => {
        event.failureReason =
          SshChannelOpenFailureReason.administrativelyProhibited;
      });
      const {websocket} = await client('one');
      deepStrictEqual(await closed(websocket), 1011);
    });

    it('is closed when the host closes its channel, and closes the channel when it closes', async () => {
      const channels: Channel[] = [];
      await host('one', event => {
        channels.push(event.channel);
      });
      const first = await client('one');
      const second = await client('one');
      await until(() => channels.length === 2);
      const [firstChannel, secondChannel] = channels as [Channel, Channel];
      const secondClosed = new Promise(resolve => {
        secondChannel.onClosed(resolve);
      });
      await firstChannel.close();
      second.websocket.close();
      await secondClosed;
      deepStrictEqual(await closed(first.websocket), 1005);
    });
  });

  describe('the keep-alive', () => {
    it("runs on the node's timers unless it is given others", async () => {
      legs = new Legs(authenticate, reportOf, 2);
      const websocket = await opening(
        '/relay/host/one',
        [HOST],
        'tunnel one host',
      );
      websocket.close();
      deepStrictEqual(await closed(websocket), 1005);
    });

    it('pings a leg that sent nothing for a minute, and waits ten seconds for the pong', async () => {
      const websocket = await opening(
        '/relay/host/one',
        [HOST],
        'tunnel one host',
      );
      const pinged = new Promise(resolve => {
        websocket.once('ping', resolve);
      });
      const before = timers.delays();
      timers.fire();
      const waiting = timers.delays();
      await pinged;
      await until(() => timers.delays()[0] === 60_000);
      deepStrictEqual(
        [before, waiting, timers.delays()],
        [[60_000], [10_000], [60_000]],
      );
    });

    it('ends a leg that does not answer the ping within ten seconds', async () => {
      const websocket = await opening(
        '/relay/host/one',
        [HOST],
        'tunnel one host',
        {autoPong: false},
      );
      const pinged = new Promise(resolve => {
        websocket.once('ping', resolve);
      });
      timers.fire();
      await pinged;
      timers.fire();
      deepStrictEqual(await closed(websocket), 1006);
    });

    it('pings again a minute after a pong, and ends the leg when that second ping goes unanswered', async () => {
      const websocket = await opening(
        '/relay/host/one',
        [HOST],
        'tunnel one host',
        {autoPong: false},
      );
      const firstPing = new Promise(resolve => {
        websocket.once('ping', resolve);
      });
      timers.fire();
      await firstPing;
      websocket.pong();
      await until(() => timers.delays()[0] === 60_000);
      const secondPing = new Promise(resolve => {
        websocket.once('ping', resolve);
      });
      timers.fire();
      await secondPing;
      const openAfterSecondPing = websocket.readyState === WebSocket.OPEN;
      timers.fire();
      deepStrictEqual(
        [openAfterSecondPing, await closed(websocket)],
        [true, 1006],
      );
    });

    it('starts the minute again whenever the leg sends anything, and stops when it closes', async () => {
      const websocket = await opening(
        '/relay/host/one',
        [HOST],
        'tunnel one host',
      );
      timers.fire();
      websocket.send(Buffer.from('anything'));
      await until(() => timers.delays()[0] === 60_000);
      const afterMessage = timers.delays();
      websocket.ping();
      await new Promise(resolve => setTimeout(resolve, 20));
      const afterPing = timers.delays();
      websocket.close();
      await closed(websocket);
      await until(() => timers.delays().length === 0);
      deepStrictEqual([afterMessage, afterPing], [[60_000], [60_000]]);
    });
  });

  describe('a leg that misbehaves, or a socket that fails', () => {
    /** A client leg of tunnel `one` upgraded by hand, whose socket can then write what a well-behaved client never would. */
    async function rawClient(): Promise<Socket> {
      const socket = connect(Number(new URL(address).port), '127.0.0.1');
      sockets.push(socket);
      socket.write(
        [
          'GET /relay/client/one HTTP/1.1',
          'Host: relay.test',
          'Connection: Upgrade',
          'Upgrade: websocket',
          'Sec-WebSocket-Version: 13',
          `Sec-WebSocket-Key: ${Buffer.alloc(16, 1).toString('base64')}`,
          `Sec-WebSocket-Protocol: ${CLIENT}`,
          'Authorization: tunnel one connect',
          '',
          '',
        ].join('\r\n'),
      );
      await new Promise(resolve => socket.once('data', resolve));
      return socket;
    }

    /** Whether the relay still pipes a new client of tunnel `one` through to its echoing host. */
    async function stillServes(): Promise<string> {
      const next = await client('one', [Buffer.from('again')]);
      return String(await bytesOf(next.received, 5));
    }

    it("refuses an upgrade whose target isn't a URL with 400, and goes on serving", async () => {
      await host('one');
      deepStrictEqual(
        [await refusal('//', [HOST], 'tunnel one host'), await stillServes()],
        [[400, "The leg's address is not valid."], 'again'],
      );
    });

    it('ends a leg that sends a frame with its reserved bits set, reports why, and goes on serving', async () => {
      await host('one');
      const broken = await rawClient();
      const ended = new Promise(resolve => broken.once('close', resolve));
      broken.write(Buffer.from([0xb2, 0x80, 0, 0, 0, 0]));
      await ended;
      deepStrictEqual(
        [reported.map(String), await stillServes()],
        [
          ['RangeError: Invalid WebSocket frame: RSV2 and RSV3 must be clear'],
          'again',
        ],
      );
    });

    it('ends a leg that sends a message larger than the largest it takes, and goes on serving', async () => {
      await host('one');
      const large = await client('one');
      const ended = closed(large.websocket);
      large.websocket.send(Buffer.alloc(LARGEST_MESSAGE + 1));
      deepStrictEqual(
        [await ended, reported.map(String), await stillServes()],
        [1009, ['RangeError: Max payload size exceeded'], 'again'],
      );
    });

    it('destroys an upgrade socket that fails while its sign-in is asked', async () => {
      const socket = new PassThrough();
      const request = {
        url: '/relay/host/one',
        headers: {'sec-websocket-protocol': HOST, authorization: 'refused'},
      };
      const upgrading = legs.upgrade(
        request as unknown as IncomingMessage,
        socket,
        Buffer.alloc(0),
      );
      socket.emit('error', new Error('reset by the peer'));
      await upgrading;
      deepStrictEqual(socket.destroyed, true);
    });

    it('gives the sign-in an empty address when the upgrade’s socket has none', async () => {
      addresses.length = 0;
      const request = {
        url: '/relay/host/one',
        headers: {'sec-websocket-protocol': HOST, authorization: 'refused'},
        socket: {remoteAddress: undefined},
      };
      await legs.upgrade(
        request as unknown as IncomingMessage,
        new PassThrough(),
        Buffer.alloc(0),
      );
      deepStrictEqual(addresses, ['']);
    });
  });

  describe('an owner taken off the allowlist', () => {
    it("loses every leg on the allowlist's next reading, host and clients, while other owners keep theirs", async () => {
      let listed = '7\n8\n';
      let modified = 1;
      const allowlist = new Allowlist(
        {modified: () => modified, text: () => listed},
        {
          onRead: () => {
            legs.closeUnadmitted(owner => allowlist.admits(owner));
          },
        },
      );
      allowlist.refresh();
      await host('one');
      const removed = await host('two', undefined, 8);
      const hostClosed = new Promise(resolve => {
        removed.onClosed(resolve);
      });
      const kept = await client('one', [Buffer.from('a')]);
      const dropped = await client('two', [Buffer.from('b')]);
      await bytesOf(kept.received, 1);
      await bytesOf(dropped.received, 1);
      listed = '7\n';
      modified = 2;
      allowlist.refresh();
      const droppedCode = await closed(dropped.websocket);
      await hostClosed;
      kept.websocket.send(Buffer.from('still'));
      deepStrictEqual(
        [
          droppedCode,
          hostCount('two'),
          String(await bytesOf(kept.received, 6)),
        ],
        [1005, false, 'astill'],
      );
    });
  });

  describe('the pace of a client leg', () => {
    const FLOOD = 32 * 1024 * 1024;
    const CHUNK = 64 * 1024;

    it("lets the host send no faster than a client that doesn't read takes the bytes, and delivers all of them once it does", async () => {
      let sent = 0;
      await host('one', event => {
        const {channel} = event;
        channel.onDataReceived(data => {
          channel.adjustWindow(data.length);
          void (async () => {
            while (sent < FLOOD) {
              await channel.send(Buffer.alloc(CHUNK));
              sent += CHUNK;
            }
          })();
        });
      });
      const slow = await client('one');
      slow.websocket.pause();
      slow.websocket.send(Buffer.from('go'));
      await new Promise(resolve => setTimeout(resolve, 500));
      const whilePaused = sent;
      slow.websocket.resume();
      deepStrictEqual(
        [whilePaused < FLOOD / 2, (await bytesOf(slow.received, FLOOD)).length],
        [true, FLOOD],
      );
    });

    it("stops reading a client whose bytes wait for a host that doesn't read", async () => {
      await host('one', event => {
        event.channel.onDataReceived(ignore);
      });
      const fast = await client('one');
      for (let offset = 0; offset < FLOOD; offset += CHUNK) {
        fast.websocket.send(Buffer.alloc(CHUNK));
      }
      await new Promise(resolve => setTimeout(resolve, 500));
      deepStrictEqual(fast.websocket.bufferedAmount > FLOOD / 2, true);
    });
  });
});

describe('the buffers the relay hands ws', () => {
  it('are copies, so a buffer reused for the next packet leaves the queued one whole', () => {
    const sent: Buffer[] = [];
    const websocket = {
      send(data: Buffer) {
        sent.push(data);
      },
    } as unknown as WebSocket;
    sendCopies(websocket);
    const reused = Buffer.from('first');
    websocket.send(reused);
    reused.write('later');
    websocket.send(new Uint8Array(Buffer.from('array')).buffer);
    deepStrictEqual(sent.map(String), ['first', 'array']);
  });
});

describe("the relay's SSH library", () => {
  it('is pinned exactly, at the version the pinned dev tunnels source resolves', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as {dependencies: Record<string, string>};
    const pins = JSON.parse(
      readFileSync(new URL('../../dev-tunnels.json', import.meta.url), 'utf8'),
    ) as {sshVersion: string};
    deepStrictEqual(
      manifest.dependencies['@microsoft/dev-tunnels-ssh'],
      pins.sshVersion,
    );
  });
});
