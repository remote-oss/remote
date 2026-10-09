import {deepStrictEqual} from 'node:assert';
import {FakeClock} from 'lib-helper/testing/fake-clock';
import {socksDialer, type Duplex} from '../../src/index.ts';
import {
  type Answer,
  type FakeConnection,
  FakeLocalPort,
} from '../../src/testing/fake-network.ts';
import {advanced, settled} from './timing.fixture.ts';

const GREETING = Uint8Array.of(5, 1, 0);
const GREETING_ANSWER = Uint8Array.of(5, 0);
const REQUEST_FOR_4321 = Uint8Array.of(5, 1, 0, 1, 127, 0, 0, 1, 16, 225);
const SUCCEEDED = Uint8Array.of(5, 0, 0, 1, 0, 0, 0, 0, 0, 0);

interface Fixture {
  clock: FakeClock;
  local: FakeLocalPort;
  dial: () => Promise<Duplex>;
  relay: () => FakeConnection | undefined;
}

function fixture(connectScript: readonly Answer[] = ['work']): Fixture {
  const clock = new FakeClock();
  const local = new FakeLocalPort('work', connectScript);
  const dialer = socksDialer({
    local,
    socksPort: 41000,
    scheduler: clock.scheduler(),
    handshakeMilliseconds: 5000,
  });
  return {
    clock,
    local,
    dial: () => dialer.dial({kind: 'port', port: 4321}),
    relay: () => local.probes[0],
  };
}

/** What a dial settles to, so that a test can look at a rejection without an unhandled one. */
function outcomeOf(promise: Promise<Duplex>): {
  state: 'pending' | 'open' | 'failed';
  reason?: string;
  stream?: Duplex;
} {
  const outcome: {
    state: 'pending' | 'open' | 'failed';
    reason?: string;
    stream?: Duplex;
  } = {state: 'pending'};
  promise.then(
    stream => {
      outcome.state = 'open';
      outcome.stream = stream;
    },
    (caught: unknown) => {
      outcome.state = 'failed';
      outcome.reason =
        caught instanceof Error ? caught.message : String(caught);
    },
  );
  return outcome;
}

/** Dials, lets the relay send `chunks` one after the other, and gives the outcome and whether the relay was closed. */
async function settledAfter(chunks: readonly Uint8Array[]): Promise<{
  state: 'pending' | 'open' | 'failed';
  outcome: ReturnType<typeof outcomeOf>;
  closed: boolean | undefined;
}> {
  const {dial, relay} = fixture();
  const outcome = outcomeOf(dial());
  await settled();
  for (const chunk of chunks) {
    relay()?.receive(chunk);
  }
  await settled();
  return {state: outcome.state, outcome, closed: relay()?.closed};
}

/** The relay accepts the greeting and then says the connection succeeded. */
async function established(
  relay: () => FakeConnection | undefined,
): Promise<void> {
  await settled();
  relay()?.receive(GREETING_ANSWER);
  relay()?.receive(SUCCEEDED);
  await settled();
}

