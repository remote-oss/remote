import {deepStrictEqual} from 'node:assert';
import {FakeClock} from 'lib-helper/testing/fake-clock';
import {
  factoryFor,
  type ForwardOutcome,
  type TunnelFactory,
} from '../../src/index.ts';
import {
  type Answer,
  FakeDialer,
  FakeLocalPort,
} from '../../src/testing/fake-network.ts';
import {LIMITS, settled} from './timing.fixture.ts';

interface Fixture {
  clock: FakeClock;
  dialer: FakeDialer;
  local: FakeLocalPort;
  factory: TunnelFactory;
}

function fixture(
  dialScript: readonly Answer[] = ['work'],
  listenAnswer: Answer = 'work',
): Fixture {
  const clock = new FakeClock();
  const dialer = new FakeDialer(dialScript);
  const local = new FakeLocalPort(listenAnswer);
  return {
    clock,
    dialer,
    local,
    factory: factoryFor({
      dialer,
      local,
      scheduler: clock.scheduler(),
      limits: LIMITS,
    }),
  };
}

describe('the tunnel factory', () => {
  it('offers private forwards without elevation', () => {
    deepStrictEqual(fixture().factory.features, {
      elevation: false,
      privacy: ['private'],
    });
  });

  it('forwards a port and lists it with its label', async () => {
    const {factory} = fixture();
    const outcome = await factory.forward({
      remotePort: 3000,
      localPort: 3001,
      label: 'web',
    });
    deepStrictEqual(
      [outcome, factory.forwarded()],
      [
        {
          kind: 'forwarded',
          port: {remotePort: 3000, localPort: 3001, label: 'web'},
        },
        [{remotePort: 3000, localPort: 3001, label: 'web'}],
      ],
    );
  });

  it('lists a port without a label as it was asked', async () => {
    const {factory} = fixture();
    await factory.forward({remotePort: 3000, localPort: 3000});
    deepStrictEqual(factory.forwarded(), [{remotePort: 3000, localPort: 3000}]);
  });

  it('forwards the host port through the dialer when a client connects', async () => {
    const {factory, local, dialer} = fixture();
    await factory.forward({remotePort: 3000, localPort: 3001});
    local.accept(3001);
    await settled();
    deepStrictEqual(dialer.dialed.at(-1), {kind: 'port', port: 3000});
  });

  it('keeps forwarded ports in the order they were forwarded', async () => {
    const {factory} = fixture();
    await factory.forward({remotePort: 1, localPort: 11});
    await factory.forward({remotePort: 2, localPort: 12});
    deepStrictEqual(
      factory.forwarded().map(port => port.remotePort),
      [1, 2],
    );
  });

  it('lists nothing and says why when the local port cannot be listened on', async () => {
    const {factory} = fixture(['work'], 'fail');
    const outcome = await factory.forward({remotePort: 3000, localPort: 3001});
    deepStrictEqual(
      [outcome, factory.forwarded()],
      [{kind: 'failed', reason: 'listenFailed'}, []],
    );
  });

  it('lists nothing and says why when the host port does not answer in time', async () => {
    const {factory, clock} = fixture(['fail']);
    const pending: Promise<ForwardOutcome> = factory.forward({
      remotePort: 3000,
      localPort: 3001,
    });
    await settled();
    clock.advance(10_000);
    await settled();
    deepStrictEqual(
      [await pending, factory.forwarded()],
      [{kind: 'failed', reason: 'tunnelNotReady'}, []],
    );
  });

  it('after a reconnection forwards over the new dialer without moving the local port', async () => {
    const {factory, local} = fixture();
    await factory.forward({remotePort: 3000, localPort: 3001});
    const replacement = new FakeDialer(['work']);
    await factory.reconnect(replacement);
    local.accept(3001);
    await settled();
    deepStrictEqual(
      [replacement.dialed.at(-1), local.listened],
      [{kind: 'port', port: 3000}, [3001]],
    );
  });

  it('reports which forwards the new connection revived and which it could not', async () => {
    const {factory, clock} = fixture();
    await factory.forward({remotePort: 3000, localPort: 3001});
    await factory.forward({remotePort: 4000, localPort: 4001});
    const replacement = new FakeDialer(['work', 'fail']);
    const pending = factory.reconnect(replacement);
    await settled();
    clock.advance(10_000);
    await settled();
    deepStrictEqual(await pending, {
      revived: [{remotePort: 3000, localPort: 3001}],
      failed: [{remotePort: 4000, localPort: 4001}],
    });
  });

  it('keeps a forward the new connection could not revive listed', async () => {
    const {factory, clock} = fixture();
    await factory.forward({remotePort: 3000, localPort: 3001});
    const pending = factory.reconnect(new FakeDialer(['fail']));
    await settled();
    clock.advance(10_000);
    await settled();
    await pending;
    deepStrictEqual(factory.forwarded(), [{remotePort: 3000, localPort: 3001}]);
  });

  it('ends every forward when closed, and lists none', async () => {
    const {factory, local} = fixture();
    await factory.forward({remotePort: 3000, localPort: 3001});
    await factory.forward({remotePort: 4000, localPort: 4001});
    factory.closeAll();
    deepStrictEqual(
      [local.closedPorts, factory.forwarded()],
      [[3001, 4001], []],
    );
  });

  it('probes all the forwards together: many that hang end at one bound, not one bound each', async () => {
    const {factory, clock} = fixture();
    await factory.forward({remotePort: 1, localPort: 11});
    await factory.forward({remotePort: 2, localPort: 12});
    await factory.forward({remotePort: 3, localPort: 13});
    const pending = factory.reconnect(new FakeDialer(['hang']));
    await settled();
    clock.advance(10_000);
    await settled();
    deepStrictEqual((await pending).failed.length, 3);
  });
});

describe('a forward whose listener fails after listening', () => {
  async function oneFailed(): Promise<Fixture> {
    const made = fixture();
    await made.factory.forward({remotePort: 3000, localPort: 3001});
    await made.factory.forward({remotePort: 4000, localPort: 4001});
    made.local.fail(3001, 'accept failed');
    return made;
  }

  it('#253 Q1: leaves the list', async () => {
    const {factory} = await oneFailed();
    deepStrictEqual(factory.forwarded(), [{remotePort: 4000, localPort: 4001}]);
  });

  it('#253 Q1: is not part of the next reconnection', async () => {
    const {factory} = await oneFailed();
    const replacement = new FakeDialer();
    const report = await factory.reconnect(replacement);
    deepStrictEqual(
      [report, replacement.dialed],
      [
        {revived: [{remotePort: 4000, localPort: 4001}], failed: []},
        [{kind: 'port', port: 4000}],
      ],
    );
  });

  it('#253 Q1: is in neither list when it ends while the probes run', async () => {
    const {factory, local} = fixture();
    await factory.forward({remotePort: 3000, localPort: 3001});
    const replacement = new FakeDialer(['later']);
    const reconnecting = factory.reconnect(replacement);
    await settled();
    local.fail(3001, 'accept failed');
    replacement.openNext();
    deepStrictEqual(
      [await reconnecting, factory.forwarded()],
      [{revived: [], failed: []}, []],
    );
  });
});
