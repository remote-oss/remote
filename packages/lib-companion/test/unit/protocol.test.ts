import {deepStrictEqual, strictEqual} from 'node:assert';
import {
  CALL_LIMIT_MILLISECONDS,
  type CallOutcome,
  type CommandBus,
  type Endpoint,
  type ReadOutcome,
  type Registration,
  type Timers,
  type UnavailableCause,
  type VersionMismatch,
  createProtocol,
  readActiveFoldersPush,
  readDeleteRequest,
  readEnvelope,
  readHostnames,
  writeEnvelope,
  writeHostnames,
} from '../../src/index.ts';

const HOSTS = 'remote-internal.getConfiguredHostnames';
const ACTIVE_FOLDERS = 'remote-internal.setActiveFolders';
const ENVELOPE = writeEnvelope();
const MAJOR_TWO = {interfaceVersion: {major: 2, minor: 0}};

/** How the fake bus answers a command. */
type Behaviour = () => PromiseLike<unknown>;

/** A fake command bus that records its calls and its registrations. */
interface FakeBus extends CommandBus {
  calls: unknown[][];
  registered: Array<{
    commandId: string;
    callback: (...given: unknown[]) => unknown;
  }>;
  registration: Registration;
}

function busAnswering(behaviour: Behaviour): FakeBus {
  const registration: Registration = {dispose: () => undefined};
  const fake: FakeBus = {
    calls: [],
    registered: [],
    registration,
    executeCommand: (...given) => {
      fake.calls.push(given);
      return behaviour();
    },
    registerCommand: (commandId, callback) => {
      fake.registered.push({commandId, callback});
      return registration;
    },
  };
  return fake;
}

function resolving(value: unknown): Behaviour {
  return () => Promise.resolve(value);
}

function rejecting(reason: unknown): Behaviour {
  // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a bus that rejects with a string, on purpose
  return () => Promise.reject(reason);
}

function pending(): Behaviour {
  return () => new Promise<unknown>(() => undefined);
}

function throwing(reason: unknown): Behaviour {
  return () => {
    throw reason;
  };
}

/** A clock that runs a callback when its time has come. */
interface ManualClock extends Timers {
  advance(milliseconds: number): void;
  pending(): number;
}

function manualClock(): ManualClock {
  let now = 0;
  const timers = new Map<number, {dueAt: number; callback: () => void}>();
  let counter = 0;
  return {
    setTimer: (callback, milliseconds) => {
      counter += 1;
      timers.set(counter, {dueAt: now + milliseconds, callback});
      return counter;
    },
    clearTimer: handle => {
      timers.delete(handle as number);
    },
    advance: milliseconds => {
      now += milliseconds;
      for (const [handle, timer] of [...timers]) {
        if (timer.dueAt <= now) {
          timers.delete(handle);
          timer.callback();
        }
      }
    },
    pending: () => timers.size,
  };
}

/** The protocol over a fake bus and the manual clock, with a hook that records the mismatches. */
function protocolOver(behaviour: Behaviour, withHook = true) {
  const commands = busAnswering(behaviour);
  const clock = manualClock();
  const mismatches: VersionMismatch[] = [];
  const protocol = createProtocol({
    // eslint-disable-next-line id-length -- the protocol's option is named bus
    bus: commands,
    timers: clock,
    ...(withHook
      ? {
          onVersionMismatch: (mismatch: VersionMismatch) => {
            mismatches.push(mismatch);
          },
        }
      : {}),
  });
  return {commands, clock, mismatches, protocol};
}

/** Runs `work` and gives the unhandled rejections seen by the end of a turn of the event loop. */
async function unhandledDuring(work: () => Promise<void>): Promise<unknown[]> {
  const seen: unknown[] = [];
  function listen(reason: unknown): void {
    seen.push(reason);
  }
  process.on('unhandledRejection', listen);
  try {
    await work();
    await new Promise(resolve => setImmediate(resolve));
  } finally {
    process.off('unhandledRejection', listen);
  }
  return seen;
}

