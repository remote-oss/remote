import {deepStrictEqual} from 'node:assert';
import {TUNNEL_WAIT_LIMITS, type PortProber} from 'lib-forwarding';
import {FakeLocalPort} from 'lib-forwarding/testing/fake-network';
import {FakeClock} from 'lib-helper/testing/fake-clock';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {openHostRelay} from '../../src/connect/host-relay.ts';
import {fakeEngine, type SpawnPlan} from './fake-engine.ts';

/** A prober that finds every port free except those named. */
function proberBusy(...busy: number[]): PortProber {
  return {
    probe: port => Promise.resolve(busy.includes(port) ? 'open' : 'refused'),
  };
}

/** The relay over fakes: the port it asks for is 41000. */
function relayOver(
  options: {
    prober?: PortProber;
    local?: FakeLocalPort;
    plans?: SpawnPlan[];
  } = {},
) {
  const engine = fakeEngine(...(options.plans ?? []));
  const local = options.local ?? new FakeLocalPort();
  const clock = new FakeClock();
  const sink = new MemorySink();
  const closes: string[] = [];
  const opening = openHostRelay(
    {
      local,
      prober: options.prober ?? proberBusy(),
      scheduler: clock.scheduler(),
      logger: createLogger(sink, {minimumLevel: () => 'info'}),
    },
    {
      engine,
      containerId: 'c1',
      remoteUser: 'node',
      nodePath: '/vscode/node',
      relayPath: '/home/node/relay.js',
      containerPort: 41000,
      onConnectionClosed: () => {
        closes.push('closed');
      },
    },
  );
  return {engine, local, clock, sink, closes, opening};
}

function tick(): Promise<unknown> {
  return new Promise(resolve => setImmediate(resolve));
}

describe('the host relay (card containers-08)', () => {
  it('F-0502 BR-3: the container port is the host port when the host has it free', async () => {
    const seen = relayOver();
    const relay = await seen.opening;
    deepStrictEqual(
      [relay.kind === 'open' && relay.hostPort, seen.local.listened],
      [41000, [41000]],
    );
  });

  it('F-0502 BR-3: the log names the host port and the container port', async () => {
    const seen = relayOver();
    await seen.opening;
    deepStrictEqual(
      seen.sink.lines.map(line => line.message),
      ['forwarding local port 41000 to container port 41000'],
    );
  });

  it('F-0502 BR-3, AC-42: a host that has the port busy gets another free port, and the log names both', async () => {
    const seen = relayOver({prober: proberBusy(41000)});
    const relay = await seen.opening;
    const hostPort = relay.kind === 'open' ? relay.hostPort : 0;
    deepStrictEqual(
      [
        hostPort !== 41000,
        seen.local.listened,
        seen.sink.lines.map(line => line.message),
      ],
      [
        true,
        [hostPort],
        [`forwarding local port ${String(hostPort)} to container port 41000`],
      ],
    );
  });

  it('F-0502 BR-3: a host with no free port at all fails as relayFailed', async () => {
    const seen = relayOver({
      prober: {probe: () => Promise.resolve('open')},
    });
    const relay = await seen.opening;
    deepStrictEqual(
      [relay.kind, relay.kind === 'failed' && relay.failure.kind],
      ['failed', 'relayFailed'],
    );
  });

  it('F-0502 BR-3: a listener that cannot be opened fails as relayFailed', async () => {
    const seen = relayOver({local: new FakeLocalPort('fail')});
    const relay = await seen.opening;
    deepStrictEqual(
      [relay.kind, relay.kind === 'failed' && relay.failure.kind],
      ['failed', 'relayFailed'],
    );
  });

  it('F-0502 BR-3: a tunnel that never reaches the container fails as relayFailed, and the port is closed again', async () => {
    const seen = relayOver({
      plans: Array.from({length: 40}, () => ({failure: 'no docker'})),
    });
    await tick();
    seen.clock.advance(TUNNEL_WAIT_LIMITS.readyMilliseconds);
    const relay = await seen.opening;
    deepStrictEqual(
      [relay.kind === 'failed' && relay.failure.kind, seen.local.closedPorts],
      ['relayFailed', [41000]],
    );
  });

  it('F-0502 BR-8: the readiness probe does not count as a relayed connection ending', async () => {
    const seen = relayOver();
    await seen.opening;
    await tick();
    await tick();
    deepStrictEqual(seen.closes, []);
  });

  it('F-0502 BR-8: a relayed connection that ends is told once the relay is open', async () => {
    const seen = relayOver({plans: [() => undefined, () => undefined]});
    await seen.opening;
    seen.local.accept(41000);
    await tick();
    seen.engine.processes.at(-1)?.exit(0);
    await tick();
    deepStrictEqual(seen.closes, ['closed']);
  });

  it('F-0502 7.E15: a listener that fails by itself is told to the one who asked', async () => {
    const seen = relayOver();
    const relay = await seen.opening;
    const told: string[] = [];
    if (relay.kind === 'open') {
      relay.onClosed(() => {
        told.push('closed');
      });
    }
    seen.local.fail(41000, 'gone');
    deepStrictEqual(told, ['closed']);
  });

  it('contracts §2: closing the relay closes the listener', async () => {
    const seen = relayOver();
    const relay = await seen.opening;
    if (relay.kind === 'open') {
      relay.close();
    }
    deepStrictEqual(seen.local.closedPorts, [41000]);
  });
});
