import {deepStrictEqual} from 'node:assert';
import type {PortChoice} from '../../src/pipeline/port-choice.ts';
import {FakeClock} from 'lib-helper/testing/fake-clock';
import type {TunnelSettings} from 'lib-forwarding';
import {
  type DialAnswer,
  FakeDialer,
  FakeLocalPort,
} from 'lib-forwarding/testing/fake-network';
import {createLogger, type Level} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {RecordingTerminals} from 'lib-ssh/testing/recording-terminal';
import {openTunnelStep} from '../../src/pipeline/tunnel-step.ts';
import {emptyRecording, INPUT, leaseOf, STARTED} from './pipeline.fixture.ts';

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

/** What only the terminal paths use; the SOCKS path must not touch any of it. */
const TERMINAL_NOT_USED = {
  terminals: new RecordingTerminals(),
  tunnelInvocation: (): never => {
    throw new Error('the SOCKS path starts no ssh');
  },
  attachQuestions: (): never => {
    throw new Error('the SOCKS path asks no question');
  },
  tunnelInput: (): undefined => undefined,
  revealLoginTerminals: (): boolean => false,
  connectWait: (): never => {
    throw new Error('the SOCKS path has no connect wait');
  },
};

/** A tunnel step over fakes; `dialScript` answers the probes through the relay, `port` is the local port offered. */
function stepWith(
  options: {
    settings?: TunnelSettings;
    dialScript?: readonly DialAnswer[];
    port?: number | undefined;
    busyRange?: {first: number; last: number};
    onWaiting?: () => void;
    cancellation?: AbortSignal;
    limits?: typeof LIMITS;
  } = {},
): {
  open: () => ReturnType<ReturnType<typeof openTunnelStep>['openTunnel']>;
  local: FakeLocalPort;
  dialer: FakeDialer;
  socksPorts: number[];
  sink: MemorySink;
  clock: FakeClock;
  /** How often the step told the window that the host refuses the forwarding, and took the bound off. */
  refused: number[];
  disarmed: number[];
} {
  const clock = new FakeClock();
  const local = new FakeLocalPort();
  const dialer = new FakeDialer(options.dialScript ?? ['work']);
  const socksPorts: number[] = [];
  const refused: number[] = [];
  const disarmed: number[] = [];
  const sink = new MemorySink();
  const port = 'port' in options ? options.port : 50000;
  const choice: PortChoice =
    options.busyRange !== undefined
      ? {busyRange: options.busyRange}
      : port === undefined
        ? {noPort: true}
        : {port};
  const step = openTunnelStep({
    settings: () => options.settings ?? SOCKS_SETTINGS,
    local,
    scheduler: clock.scheduler(),
    limits: options.limits ?? LIMITS,
    dialerFor: socksPort => {
      socksPorts.push(socksPort);
      return dialer;
    },
    chooseLocalPort: () => Promise.resolve(choice),
    environment: () => ENVIRONMENT,
    forwardRefused: () => {
      refused.push(1);
    },
    ...TERMINAL_NOT_USED,
    logger: createLogger(sink, {minimumLevel: (): Level => 'info'}),
  });
  const lease = leaseOf(emptyRecording());
  return {
    open: () =>
      step.openTunnel(
        INPUT,
        lease,
        STARTED.server,
        options.onWaiting ?? (() => undefined),
        options.cancellation ?? new AbortController().signal,
        () => {
          disarmed.push(1);
        },
      ),
    local,
    dialer,
    socksPorts,
    sink,
    clock,
    refused,
    disarmed,
  };
}

/** Lets the clock run past the wait of the relay, a turn of the event loop at a time. */
async function pastTheBound(clock: FakeClock): Promise<void> {
  for (let round = 0; round < 400; round++) {
    await Promise.resolve();
    clock.advance(50);
  }
}

describe('the step that opens the window tunnel', () => {
  it('connect-106: a relay that closes every probe before its reply tells the window once, takes the bound off and waits until the connect is cancelled', async () => {
    const controller = new AbortController();
    const {open, clock, refused, disarmed} = stepWith({
      dialScript: ['closedBeforeReply'],
      cancellation: controller.signal,
      limits: {...LIMITS, readyMilliseconds: 10_000, retryMilliseconds: 100},
    });
    let result: Awaited<ReturnType<typeof open>> | undefined;
    const pending = open().then(value => {
      result = value;
    });
    await pastTheBound(clock);
    const before = [refused.length, disarmed.length, result];
    controller.abort();
    await pending;
    deepStrictEqual(
      [before, result],
      [[1, 1, undefined], {kind: 'failed', failure: {kind: 'cancelled'}}],
    );
  });

  it('connect-106: probes that fail in another way are the failure of an unready tunnel, with no notice and the bound kept', async () => {
    const {open, clock, refused, disarmed} = stepWith({dialScript: ['fail']});
    const pending = open();
    await pastTheBound(clock);
    deepStrictEqual(
      [(await pending).kind, refused.length, disarmed.length],
      ['failed', 0, 0],
    );
  });

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

  it('F-2507 6.3, BR-9: the window gets the environment, and neither a tunnel factory nor tunnel features', async () => {
    const result = await stepWith().open();
    deepStrictEqual(
      result.kind === 'done'
        ? [
            result.value.opened.extensionHostEnv,
            'tunnelFactory' in result.value.opened,
            'tunnelFeatures' in result.value.opened,
          ]
        : result,
      [{SSH_AUTH_SOCK: '/tmp/agent'}, false, false],
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

  it('F-2104.AC-14: a busy preferred range fails with the reason of its text, over the relay', async () => {
    const result = await stepWith({
      busyRange: {first: 41060, last: 41061},
    }).open();
    deepStrictEqual(result, {
      kind: 'failed',
      failure: {
        kind: 'unknown',
        reason: {
          id: 'S067',
          values: [
            {id: 'S073', values: [{id: 'S095', values: ['41060', '41061']}]},
          ],
        },
      },
    });
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

  /** An open tunnel with the onClosed listener it heard, for the rows of the end's contract. */
  async function openedWithHeard() {
    const {open, local} = stepWith();
    const result = await open();
    if (result.kind !== 'done') {
      throw new Error('the tunnel did not open');
    }
    const heard: string[] = [];
    result.value.onClosed(detail => {
      heard.push(detail);
    });
    return {tunnel: result.value, heard, local};
  }

  it('contracts §W2: a failed relay listener ends the tunnel, and its onClosed listener hears the reason once', async () => {
    const {heard, local} = await openedWithHeard();
    local.fail(50000, 'the relay listener failed');
    local.fail(50000, 'the relay listener failed');
    deepStrictEqual(heard, ['the relay listener failed']);
  });

  it('contracts §W2: a close the caller asked for never calls its onClosed listener', async () => {
    const {tunnel, heard, local} = await openedWithHeard();
    tunnel.close();
    local.fail(50000, 'the relay listener failed');
    deepStrictEqual(heard, []);
  });
});