/** A command whose answer the test gives when it likes. */
interface Deferred {
  behaviour: Behaviour;
  answer(value: unknown): void;
  fail(reason: Error): void;
}

function deferred(): Deferred {
  const handlers: {
    resolve?: (value: unknown) => void;
    reject?: (reason: Error) => void;
  } = {};
  const promise = new Promise<unknown>((resolve, reject) => {
    handlers.resolve = resolve;
    handlers.reject = reject;
  });
  return {
    behaviour: () => promise,
    answer: value => handlers.resolve?.(value),
    fail: reason => handlers.reject?.(reason),
  };
}

/** Whether a promise is still pending after the microtasks have run. */
async function stillPending(promise: Promise<unknown>): Promise<boolean> {
  return (
    (await Promise.race([promise, Promise.resolve('marker')])) === 'marker'
  );
}

function callHosts(over: ReturnType<typeof protocolOver>) {
  return over.protocol.call(HOSTS, ENVELOPE, readHostnames);
}

function unavailable(cause: UnavailableCause): CallOutcome<never> {
  return {status: 'unavailable', cause};
}

describe('the call protocol: call', () => {
  it('F-5902.5.rules: an answer that fits is read, and the call used the bus once', async () => {
    const answer = writeHostnames({hostnames: ['a', 'b']});
    const over = protocolOver(resolving(answer));
    const outcome = await callHosts(over);
    deepStrictEqual(
      [
        outcome,
        over.commands.calls.length,
        over.commands.calls[0]?.[1] === ENVELOPE,
        over.clock.pending(),
      ],
      [
        {
          status: 'answered',
          value: {
            interfaceVersion: {major: 1, minor: 0},
            hostnames: ['a', 'b'],
          },
        },
        1,
        true,
        0,
      ],
    );
  });

  it('F-5902.AC-15: a call that is not answered times out at the limit and not before', async () => {
    const over = protocolOver(pending());
    const outcome = callHosts(over);
    over.clock.advance(CALL_LIMIT_MILLISECONDS - 1);
    const early = await stillPending(outcome);
    over.clock.advance(1);
    deepStrictEqual([early, await outcome], [true, unavailable('timeout')]);
  });

  for (const [name, settleLate] of [
    [
      'a valid answer',
      (gate: Deferred) => {
        gate.answer(writeHostnames({hostnames: ['a']}));
      },
    ],
    [
      'a rejection',
      (gate: Deferred) => {
        gate.fail(new Error('late'));
      },
    ],
  ] as const) {
    it(`F-5902.AC-15: ${name} after the timeout changes nothing and raises no unhandled rejection`, async () => {
      const gate = deferred();
      const over = protocolOver(gate.behaviour);
      let outcome: CallOutcome<unknown> | undefined;
      const seen = await unhandledDuring(async () => {
        const call = callHosts(over);
        over.clock.advance(CALL_LIMIT_MILLISECONDS);
        settleLate(gate);
        outcome = await call;
      });
      deepStrictEqual([outcome, seen], [unavailable('timeout'), []]);
    });
  }

  for (const [name, behaviour] of [
    ['an Error', rejecting(new Error('boom'))],
    ['a string', rejecting('boom')],
    ['a synchronous throw', throwing(new Error('sync'))],
  ] as const) {
    it(`F-5902.AC-5: ${name} from the bus is the cause rejected, with no timer left`, async () => {
      const over = protocolOver(behaviour);
      deepStrictEqual(
        [await callHosts(over), over.clock.pending()],
        [unavailable('rejected'), 0],
      );
    });
  }

  it('F-5902.AC-5: the editor saying the command is not found is the cause notRegistered', async () => {
    const over = protocolOver(
      rejecting(new Error(`command '${HOSTS}' not found`)),
    );
    deepStrictEqual(await callHosts(over), unavailable('notRegistered'));
  });

  it('F-5902.AC-5: not found for another command is the cause rejected', async () => {
    const over = protocolOver(
      rejecting(new Error("command 'remote-internal.other' not found")),
    );
    deepStrictEqual(await callHosts(over), unavailable('rejected'));
  });

  for (const answer of [
    undefined,
    {hostnames: ['a']},
    {interfaceVersion: {major: '1', minor: 0}, hostnames: []},
  ]) {
    it(`F-5902.5.foreign: the answer ${JSON.stringify(answer)} is the cause foreignPayload and tells the hook nothing`, async () => {
      const over = protocolOver(resolving(answer));
      deepStrictEqual(
        [await callHosts(over), over.mismatches],
        [unavailable('foreignPayload'), []],
      );
    });
  }

  it('F-5902.AC-32: the first unknown major tells the hook once, whatever comes after', async () => {
    const first = protocolOver(resolving({...MAJOR_TWO, hostnames: ['a']}));
    const outcomes = [await callHosts(first)];
    const third = {interfaceVersion: {major: 3, minor: 0}, hostnames: []};
    first.commands.executeCommand = (...given) => {
      first.commands.calls.push(given);
      return Promise.resolve(third);
    };
    outcomes.push(await callHosts(first));
    deepStrictEqual(
      [outcomes, first.mismatches],
      [
        [unavailable('unknownMajor'), unavailable('unknownMajor')],
        [{commandId: HOSTS, receivedMajor: 2, ownMajor: 1}],
      ],
    );
  });

  it('F-5902.AC-32: a protocol without a hook gives the cause unknownMajor and throws nothing', async () => {
    const over = protocolOver(resolving({...MAJOR_TWO, hostnames: []}), false);
    deepStrictEqual(await callHosts(over), unavailable('unknownMajor'));
  });

  it('F-5902.5.rules: a late answer of an unknown major after a timeout does not tell the hook', async () => {
    const gate = deferred();
    const over = protocolOver(gate.behaviour);
    const outcome = callHosts(over);
    over.clock.advance(CALL_LIMIT_MILLISECONDS);
    gate.answer({...MAJOR_TWO, hostnames: []});
    await outcome;
    await new Promise(resolve => setImmediate(resolve));
    deepStrictEqual(over.mismatches, []);
  });

  it('F-5902.5.rules: the limit is ten seconds', () => {
    strictEqual(CALL_LIMIT_MILLISECONDS, 10000);
  });
});

