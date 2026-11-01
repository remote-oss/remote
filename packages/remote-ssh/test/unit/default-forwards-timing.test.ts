import {deepStrictEqual} from 'node:assert';
import {FakeClock} from 'lib-helper/testing/fake-clock';
import {
  type DefaultReadEvents,
  READ_BOUND_MILLISECONDS,
  type ReadSignal,
  waitForDefaultRead,
} from '../../src/forwarding/default-forwards-timing.ts';

/** Events the test fires by hand, and counts the listeners still set. */
class FakeEvents implements DefaultReadEvents {
  trusted = true;
  trustListeners = new Set<() => void>();
  settingListeners = new Set<() => void>();
  isTrusted(): boolean {
    return this.trusted;
  }
  onTrustGranted(listener: () => void): {dispose(): void} {
    this.trustListeners.add(listener);
    return {dispose: () => this.trustListeners.delete(listener)};
  }
  onSettingChanged(listener: () => void): {dispose(): void} {
    this.settingListeners.add(listener);
    return {dispose: () => this.settingListeners.delete(listener)};
  }
}

/** Starts the wait, and gives what it resolved with once the test lets the microtasks run. */
function started(events: FakeEvents, clock: FakeClock) {
  const outcome: {signal?: ReadSignal} = {};
  void waitForDefaultRead(events, clock.scheduler()).then(signal => {
    outcome.signal = signal;
  });
  return outcome;
}

describe('the wait before the default forwards are read (card connect-99)', () => {
  it('F-2507 BR-4: a change that reaches the setting ends the wait, and the other listeners and the timer are removed', async () => {
    const events = new FakeEvents();
    const clock = new FakeClock();
    const outcome = started(events, clock);
    for (const listener of events.settingListeners) {
      listener();
    }
    await Promise.resolve();
    clock.advance(READ_BOUND_MILLISECONDS);
    await Promise.resolve();
    deepStrictEqual(
      [
        outcome.signal,
        events.settingListeners.size,
        events.trustListeners.size,
      ],
      ['configuration', 0, 0],
    );
  });

  it('F-2507 BR-4: a folder that is not trusted yet is waited for, and its grant ends the wait', async () => {
    const events = new FakeEvents();
    events.trusted = false;
    const outcome = started(events, new FakeClock());
    const waiting = events.trustListeners.size;
    for (const listener of events.trustListeners) {
      listener();
    }
    await Promise.resolve();
    deepStrictEqual([waiting, outcome.signal], [1, 'trust']);
  });

  it('F-2507 BR-4: a folder that is trusted already gives the trust signal no listener', () => {
    const events = new FakeEvents();
    started(events, new FakeClock());
    deepStrictEqual(events.trustListeners.size, 0);
  });

  it('F-2507 BR-4: with no signal the bound ends the wait, and the listeners are removed', async () => {
    const events = new FakeEvents();
    events.trusted = false;
    const clock = new FakeClock();
    const outcome = started(events, clock);
    clock.advance(READ_BOUND_MILLISECONDS - 1);
    await Promise.resolve();
    const early = outcome.signal;
    clock.advance(1);
    await Promise.resolve();
    deepStrictEqual(
      [
        early,
        outcome.signal,
        events.settingListeners.size,
        events.trustListeners.size,
      ],
      [undefined, 'bound', 0, 0],
    );
  });

  it('F-2507 BR-5, 7.E10: a change after the wait ended is not heard', async () => {
    const events = new FakeEvents();
    const outcome = started(events, new FakeClock());
    for (const listener of events.settingListeners) {
      listener();
    }
    await Promise.resolve();
    deepStrictEqual(
      [outcome.signal, events.settingListeners.size],
      ['configuration', 0],
    );
  });
});
