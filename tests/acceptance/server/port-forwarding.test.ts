import {deepStrictEqual} from 'node:assert';
import {createServer} from 'node:net';
import {
  type Duplex,
  nodeLocalPort,
  openRelayTunnel,
  socksDialer,
  type WaitLimits,
  type WindowTunnelOutcome,
} from 'lib-forwarding';
import {startHost, type RunningHost} from './host-fixture.ts';
import {openSharedSession, type SharedSession} from './shared-session.ts';

/** The port on the host where a stand-in echo service listens. */
const ECHO_PORT = 7777;

/** A port on the host where nothing listens. */
const SILENT_PORT = 7778;

const LIMITS: WaitLimits = {readyMilliseconds: 10000, retryMilliseconds: 100};

const scheduler = {
  setTimer: (milliseconds: number, callback: () => void) => {
    const timer = setTimeout(callback, milliseconds);
    return () => {
      clearTimeout(timer);
    };
  },
};

/** A free loopback port: bound and released at once. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        resolve(
          typeof address === 'object' && address !== null ? address.port : 0,
        );
      });
    });
  });
}

/** Everything the connection delivers until it closes. */
function untilClosed(connection: Duplex): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return new Promise(resolve => {
    connection.onData(chunk => {
      chunks.push(Buffer.from(chunk));
    });
    connection.onClose(() => {
      resolve(Buffer.concat(chunks));
    });
  });
}

/** The bytes of `length` bytes that a reader checks, none equal to its neighbour. */
function pattern(length: number): Buffer {
  return Buffer.from(Array.from({length}, (unused, index) => index % 251));
}

describe('F-2105 the port forward over the shared connection to a host', function () {
  this.timeout(180000);
  let host: RunningHost;
  let session: SharedSession;

  before(async () => {
    host = await startHost();
    session = await openSharedSession(host);
    host.onHost(
      'sh',
      '-c',
      `nohup nc -ll -p ${String(ECHO_PORT)} -e /bin/cat >/dev/null 2>&1 &`,
    );
  });

  after(async () => {
    await session.stop();
    host.stop();
  });

  async function tunnelTo(
    port: number,
    limits: WaitLimits = LIMITS,
  ): Promise<WindowTunnelOutcome> {
    return openRelayTunnel({
      dialer: socksDialer({
        local: nodeLocalPort(),
        socksPort: session.socksPort,
        scheduler,
        handshakeMilliseconds: 10000,
      }),
      local: nodeLocalPort(),
      scheduler,
      target: {kind: 'port', port},
      localPort: await freePort(),
      limits,
    });
  }

  it('F-2105: bytes sent to the window port come back from the service on the host', async () => {
    const tunnel = await tunnelTo(ECHO_PORT);
    if (tunnel.kind !== 'open') {
      throw new Error(`the tunnel did not open: ${tunnel.kind}`);
    }
    const client = await nodeLocalPort().connect(tunnel.address.port);
    const echoed = untilClosed(client);
    client.send(Buffer.from('hello through the host'));
    await new Promise(resolve => setTimeout(resolve, 500));
    client.close();
    tunnel.close();
    deepStrictEqual((await echoed).toString(), 'hello through the host');
  });

  it('F-2105: a payload larger than the buffers comes back whole and in order', async () => {
    const tunnel = await tunnelTo(ECHO_PORT);
    if (tunnel.kind !== 'open') {
      throw new Error(`the tunnel did not open: ${tunnel.kind}`);
    }
    const client = await nodeLocalPort().connect(tunnel.address.port);
    const payload = pattern(4 * 1024 * 1024);
    const received: Buffer[] = [];
    let total = 0;
    const complete = new Promise<void>(resolve => {
      client.onData(chunk => {
        received.push(Buffer.from(chunk));
        total += chunk.length;
        if (total >= payload.length) {
          resolve();
        }
      });
    });
    for (let offset = 0; offset < payload.length; offset += 65536) {
      client.send(payload.subarray(offset, offset + 65536));
    }
    await complete;
    client.close();
    tunnel.close();
    deepStrictEqual(Buffer.concat(received).equals(payload), true);
  });

  it('F-2105: a port on the host where nothing listens leaves the tunnel not ready', async () => {
    const tunnel = await tunnelTo(SILENT_PORT, {
      readyMilliseconds: 2000,
      retryMilliseconds: 100,
    });
    deepStrictEqual(tunnel.kind, 'tunnelNotReady');
  });
});