/** A query endpoint on HOSTS whose handler records its requests and gives `result`. */
function hostsEndpoint(
  requests: unknown[],
  result: unknown,
): Endpoint<unknown> {
  return {
    commandId: HOSTS,
    kind: 'query',
    read: readEnvelope,
    handle: request => {
      requests.push(request);
      return result;
    },
    empty: () => writeHostnames({hostnames: []}),
  };
}

describe('the call protocol: serve', () => {
  it('F-5902.5.rules: a valid argument reaches the handler, whose result is returned itself', () => {
    const result = {marker: 'result'};
    const requests: unknown[] = [];
    const over = protocolOver(pending());
    const registration = over.protocol.serve(hostsEndpoint(requests, result));
    const callback = over.commands.registered[0]?.callback ?? (() => undefined);
    deepStrictEqual(
      [
        registration === over.commands.registration,
        callback(ENVELOPE) === result,
        callback(ENVELOPE, 'extra') === result,
        requests,
      ],
      [
        true,
        true,
        true,
        [
          {interfaceVersion: {major: 1, minor: 0}},
          {interfaceVersion: {major: 1, minor: 0}},
        ],
      ],
    );
  });

  it('F-5902.5.rules: a change endpoint returns the promise of its handler itself', () => {
    const promise = Promise.resolve('done');
    const over = protocolOver(pending());
    over.protocol.serve({
      commandId: 'remote-internal.openRemoteSshTarget',
      kind: 'change',
      read: readEnvelope,
      handle: () => promise,
    });
    strictEqual(over.commands.registered[0]?.callback(ENVELOPE), promise);
  });

  for (const argument of [undefined, {}, 'text', MAJOR_TWO]) {
    it(`F-5902.AC-11: a query refused for ${JSON.stringify(argument)} gets the empty result and no handler runs`, () => {
      const requests: unknown[] = [];
      const over = protocolOver(pending());
      over.protocol.serve(hostsEndpoint(requests, 'unused'));
      deepStrictEqual(
        [over.commands.registered[0]?.callback(argument), requests],
        [writeHostnames({hostnames: []}), []],
      );
    });
  }

  const REFUSED_FOR_CHANGES = [
    undefined,
    {hostKey: 'h', path: '/p'},
    {interfaceVersion: {major: 2, minor: 0}, outcome: 'none'},
  ];
  const CHANGE_ENDPOINTS: Array<
    ['change' | 'push', (payload: unknown) => ReadOutcome<unknown>]
  > = [
    ['change', readDeleteRequest],
    ['push', readActiveFoldersPush],
  ];
  for (const [kind, read] of CHANGE_ENDPOINTS) {
    for (const argument of REFUSED_FOR_CHANGES) {
      it(`F-5902.AC-11: a ${kind} refused for ${JSON.stringify(argument)} returns nothing and no handler runs`, () => {
        const requests: unknown[] = [];
        const over = protocolOver(pending());
        over.protocol.serve({
          commandId: ACTIVE_FOLDERS,
          kind,
          read,
          handle: request => {
            requests.push(request);
          },
        });
        deepStrictEqual(
          [over.commands.registered[0]?.callback(argument), requests],
          [undefined, []],
        );
      });
    }
  }

  it('F-5902.5.rules: served arguments of an unknown major tell the hook once, the first', () => {
    const over = protocolOver(pending());
    over.protocol.serve(hostsEndpoint([], 'unused'));
    const callback = over.commands.registered[0]?.callback ?? (() => undefined);
    callback(MAJOR_TWO);
    callback({interfaceVersion: {major: 5, minor: 0}});
    callback({});
    deepStrictEqual(over.mismatches, [
      {commandId: HOSTS, receivedMajor: 2, ownMajor: 1},
    ]);
  });

  it('F-5902.5.rules: each protocol tells its own hook once, for a call and a served argument together', async () => {
    const counts: number[] = [];
    for (let round = 0; round < 2; round += 1) {
      const over = protocolOver(resolving({...MAJOR_TWO, hostnames: []}));
      over.protocol.serve(hostsEndpoint([], 'unused'));
      await callHosts(over);
      over.commands.registered[0]?.callback(MAJOR_TWO);
      counts.push(over.mismatches.length);
    }
    deepStrictEqual(counts, [1, 1]);
  });
});

describe('the call protocol: fireAndForget', () => {
  for (const [name, behaviour] of [
    ['resolves', resolving(undefined)],
    ['rejects', rejecting(new Error('x'))],
    ['throws', throwing(new Error('x'))],
  ] as const) {
    it(`F-3906.7: a push when the bus ${name} returns nothing, throws nothing and leaves no timer`, async () => {
      const over = protocolOver(behaviour);
      let returned: unknown = 'not called';
      const seen = await unhandledDuring(() => {
        const send: () => unknown = over.protocol.fireAndForget.bind(
          over.protocol,
          ACTIVE_FOLDERS,
          ENVELOPE,
        );
        returned = send();
        return Promise.resolve();
      });
      deepStrictEqual(
        [
          returned,
          seen,
          over.commands.calls[0]?.[0],
          over.commands.calls[0]?.[1] === ENVELOPE,
          over.commands.calls.length,
          over.clock.pending(),
        ],
        [undefined, [], ACTIVE_FOLDERS, true, 1, 0],
      );
    });
  }
});
