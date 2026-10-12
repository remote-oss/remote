import {deepStrictEqual} from 'node:assert';
import {FakeClock} from 'lib-helper/testing/fake-clock';
import type {TunnelSettings} from 'lib-forwarding';
import {
  type DialAnswer,
  FakeDialer,
  FakeLocalPort,
} from 'lib-forwarding/testing/fake-network';
import {createLogger, type Level} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {openTunnelStep} from '../../src/pipeline/tunnel-step.ts';
import {INPUT, leaseOf, STARTED} from './pipeline.fixture.ts';

const SOCKS_SETTINGS: TunnelSettings = {
  listenOnSocket: false,
  useLocalServer: true,
  enableDynamicForwarding: true,
};

const LIMITS = {
  readyMilliseconds: 50,
  retryMilliseconds: 10,
  heldBytesMaximum: 8,
};

const ENVIRONMENT = {
  extensionHostEnv: {SSH_AUTH_SOCK: '/tmp/agent'},
  environmentTunnels: [],
};

/** A tunnel step over fakes; `dialScript` answers the probes through the relay, `port` is the local port offered. */
function stepWith(
  options: {
    settings?: TunnelSettings;
    dialScript?: readonly DialAnswer[];
    port?: number | undefined;
    onWaiting?: () => void;
  } = {},
): {
  open: () => ReturnType<ReturnType<typeof openTunnelStep>>;
  local: FakeLocalPort;
  dialer: FakeDialer;
  socksPorts: number[];
  sink: MemorySink;
  clock: FakeClock;
} {
  const clock = new FakeClock();
  const local = new FakeLocalPort();
  const dialer = new FakeDialer(options.dialScript ?? ['work']);
  const socksPorts: number[] = [];
  const sink = new MemorySink();
  const port = 'port' in options ? options.port : 50000;
  const step = openTunnelStep({
    settings: () => options.settings ?? SOCKS_SETTINGS,
    local,
    scheduler: clock.scheduler(),
    limits: LIMITS,
    dialerFor: socksPort => {
      socksPorts.push(socksPort);
      return dialer;
    },
    chooseLocalPort: () => Promise.resolve(port),
    environment: () => ENVIRONMENT,
    logger: createLogger(sink, {minimumLevel: (): Level => 'info'}),
  });
  const lease = leaseOf({
    calls: [],
    releases: 0,
    tunnelCloses: 0,
    records: [],
    phases: [],
  });
  return {
    open: () =>
      step(
        INPUT,
        lease,
        STARTED.server,
        options.onWaiting ?? (() => undefined),
        new AbortController().signal,
      ),
    local,
    dialer,
    socksPorts,
    sink,
    clock,
  };
}

describe('the step that opens the window tunnel', () => {
  it('F-2104 BR-1: the socks path gives the window the local address', async () => {
    const result = await stepWith().open();
    deepStrictEqual(
      result.kind === 'done' ? result.value.opened.address : result,
      {host: '127.0.0.1', port: 50000},
    );
  });

  it("F-2104 BR-1: it dials the server port through the connection's SOCKS relay", async () => {
    const {open, dialer, socksPorts} = stepWith();
    await open();
    deepStrictEqual(
      [socksPorts, dialer.dialed[0]],
      [[1080], {kind: 'port', port: 4321}],
    );
  });

  it('contracts §3.2: the window gets the environment and a tunnel factory with its features', async () => {
    const result = await stepWith().open();
    deepStrictEqual(
      result.kind === 'done'
        ? [
            result.value.opened.extensionHostEnv,
            result.value.opened.tunnelFeatures,
            typeof result.value.opened.tunnelFactory,
          ]
        : result,
      [
        {SSH_AUTH_SOCK: '/tmp/agent'},
        {elevation: false, privacy: ['private']},
        'object',
      ],
    );
  });

  it('F-2104: closing the tunnel stops listening on the window port', async () => {
    const {open, local} = stepWith();
    const result = await open();
    if (result.kind === 'done') {
      result.value.close();
    }
    deepStrictEqual(local.closedPorts, [50000]);
  });

  it('F-2304 S158: the step tells its caller when the relay goes on waiting', async () => {
    let waits = 0;
    const {open, clock} = stepWith({
      dialScript: ['fail', 'work'],
      onWaiting: () => {
        waits += 1;
      },
    });
    const pending = open();
    for (let round = 0; round < 10; round++) {
      await Promise.resolve();
      clock.advance(10);
    }
    deepStrictEqual([(await pending).kind, waits], ['done', 1]);
  });

  it('F-2104: closing the tunnel twice closes the window port once', async () => {
    const {open, local} = stepWith();
    const result = await open();
    if (result.kind === 'done') {
      result.value.close();
      result.value.close();
    }
    deepStrictEqual(local.closedPorts, [50000]);
  });

  it('F-2104 7.E1: no free local port fails without a reason', async () => {
    const result = await stepWith({port: undefined}).open();
    deepStrictEqual(result, {kind: 'failed', failure: {kind: 'unknown'}});
  });

  it('F-2104 BR-10: a tunnel that never becomes ready fails without a reason', async () => {
    const {open, clock} = stepWith({dialScript: ['fail']});
    const pending = open();
    for (let round = 0; round < 10; round++) {
      await Promise.resolve();
      clock.advance(10);
    }
    deepStrictEqual(await pending, {
      kind: 'failed',
      failure: {kind: 'unknown'},
    });
  });

  it('#253 Q5: the socket path is not built yet: it fails without a reason', async () => {
    const result = await stepWith({
      settings: {...SOCKS_SETTINGS, listenOnSocket: true},
    }).open();
    deepStrictEqual(result, {kind: 'failed', failure: {kind: 'unknown'}});
  });

  it('#253 Q5: the second-ssh path is not built yet: the log names it', async () => {
    const {open, sink} = stepWith({
      settings: {
        listenOnSocket: false,
        useLocalServer: false,
        enableDynamicForwarding: false,
      },
    });
    await open();
    deepStrictEqual(
      sink.lines.map(line => line.message),
      ["the window tunnel's secondSsh path is not built yet"],
    );
  });
});
