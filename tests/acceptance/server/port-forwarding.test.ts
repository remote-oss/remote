import {deepStrictEqual} from 'node:assert';
import {
  nodeLocalPort,
  openRelayTunnel,
  socksDialer,
  type WaitLimits,
  type WindowTunnelOutcome,
} from 'lib-forwarding';
import {startHost, type RunningHost} from './host-fixture.ts';
import {
  ECHO_PORT,
  freePort,
  LIMITS,
  receivedBytes,
  scheduler,
} from './support.ts';
import {openSharedSession, type SharedSession} from './shared-session.ts';

/** A port on the host where nothing listens. */
const SILENT_PORT = 7778;

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
    const text = 'hello through the host';
    const echoed = receivedBytes(client, text.length);
    client.send(Buffer.from(text));
    const received = await echoed;
    client.close();
    tunnel.close();
    deepStrictEqual(received.toString(), text);
  });

  it('F-2105: a payload larger than the buffers comes back whole and in order', async () => {
    const tunnel = await tunnelTo(ECHO_PORT);
    if (tunnel.kind !== 'open') {
      throw new Error(`the tunnel did not open: ${tunnel.kind}`);
    }
    const client = await nodeLocalPort().connect(tunnel.address.port);
    const payload = pattern(4 * 1024 * 1024);
    const complete = receivedBytes(client, payload.length);
    for (let offset = 0; offset < payload.length; offset += 65536) {
      client.send(payload.subarray(offset, offset + 65536));
    }
    const received = await complete;
    client.close();
    tunnel.close();
    deepStrictEqual(received.equals(payload), true);
  });

  it('F-2105: a port on the host where nothing listens leaves the tunnel not ready', async () => {
    const tunnel = await tunnelTo(SILENT_PORT, {
      readyMilliseconds: 2000,
      retryMilliseconds: 100,
      heldBytesMaximum: 10_000_000,
    });
    deepStrictEqual(tunnel.kind, 'tunnelNotReady');
  });
});
