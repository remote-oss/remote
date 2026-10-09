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
  FakeDialer,
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
  dialScript: readonly Answer[] = ['work'],
  listenAnswer: Answer = 'work',
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
    limits: LIMITS,
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
