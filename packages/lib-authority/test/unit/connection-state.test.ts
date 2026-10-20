import {deepStrictEqual} from 'node:assert';
import {
  type Applied,
  ConnectionTracker,
  type ConnectionEvent,
  type CurrentConnection,
  type DecodedTarget,
} from '../../src/index.ts';

const FIRST: DecodedTarget = {
  family: 'ssh-remote',
  target: {kind: 'plain', text: 'first'},
  rawHostString: 'first',
};

const SECOND: DecodedTarget = {
  family: 'ssh-remote',
  target: {kind: 'plain', text: 'second'},
  rawHostString: 'second',
};

function start(target: DecodedTarget = FIRST, attempt = 1): ConnectionEvent {
  return {kind: 'resolveStarted', target, attempt};
}

const SUCCEEDED: ConnectionEvent = {kind: 'resolveSucceeded'};
const FAILED: ConnectionEvent = {kind: 'resolveFailed'};
const LOST: ConnectionEvent = {kind: 'transportLost'};
const CLOSED: ConnectionEvent = {kind: 'transportClosed'};

/** The tracker after the events, and what the last one reported. */
function after(...events: ConnectionEvent[]): {
  tracker: ConnectionTracker;
  last: Applied | undefined;
} {
  const tracker = new ConnectionTracker();
  let last: Applied | undefined;
  for (const event of events) {
    last = tracker.apply(event);
  }
  return {tracker, last};
}

function stateOf(...events: ConnectionEvent[]): string | undefined {
  return after(...events).tracker.current()?.state;
}

describe('the connection of a window (card authority-04)', () => {
  it('F-2304: before any resolve there is no connection', () => {
    deepStrictEqual(new ConnectionTracker().current(), undefined);
  });

  it('F-2304: a resolve that starts is resolving, with its target and attempt', () => {
    deepStrictEqual(after(start(FIRST, 1)).tracker.current(), {
      target: FIRST,
      state: 'resolving',
      attempt: 1,
    });
  });

  it('F-2304: starting a resolve is a change and settles nothing', () => {
    deepStrictEqual(after(start()).last, {
      changed: true,
      firstResolveSettled: false,
    });
  });

  it('F-2304: a resolve that succeeds is connected, and it is the first to settle', () => {
    const {tracker, last} = after(start(), SUCCEEDED);
    deepStrictEqual(
      [tracker.current()?.state, last],
      ['connected', {changed: true, firstResolveSettled: true}],
    );
  });

  it('F-2304: a second success changes nothing and settles nothing', () => {
    deepStrictEqual(after(start(), SUCCEEDED, SUCCEEDED).last, {
      changed: false,
      firstResolveSettled: false,
    });
  });

  it('F-2304: a resolve that fails is failed, and it is the first to settle', () => {
    const {tracker, last} = after(start(), FAILED);
    deepStrictEqual(
      [tracker.current()?.state, last],
      ['failed', {changed: true, firstResolveSettled: true}],
    );
  });

  it('F-2304: a retry after a failure connects with the new attempt', () => {
    deepStrictEqual(
      after(
        start(FIRST, 1),
        FAILED,
        start(FIRST, 2),
        SUCCEEDED,
      ).tracker.current(),
      {target: FIRST, state: 'connected', attempt: 2},
    );
  });

  it('F-2304: the second settle is not the first', () => {
    deepStrictEqual(
      after(start(FIRST, 1), FAILED, start(FIRST, 2), SUCCEEDED).last,
      {changed: true, firstResolveSettled: false},
    );
  });

  it('F-2505: a lost transport is transportLost', () => {
    deepStrictEqual(stateOf(start(), SUCCEEDED, LOST), 'transportLost');
  });

  it('F-2505: a closed transport after connecting is transportClosed', () => {
    deepStrictEqual(stateOf(start(), SUCCEEDED, CLOSED), 'transportClosed');
  });

  it('F-2505: a transport that was lost and then closed is transportClosed', () => {
    deepStrictEqual(
      stateOf(start(), SUCCEEDED, LOST, CLOSED),
      'transportClosed',
    );
  });

  it('F-2505: a new attempt after a lost transport is resolving with the new attempt', () => {
    deepStrictEqual(
      after(
        start(FIRST, 1),
        SUCCEEDED,
        LOST,
        start(FIRST, 2),
      ).tracker.current(),
      {target: FIRST, state: 'resolving', attempt: 2},
    );
  });

  it('F-2505: a new attempt after a closed transport may name another target', () => {
    deepStrictEqual(
      after(
        start(FIRST, 1),
        SUCCEEDED,
        CLOSED,
        start(SECOND, 3),
      ).tracker.current(),
      {target: SECOND, state: 'resolving', attempt: 3},
    );
  });

  it('F-2505: a lost transport while still resolving is ignored', () => {
    deepStrictEqual(after(start(), LOST).last, {
      changed: false,
      firstResolveSettled: false,
    });
  });

  it('F-2505: a closed transport after a failure is ignored', () => {
    deepStrictEqual(after(start(), FAILED, CLOSED).last, {
      changed: false,
      firstResolveSettled: false,
    });
  });

  it('F-2505: a lost transport before any resolve is ignored and leaves no connection', () => {
    const {tracker, last} = after(LOST);
    deepStrictEqual(
      [tracker.current(), last],
      [undefined, {changed: false, firstResolveSettled: false}],
    );
  });

  it('F-2304: a settle before any resolve started does not count as the first', () => {
    deepStrictEqual(after(SUCCEEDED, start(), SUCCEEDED).last, {
      changed: true,
      firstResolveSettled: true,
    });
  });

  it('F-2304: the listener hears every change, in order', () => {
    const tracker = new ConnectionTracker();
    const heard: Array<CurrentConnection | undefined> = [];
    tracker.onChange(current => heard.push(current));
    for (const event of [start(), SUCCEEDED, LOST]) {
      tracker.apply(event);
    }
    deepStrictEqual(
      heard.map(current => current?.state),
      ['resolving', 'connected', 'transportLost'],
    );
  });

  it('F-2304: the listener does not hear an event that changes nothing', () => {
    const tracker = new ConnectionTracker();
    let calls = 0;
    tracker.onChange(() => {
      calls += 1;
    });
    tracker.apply(LOST);
    deepStrictEqual(calls, 0);
  });

  it('F-2304: after unsubscribing the listener hears nothing more', () => {
    const tracker = new ConnectionTracker();
    let calls = 0;
    const stop = tracker.onChange(() => {
      calls += 1;
    });
    tracker.apply(start());
    stop();
    tracker.apply(SUCCEEDED);
    deepStrictEqual(calls, 1);
  });
});

