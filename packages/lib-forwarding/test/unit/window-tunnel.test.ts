import {deepStrictEqual} from 'node:assert';
import {FakeClock} from 'lib-helper/testing/fake-clock';
import {
  openForwardedTunnel,
  openRelayTunnel,
  type RelayTunnelRequest,
  type WindowTunnelOutcome,
} from '../../src/index.ts';
import {
  type Answer,
  type DialAnswer,
  FakeDialer,
  type FakeConnection,
  FakeLocalPort,
} from '../../src/testing/fake-network.ts';
import {LIMITS, settled, advanced} from './timing.fixture.ts';

interface RelayFixture {
  clock: FakeClock;
  dialer: FakeDialer;
  local: FakeLocalPort;
  open: () => Promise<WindowTunnelOutcome>;
}

function relay(
  dialScript: readonly DialAnswer[] = ['work'],
  listenAnswer: Answer = 'work',
  heldBytesMaximum: number = LIMITS.heldBytesMaximum,
): RelayFixture {
  const clock = new FakeClock();
  const dialer = new FakeDialer(dialScript);
  const local = new FakeLocalPort(listenAnswer);
  const request: RelayTunnelRequest = {
    dialer,
    local,
    scheduler: clock.scheduler(),
    target: {kind: 'port', port: 4321},
    localPort: 50000,
    limits: {...LIMITS, heldBytesMaximum},
  };
  return {clock, dialer, local, open: () => openRelayTunnel(request)};
}

describe('the window tunnel through the relay', () => {
  it('opens at once when a probe through the dialer works, and gives the window its address', async () => {
    const {open} = relay();
    const outcome = await open();
    deepStrictEqual(outcome.kind === 'open' ? outcome.address : outcome, {
      host: '127.0.0.1',
      port: 50000,
    });
  });

  it('listens on the window port and probes the server port of the host, closing the probe', async () => {
    const {open, local, dialer} = relay();
    await open();
    deepStrictEqual(
      [
        local.listened,
        dialer.dialed,
        dialer.connections.map(connection => connection.closed),
      ],
      [[50000], [{kind: 'port', port: 4321}], [true]],
    );
  });

  it('tries again after a failed probe, and opens when one works', async () => {
    const {open, clock, dialer} = relay(['fail', 'fail', 'work']);
    const pending = open();
    await advanced(clock, 500);
    await advanced(clock, 500);
    const outcome = await pending;
    deepStrictEqual([outcome.kind, dialer.dialed.length], ['open', 3]);
  });

  it('is not ready at the bound when every probe fails, and closes the port', async () => {
    const {open, clock, local} = relay(['fail']);
    const pending = open();
    await advanced(clock, 10_000);
    deepStrictEqual(
      [(await pending).kind, local.closedPorts],
      ['tunnelNotReady', [50000]],
    );
  });

  it('is not ready at the bound when the dialer never answers, never a hang', async () => {
    const {open, clock} = relay(['hang']);
    const pending = open();
    await advanced(clock, 10_000);
    deepStrictEqual((await pending).kind, 'tunnelNotReady');
  });

  it('is not ready before the bound while the dialer still has time', async () => {
    const {open, clock} = relay(['hang']);
    let settledEarly = false;
    void open().then(() => {
      settledEarly = true;
    });
    await advanced(clock, 9_999);
    deepStrictEqual(settledEarly, false);
  });

  it('says the port could not be listened on, with the reason, and probes nothing', async () => {
    const {open, dialer} = relay(['work'], 'fail');
    deepStrictEqual(
      [await open(), dialer.dialed],
      [{kind: 'listenFailed', detail: 'port 50000 is in use'}, []],
    );
  });

  it('dials the target for each connection to the window port and passes the bytes both ways', async () => {
    const {open, local, dialer} = relay();
    await open();
    const client = local.accept(50000);
    await settled();
    const remote = dialer.connections[1];
    client?.receive(Uint8Array.of(1, 2));
    remote?.receive(Uint8Array.of(3));
    deepStrictEqual(
      [remote?.sent, client?.sent],
      [[Uint8Array.of(1, 2)], [Uint8Array.of(3)]],
    );
  });

  it('closes a connection whose dial fails', async () => {
    const {open, local} = relay(['work', 'fail']);
    await open();
    const client = local.accept(50000);
    await settled();
    deepStrictEqual(client?.closed, true);
  });

  it('ends each side of a pair when the other ends', async () => {
    const {open, local, dialer} = relay();
    await open();
    const client = local.accept(50000);
    await settled();
    dialer.connections[1]?.close();
    deepStrictEqual(client?.closed, true);
  });

  it('ends the client when the host side of a pair ends, and the host side when the client ends', async () => {
    const {open, local, dialer} = relay();
    await open();
    const client = local.accept(50000);
    await settled();
    client?.close();
    deepStrictEqual(dialer.connections[1]?.closed, true);
  });

  it('closes the port and every connection when the tunnel is closed', async () => {
    const {open, local, dialer} = relay();
    const outcome = await open();
    const client = local.accept(50000);
    await settled();
    if (outcome.kind === 'open') {
      outcome.close();
    }
    deepStrictEqual(
      [local.closedPorts, client?.closed, dialer.connections[1]?.closed],
      [[50000], true, true],
    );
  });
});