describe('the dialer of the SOCKS relay', () => {
  it('connects to the relay port and greets it with no authentication', async () => {
    const {dial, local, relay} = fixture();
    outcomeOf(dial());
    await settled();
    deepStrictEqual([local.connected, relay()?.sent], [[41000], [GREETING]]);
  });

  it('asks for the target port on the host loopback once the relay accepts the greeting', async () => {
    const {dial, relay} = fixture();
    outcomeOf(dial());
    await settled();
    relay()?.receive(GREETING_ANSWER);
    deepStrictEqual(relay()?.sent, [GREETING, REQUEST_FOR_4321]);
  });

  it('opens the connection when the relay says it succeeded', async () => {
    const {dial, relay} = fixture();
    const outcome = outcomeOf(dial());
    await established(relay);
    deepStrictEqual(outcome.state, 'open');
  });

  it('passes what the caller sends on to the relay, after the handshake', async () => {
    const {dial, relay} = fixture();
    const outcome = outcomeOf(dial());
    await established(relay);
    outcome.stream?.send(Uint8Array.of(7, 8));
    deepStrictEqual(relay()?.sent.at(-1), Uint8Array.of(7, 8));
  });

  it('delivers the bytes that arrive after the reply, also those in the same chunk as the reply', async () => {
    const {dial, relay} = fixture();
    const outcome = outcomeOf(dial());
    await settled();
    relay()?.receive(GREETING_ANSWER);
    relay()?.receive(Uint8Array.of(...SUCCEEDED, 9, 9));
    await settled();
    const heard: Uint8Array[] = [];
    outcome.stream?.onData(chunk => {
      heard.push(chunk);
    });
    relay()?.receive(Uint8Array.of(1));
    deepStrictEqual(heard, [Uint8Array.of(9, 9), Uint8Array.of(1)]);
  });

  it('takes the greeting answer and the reply when they come in single bytes', async () => {
    deepStrictEqual(
      (
        await settledAfter(
          [...GREETING_ANSWER, ...SUCCEEDED].map(byte => Uint8Array.of(byte)),
        )
      ).state,
      'open',
    );
  });

  it('takes the greeting answer and the reply when they come together', async () => {
    deepStrictEqual(
      (await settledAfter([Uint8Array.of(...GREETING_ANSWER, ...SUCCEEDED)]))
        .state,
      'open',
    );
  });

  it('reads a reply that names an address by a name', async () => {
    deepStrictEqual(
      (
        await settledAfter([
          Uint8Array.of(...GREETING_ANSWER, 5, 0, 0, 3, 2, 104, 105, 0, 0),
        ])
      ).state,
      'open',
    );
  });

  it('waits for the length of a name when the reply has come only as far as its head', async () => {
    deepStrictEqual(
      (
        await settledAfter([
          Uint8Array.of(...GREETING_ANSWER, 5, 0, 0, 3),
          Uint8Array.of(2, 104, 105, 0, 0),
        ])
      ).state,
      'open',
    );
  });

  it('reads a reply that names an IPv6 address', async () => {
    deepStrictEqual(
      (
        await settledAfter([
          Uint8Array.of(
            ...GREETING_ANSWER,
            5,
            0,
            0,
            4,
            ...new Array<number>(16).fill(0),
            0,
            0,
          ),
        ])
      ).state,
      'open',
    );
  });

  it('fails, closing the relay, when it refuses to connect without authentication', async () => {
    const {outcome, closed} = await settledAfter([Uint8Array.of(5, 255)]);
    deepStrictEqual(
      [outcome.reason, closed],
      ['the relay refused to connect without authentication', true],
    );
  });

  it('fails with the relay reply code when it cannot connect to the target', async () => {
    const {outcome, closed} = await settledAfter([
      GREETING_ANSWER,
      Uint8Array.of(5, 5, 0, 1, 0, 0, 0, 0, 0, 0),
    ]);
    deepStrictEqual(
      [outcome.reason, closed],
      ['the relay could not connect: reply 5', true],
    );
  });

  it('fails when the reply names an address kind that is not known', async () => {
    const {outcome} = await settledAfter([
      Uint8Array.of(...GREETING_ANSWER, 5, 0, 0, 9),
    ]);
    deepStrictEqual(
      outcome.reason,
      'the relay answered with an address kind that is not known',
    );
  });

  it('fails when the relay closes the connection before the reply', async () => {
    const {dial, relay} = fixture();
    const outcome = outcomeOf(dial());
    await settled();
    relay()?.close();
    await settled();
    deepStrictEqual(outcome.reason, 'the relay closed the connection');
  });

  it('fails at the bound when the relay never answers, and closes it', async () => {
    const {dial, relay, clock} = fixture();
    const outcome = outcomeOf(dial());
    await advanced(clock, 5000);
    deepStrictEqual(
      [outcome.reason, relay()?.closed],
      ['the relay did not answer in time', true],
    );
  });

  it('does not fail at the bound when the connection opened in time', async () => {
    const {dial, relay, clock} = fixture();
    const outcome = outcomeOf(dial());
    await settled();
    relay()?.receive(GREETING_ANSWER);
    relay()?.receive(SUCCEEDED);
    await advanced(clock, 5000);
    deepStrictEqual([outcome.state, relay()?.closed], ['open', false]);
  });

  it('fails when the relay port cannot be reached', async () => {
    const {dial} = fixture(['fail']);
    const outcome = outcomeOf(dial());
    await settled();
    deepStrictEqual(outcome.reason, 'connection refused');
  });

  it('refuses a socket path, which the relay cannot reach', async () => {
    const clock = new FakeClock();
    const dialer = socksDialer({
      local: new FakeLocalPort(),
      socksPort: 41000,
      scheduler: clock.scheduler(),
      handshakeMilliseconds: 5000,
    });
    const outcome = outcomeOf(dialer.dial({kind: 'socket', path: '/run/s'}));
    await settled();
    deepStrictEqual(
      outcome.reason,
      'the SOCKS relay reaches a port, not a socket path',
    );
  });

  it('tells the listener when the relay closes after the connection opened, and closes the relay when asked', async () => {
    const {dial, relay} = fixture();
    const outcome = outcomeOf(dial());
    await established(relay);
    let told = 0;
    outcome.stream?.onClose(() => {
      told += 1;
    });
    outcome.stream?.close();
    deepStrictEqual([told, relay()?.closed], [1, true]);
  });

  it('passes the slow-side signals of the relay on: a full relay, its drain, a pause and a resume', async () => {
    const {dial, relay} = fixture();
    const outcome = outcomeOf(dial());
    await established(relay);
    const raised = relay();
    if (raised !== undefined) {
      raised.full = true;
    }
    const accepted = outcome.stream?.send(Uint8Array.of(1));
    let drained = 0;
    outcome.stream?.onDrain(() => {
      drained += 1;
    });
    raised?.drain();
    outcome.stream?.pause();
    const pausedHere = raised?.paused;
    outcome.stream?.resume();
    deepStrictEqual(
      [accepted, drained, pausedHere, raised?.paused],
      [false, 1, true, false],
    );
  });
});
