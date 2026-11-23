import {deepStrictEqual} from 'node:assert';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createServer, type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import devTunnelsSsh from '@microsoft/dev-tunnels-ssh';
import {WebSocket, type ClientOptions} from 'ws';
import {sendCopies} from '../../src/legs/copies.ts';
import {Legs, type Timers} from '../../src/legs/legs.ts';
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

/**
 * Takes `tunnel <id> <scope>` as that tunnel's token, `github <login>` as an account, `refused` as a refusal, and
 * `broken` as a failure to ask.
 */
function authenticate(
  headers: Parameters<Authenticate>[0],
): ReturnType<Authenticate> {
  const [scheme = '', first = '', second = ''] = (
    headers.authorization ?? ''
  ).split(' ');
  if (scheme === 'broken') {
    return Promise.reject(new Error('down'));
  }
  if (scheme === 'tunnel' && (second === 'host' || second === 'connect')) {
    return Promise.resolve({kind: 'tunnel', tunnelId: first, scope: second});
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
type Opened = {websocket: WebSocket} | {status: number; detail: string};

describe("the relay's WebSocket legs", () => {
  let server: Server;
  let timers: FakeTimers;
  let legs: Legs;
  let address: string;
  const opened: WebSocket[] = [];
  const sessions: HostSide[] = [];

  beforeEach(async () => {
    timers = new FakeTimers();
    legs = new Legs(authenticate, timers);
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
          resolve({status: response.statusCode ?? 0, detail: body.detail});
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
  ): Promise<HostSide> {
    const session = new SshClientSession(new SshSessionConfiguration(false));
    sessions.push(session);
    session.onChannelOpening(onOpening);
    let stream: InstanceType<typeof WebSocketStream> | undefined;
    await opening(
      `/relay/host/${tunnelId}`,
      [HOST],
      `tunnel ${tunnelId} host`,
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

    it("passes on the sign-in's refusal, and answers 500 when it fails", async () => {
      deepStrictEqual(
        [
          await refusal('/relay/host/one', [HOST], 'refused'),
          await refusal('/relay/host/one', [HOST], 'broken'),
        ],
        [
          [401, 'Sign in with a GitHub account.'],
          [500, 'The relay failed: Error: down'],
        ],
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
      legs = new Legs(authenticate);
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