describe('how the last settled resolve ended (card ssh-provider-01)', () => {
  const STEPS: Array<[string, ConnectionEvent[], string]> = [
    ['a), a first resolve under way', [start()], 'none'],
    ['b), a first success', [start(), SUCCEEDED], 'succeeded'],
    ['c), a lost transport', [start(), SUCCEEDED, LOST], 'succeeded'],
    [
      'd), the reconnect resolving',
      [start(), SUCCEEDED, LOST, start(FIRST, 2)],
      'succeeded',
    ],
    [
      'e), a successful reconnect',
      [start(), SUCCEEDED, LOST, start(FIRST, 2), SUCCEEDED],
      'succeeded',
    ],
    [
      'f), a failed reconnect',
      [
        start(),
        SUCCEEDED,
        LOST,
        start(FIRST, 2),
        SUCCEEDED,
        LOST,
        start(FIRST, 3),
        FAILED,
      ],
      'failed',
    ],
    [
      'g), a new resolve after the failure',
      [
        start(),
        SUCCEEDED,
        LOST,
        start(FIRST, 2),
        SUCCEEDED,
        LOST,
        start(FIRST, 3),
        FAILED,
        start(FIRST, 4),
      ],
      'failed',
    ],
    ['a closed transport', [start(), SUCCEEDED, CLOSED], 'succeeded'],
    ['a success before any start, ignored', [SUCCEEDED], 'none'],
  ];
  for (const [step, events, expected] of STEPS) {
    it(`F-5103.AC-34, F-5902.AC-27: ${step} gives ${expected}`, () => {
      deepStrictEqual(after(...events).tracker.lastResolve(), expected);
    });
  }

  it('F-5902.AC-27: a fresh tracker gives none', () => {
    deepStrictEqual(new ConnectionTracker().lastResolve(), 'none');
  });
});
