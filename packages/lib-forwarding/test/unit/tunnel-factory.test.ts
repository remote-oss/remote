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
});