describe('the window tunnel of a second ssh session', () => {
  function forwarded(connectScript: readonly Answer[]): {
    clock: FakeClock;
    local: FakeLocalPort;
    stops: number[];
    open: () => Promise<WindowTunnelOutcome>;
  } {
    const clock = new FakeClock();
    const local = new FakeLocalPort('work', connectScript);
    const stops: number[] = [];
    return {
      clock,
      local,
      stops,
      open: () =>
        openForwardedTunnel({
          local,
          scheduler: clock.scheduler(),
          localPort: 50001,
          limits: LIMITS,
          stopSession: () => {
            stops.push(stops.length + 1);
          },
        }),
    };
  }

  it('opens as soon as the port accepts a connection, closing the probe', async () => {
    const {open, local} = forwarded(['work']);
    const outcome = await open();
    deepStrictEqual(
      [
        outcome.kind === 'open' ? outcome.address : outcome,
        local.probes.map(probe => probe.closed),
      ],
      [{host: '127.0.0.1', port: 50001}, [true]],
    );
  });

  it('waits for the port, trying again after each refusal', async () => {
    const {open, clock, local} = forwarded(['fail', 'fail', 'work']);
    const pending = open();
    await advanced(clock, 500);
    await advanced(clock, 500);
    deepStrictEqual(
      [(await pending).kind, local.connected],
      ['open', [50001, 50001, 50001]],
    );
  });

  it('is not ready at the bound, and ends the session once', async () => {
    const {open, clock, stops} = forwarded(['fail']);
    const pending = open();
    await advanced(clock, 10_000);
    deepStrictEqual([(await pending).kind, stops], ['tunnelNotReady', [1]]);
  });

  it('is not ready at the bound when the port never answers', async () => {
    const {open, clock} = forwarded(['hang']);
    const pending = open();
    await advanced(clock, 10_000);
    deepStrictEqual((await pending).kind, 'tunnelNotReady');
  });

  it('ends the session when the tunnel is closed', async () => {
    const {open, stops} = forwarded(['work']);
    const outcome = await open();
    if (outcome.kind === 'open') {
      outcome.close();
    }
    deepStrictEqual(stops, [1]);
  });
});

describe('the window tunnel after it is closed, and when listening fails oddly', () => {
  it('nothing listens on the window port any more', async () => {
    const {open, local} = relay();
    const outcome = await open();
    if (outcome.kind === 'open') {
      outcome.close();
    }
    deepStrictEqual(local.accept(50000), undefined);
  });

  it('reports a listen failure that is no error object by its text', async () => {
    const clock = new FakeClock();
    const outcome = await openRelayTunnel({
      dialer: new FakeDialer(),
      local: {
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a port that breaks its contract, on purpose
        listen: () => Promise.reject('refused by policy'),
        connect: () => Promise.reject(new Error('unused')),
      },
      scheduler: clock.scheduler(),
      target: {kind: 'port', port: 4321},
      localPort: 50000,
      limits: LIMITS,
    });
    deepStrictEqual(outcome, {
      kind: 'listenFailed',
      detail: 'refused by policy',
    });
  });
});

describe('the fakes', () => {
  it('a dialer with an empty script works', async () => {
    const dialer = new FakeDialer([]);
    await dialer.dial({kind: 'port', port: 1});
    deepStrictEqual(dialer.connections.length, 1);
  });
});

/** A tunnel that is open, with a client connected to it, and the connection to the host that the client got. */
async function connected(
  dialScript: readonly DialAnswer[] = ['work'],
  heldBytesMaximum: number = LIMITS.heldBytesMaximum,
): Promise<{
  fixture: RelayFixture;
  tunnel: WindowTunnelOutcome;
  client: FakeConnection | undefined;
  host: () => FakeConnection | undefined;
}> {
  const fixture = relay(dialScript, 'work', heldBytesMaximum);
  const tunnel = await fixture.open();
  const client = fixture.local.accept(50000);
  await settled();
  return {
    fixture,
    tunnel,
    client,
    host: () => fixture.dialer.connections[1],
  };
}

describe('a client that does not wait for the host side', () => {
  it('has the bytes it sends before the host side opens delivered first, in order', async () => {
    const {fixture, client, host} = await connected(['work', 'later']);
    client?.receive(Uint8Array.of(1));
    client?.receive(Uint8Array.of(2));
    fixture.dialer.openNext();
    await settled();
    client?.receive(Uint8Array.of(3));
    deepStrictEqual(host()?.sent, [
      Uint8Array.of(1),
      Uint8Array.of(2),
      Uint8Array.of(3),
    ]);
  });

  it('closes the host side when it opens after the client has left', async () => {
    const {fixture, client, host} = await connected(['work', 'later']);
    client?.close();
    fixture.dialer.openNext();
    await settled();
    deepStrictEqual(host()?.closed, true);
  });

  it('sends nothing to a host side that opens after the client has left', async () => {
    const {fixture, client, host} = await connected(['work', 'later']);
    client?.receive(Uint8Array.of(9));
    client?.close();
    fixture.dialer.openNext();
    await settled();
    deepStrictEqual(host()?.sent, []);
  });

  it('closes the host side that opens after the tunnel was closed', async () => {
    const {fixture, tunnel, host} = await connected(['work', 'later']);
    if (tunnel.kind === 'open') {
      tunnel.close();
    }
    fixture.dialer.openNext();
    await settled();
    deepStrictEqual(host()?.closed, true);
  });
});

