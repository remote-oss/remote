import {deepStrictEqual} from 'node:assert';
import {createServer, type Server} from 'node:net';
import {
  type Dialer,
  factoryFor,
  nodeLocalPort,
  socksDialer,
  type TunnelFactory,
} from 'lib-forwarding';
import {startHost, type RunningHost} from './host-fixture.ts';
import {openSharedSession, type SharedSession} from './shared-session.ts';
import {
  ECHO_PORT,
  freePort,
  LIMITS,
  receivedBytes,
  scheduler,
} from './support.ts';

/** A port on the host where nothing listens. */
const SILENT_PORT = 7779;

/** The dialer of the extension over a session's SOCKS forward. */
function dialerOver(session: SharedSession): Dialer {
  return socksDialer({
    local: nodeLocalPort(),
    socksPort: session.socksPort,
    scheduler,
    handshakeMilliseconds: 10000,
  });
}

/** The longest a test waits for a refused connection to be reported. */
const REFUSED_BOUND_MILLISECONDS = 5000;

/** Whether a connection to the local port is refused. */
async function refused(port: number): Promise<boolean> {
  try {
    (await nodeLocalPort().connect(port)).close();
    return false;
  } catch {
    // A port nothing listens on refuses the connection.
    return true;
  }
}

/** What a client of the local port gets back for `text`. */
async function echoOf(port: number, text: string): Promise<string> {
  const client = await nodeLocalPort().connect(port);
  try {
    const echoed = receivedBytes(client, text.length);
    client.send(Buffer.from(text));
    return (await echoed).toString();
  } finally {
    client.close();
  }
}

describe('F-2104 the tunnel factory against the harness host', function () {
  this.timeout(180000);
  let host: RunningHost;
  let session: SharedSession;
  const sessions: SharedSession[] = [];
  const squatters: Server[] = [];
  let factory: TunnelFactory;

  before(async () => {
    host = await startHost();
    session = await openSharedSession(host);
    sessions.push(session);
    host.onHost(
      'sh',
      '-c',
      `nohup nc -ll -p ${String(ECHO_PORT)} -e /bin/cat >/dev/null 2>&1 &`,
    );
  });

  beforeEach(() => {
    factory = factoryFor({
      dialer: dialerOver(session),
      local: nodeLocalPort(),
      scheduler,
      limits: LIMITS,
    });
  });

  afterEach(async () => {
    factory.closeAll();
    for (const squatter of squatters.splice(0)) {
      await new Promise(resolve => squatter.close(resolve));
    }
  });

  after(async () => {
    for (const open of sessions) {
      await open.stop();
    }
    host.stop();
  });

  it('F-2104 BR-1: a forward to the echo port reports the ports it joined', async () => {
    const localPort = await freePort();
    deepStrictEqual(await factory.forward({remotePort: ECHO_PORT, localPort}), {
      kind: 'forwarded',
      port: {remotePort: ECHO_PORT, localPort},
    });
  });

  it('F-2105: a client of the local port gets its bytes echoed by the host', async () => {
    const localPort = await freePort();
    await factory.forward({remotePort: ECHO_PORT, localPort});
    deepStrictEqual(await echoOf(localPort, 'ping'), 'ping');
  });

  it('F-2104: two forwards are listed in the order they were made', async () => {
    const first = await freePort();
    const second = await freePort();
    await factory.forward({remotePort: ECHO_PORT, localPort: first});
    await factory.forward({remotePort: ECHO_PORT, localPort: second});
    deepStrictEqual(
      factory.forwarded().map(port => port.localPort),
      [first, second],
    );
  });

  it('F-2104 BR-10: a forward to a host port where nothing listens is not ready', async () => {
    const localPort = await freePort();
    deepStrictEqual(
      await factory.forward({remotePort: SILENT_PORT, localPort}),
      {kind: 'failed', reason: 'tunnelNotReady'},
    );
  });

  it('F-2104 BR-10: the local port of a forward that was not ready is free again', async () => {
    const localPort = await freePort();
    await factory.forward({remotePort: SILENT_PORT, localPort});
    deepStrictEqual(await refused(localPort), true);
  });

  it('F-2104: a forward to a local port another process listens on fails to listen', async () => {
    const squatter = createServer();
    squatters.push(squatter);
    const localPort = await new Promise<number>(resolve => {
      squatter.listen(0, '127.0.0.1', () => {
        const address = squatter.address();
        resolve(
          typeof address === 'object' && address !== null ? address.port : 0,
        );
      });
    });
    deepStrictEqual(await factory.forward({remotePort: ECHO_PORT, localPort}), {
      kind: 'failed',
      reason: 'listenFailed',
    });
  });

  it('F-2104 Q4, F-2507 Q1: after a new session the report revives the forward', async () => {
    const localPort = await freePort();
    await factory.forward({remotePort: ECHO_PORT, localPort});
    await session.stop();
    session = await openSharedSession(host);
    sessions.push(session);
    const report = await factory.reconnect(dialerOver(session));
    deepStrictEqual(report, {
      revived: [{remotePort: ECHO_PORT, localPort}],
      failed: [],
    });
  });

  it('F-2104 Q4, F-2507 Q1: after a new session a client of the same local port gets its echo through it', async () => {
    const localPort = await freePort();
    await factory.forward({remotePort: ECHO_PORT, localPort});
    await session.stop();
    session = await openSharedSession(host);
    sessions.push(session);
    await factory.reconnect(dialerOver(session));
    deepStrictEqual(await echoOf(localPort, 'again'), 'again');
  });

  it('F-2104 Q4: a reconnection whose relay does not answer lists the forward as failed', async () => {
    const localPort = await freePort();
    await factory.forward({remotePort: ECHO_PORT, localPort});
    const silentRelay = await freePort();
    const started = Date.now();
    const report = await factory.reconnect(
      socksDialer({
        local: nodeLocalPort(),
        socksPort: silentRelay,
        scheduler,
        handshakeMilliseconds: 1000,
      }),
    );
    deepStrictEqual(
      [
        report.failed.map(port => port.localPort),
        Date.now() - started <
          LIMITS.readyMilliseconds + REFUSED_BOUND_MILLISECONDS,
      ],
      [[localPort], true],
    );
  });

  it('F-2104: closing all forwards empties the list', async () => {
    await factory.forward({remotePort: ECHO_PORT, localPort: await freePort()});
    await factory.forward({remotePort: ECHO_PORT, localPort: await freePort()});
    factory.closeAll();
    deepStrictEqual(factory.forwarded(), []);
  });

  it('F-2104: closing all forwards frees both local ports', async () => {
    const first = await freePort();
    const second = await freePort();
    await factory.forward({remotePort: ECHO_PORT, localPort: first});
    await factory.forward({remotePort: ECHO_PORT, localPort: second});
    factory.closeAll();
    deepStrictEqual(
      [await refused(first), await refused(second)],
      [true, true],
    );
  });
});