describe('a slow side of a tunnel', () => {
  it('pauses the client while the host side holds all it wants, and resumes it when that side drains', async () => {
    const {client, host} = await connected();
    const slow = host();
    if (slow !== undefined) {
      slow.full = true;
    }
    client?.receive(Uint8Array.of(1));
    const pausedWhileFull = client?.paused;
    slow?.drain();
    deepStrictEqual([pausedWhileFull, client?.paused], [true, false]);
  });

  it('pauses the host side while the client holds all it wants, and resumes it when the client drains', async () => {
    const {client, host} = await connected();
    if (client !== undefined) {
      client.full = true;
    }
    host()?.receive(Uint8Array.of(1));
    const pausedWhileFull = host()?.paused;
    client?.drain();
    deepStrictEqual([pausedWhileFull, host()?.paused], [true, false]);
  });

  it('pauses the client when the bytes it sent early fill the host side that opens', async () => {
    const {fixture, client} = await connected(['work', 'later']);
    client?.receive(Uint8Array.of(1));
    fixture.dialer.slow = true;
    fixture.dialer.openNext();
    await settled();
    deepStrictEqual(client?.paused, true);
  });
});

describe('the cap on the bytes a bridge holds before the host side opens', () => {
  it('holds a few bytes across chunks and delivers them in order once the host side opens', async () => {
    const {fixture, client, host} = await connected(['work', 'later']);
    client?.receive(Uint8Array.of(1, 2, 3));
    client?.receive(Uint8Array.of(4, 5, 6, 7, 8));
    fixture.dialer.openNext();
    await settled();
    deepStrictEqual(
      [host()?.sent.map(bytes => bytes.byteLength), client?.closed],
      [[3, 5], false],
    );
  });

  it('holds a chunk exactly at the cap and delivers it', async () => {
    const {fixture, client, host} = await connected(['work', 'later']);
    client?.receive(Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8));
    fixture.dialer.openNext();
    await settled();
    deepStrictEqual(
      [client?.closed, host()?.sent.map(bytes => bytes.byteLength)],
      [false, [8]],
    );
  });

  it('closes a client that would go past the cap in one chunk, and nothing is sent', async () => {
    const {fixture, client, host} = await connected(['work', 'later']);
    client?.receive(Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9));
    fixture.dialer.openNext();
    await settled();
    deepStrictEqual(
      [client?.closed, host()?.sent, host()?.paused, host()?.closed],
      [true, [], false, true],
    );
  });

  it('closes the client when a second chunk takes the held bytes past the cap, and the first is never sent', async () => {
    const {fixture, client, host} = await connected(['work', 'later']);
    client?.receive(Uint8Array.of(1, 2, 3, 4, 5));
    client?.receive(Uint8Array.of(6, 7, 8, 9));
    fixture.dialer.openNext();
    await settled();
    deepStrictEqual(
      [host()?.closed, host()?.sent, host()?.paused, client?.closed],
      [true, [], false, true],
    );
  });

  it('forwards more than the cap once the host side is open', async () => {
    const {client, host} = await connected();
    client?.receive(new Uint8Array(100));
    await settled();
    deepStrictEqual(
      [client?.closed, host()?.sent.map(bytes => bytes.byteLength)],
      [false, [100]],
    );
  });

  it('closes a client that sends one byte before the dial when the cap is zero', async () => {
    const {fixture, client} = await connected(['work', 'later'], 0);
    client?.receive(Uint8Array.of(1));
    fixture.dialer.openNext();
    await settled();
    deepStrictEqual(
      [client?.closed, fixture.dialer.connections[1]?.closed],
      [true, true],
    );
  });

  it('holds nothing and sends nothing for a client that has already gone past the cap', async () => {
    const {fixture, client, host} = await connected(['work', 'later']);
    client?.receive(Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9));
    client?.receive(Uint8Array.of(10));
    fixture.dialer.openNext();
    await settled();
    deepStrictEqual(
      [host()?.closed, client?.closed, host()?.sent, host()?.paused],
      [true, true, [], false],
    );
  });

  it('treats a cap that is not a number as failing safe, so the first byte closes the client', async () => {
    const {fixture, client} = await connected(['work', 'later'], Number.NaN);
    client?.receive(Uint8Array.of(1));
    fixture.dialer.openNext();
    await settled();
    deepStrictEqual(
      [fixture.dialer.connections[1]?.closed, client?.closed],
      [true, true],
    );
  });
});
