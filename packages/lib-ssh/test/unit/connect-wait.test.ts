import {deepStrictEqual} from 'node:assert';
import {ConnectWait, connectWaitMilliseconds} from '../../src/index.ts';
import {FakeClock} from 'lib-helper/testing/fake-clock';

const POLICY = {
  connectTimeoutSeconds: 10,
  fromHost: false,
  unboundedWaitSeconds: 120,
};

describe('connect wait', () => {
  let clock: FakeClock;
  let timeouts: number;

  function waitFor(settings = POLICY): ConnectWait {
    return new ConnectWait(settings, clock.scheduler(), () => {
      timeouts += 1;
    });
  }

  beforeEach(() => {
    clock = new FakeClock();
    timeouts = 0;
  });

  it('F-2105: runs out at the connect timeout plus 2 s', () => {
    waitFor().start();
    clock.advance(11999);
    const before = timeouts;
    clock.advance(1);
    deepStrictEqual([before, timeouts], [0, 1]);
  });

  it('F-2105: with ConnectTimeout 0 the wait is exactly the unbounded limit, with no margin', () => {
    waitFor({
      connectTimeoutSeconds: 0,
      fromHost: true,
      unboundedWaitSeconds: 120,
    }).start();
    clock.advance(119999);
    const before = timeouts;
    clock.advance(1);
    deepStrictEqual([before, timeouts], [0, 1]);
  });

  it('F-2105 BR-4, AC-9: the setting 0 waits the margin alone', () => {
    waitFor({
      connectTimeoutSeconds: 0,
      fromHost: false,
      unboundedWaitSeconds: 600,
    }).start();
    clock.advance(1999);
    const before = timeouts;
    clock.advance(1);
    deepStrictEqual([before, timeouts], [0, 1]);
  });

  it('F-2105 BR-4, AC-8: a host 0 waits the whole ceiling', () => {
    waitFor({
      connectTimeoutSeconds: 0,
      fromHost: true,
      unboundedWaitSeconds: 600,
    }).start();
    clock.advance(599_999);
    const before = timeouts;
    clock.advance(1);
    deepStrictEqual([before, timeouts], [0, 1]);
  });

  it('F-2105 BR-3: the setting 15 waits fifteen seconds plus the margin', () => {
    waitFor({
      connectTimeoutSeconds: 15,
      fromHost: false,
      unboundedWaitSeconds: 600,
    }).start();
    clock.advance(16_999);
    const before = timeouts;
    clock.advance(1);
    deepStrictEqual([before, timeouts], [0, 1]);
  });

  it('F-2105 BR-1: a host timeout of three waits three seconds plus the margin', () => {
    waitFor({
      connectTimeoutSeconds: 3,
      fromHost: true,
      unboundedWaitSeconds: 600,
    }).start();
    clock.advance(4_999);
    const before = timeouts;
    clock.advance(1);
    deepStrictEqual([before, timeouts], [0, 1]);
  });

  it('F-2308 BR-5: pauses while a prompt is open', () => {
    const wait = waitFor();
    wait.start();
    clock.advance(5000);
    wait.promptOpened();
    clock.advance(600000);
    deepStrictEqual(timeouts, 0);
  });

  it('F-2308 BR-5: restarts the full wait after the answer', () => {
    const wait = waitFor();
    wait.start();
    clock.advance(5000);
    wait.promptOpened();
    wait.promptAnswered();
    clock.advance(11999);
    const before = timeouts;
    clock.advance(1);
    deepStrictEqual([before, timeouts], [0, 1]);
  });

  it('counts time that no prompt of ours pauses, as with a user askpass', () => {
    waitFor().start();
    clock.advance(12000);
    deepStrictEqual(timeouts, 1);
  });

  it('stops at the first setup report: nothing fires afterwards', () => {
    const wait = waitFor();
    wait.start();
    clock.advance(5000);
    wait.stop();
    clock.advance(600000);
    deepStrictEqual(timeouts, 0);
  });

  it('does not restart after a stop when a late answer arrives', () => {
    const wait = waitFor();
    wait.start();
    wait.stop();
    wait.promptAnswered();
    clock.advance(600000);
    deepStrictEqual(timeouts, 0);
  });

  it('fires once, and a late answer does not start it again', () => {
    const wait = waitFor();
    wait.start();
    clock.advance(12000);
    wait.promptAnswered();
    clock.advance(600000);
    deepStrictEqual(timeouts, 1);
  });

  it('F-2105 BR-4, AC-8: the length is the whole ceiling for a host 0', () => {
    deepStrictEqual(
      connectWaitMilliseconds({
        connectTimeoutSeconds: 0,
        fromHost: true,
        unboundedWaitSeconds: 600,
      }),
      600000,
    );
  });

  it('F-2105 BR-4, AC-9: the length is the margin alone for the setting 0', () => {
    deepStrictEqual(
      connectWaitMilliseconds({
        connectTimeoutSeconds: 0,
        fromHost: false,
        unboundedWaitSeconds: 600,
      }),
      2000,
    );
  });

  it('F-2105 BR-1: the length is the timeout plus the margin', () => {
    deepStrictEqual(
      connectWaitMilliseconds({
        connectTimeoutSeconds: 7,
        fromHost: true,
        unboundedWaitSeconds: 600,
      }),
      9000,
    );
  });

  it('F-2105 BR-3: the length is the setting plus the margin', () => {
    deepStrictEqual(
      connectWaitMilliseconds({
        connectTimeoutSeconds: 15,
        fromHost: false,
        unboundedWaitSeconds: 600,
      }),
      17000,
    );
  });
});
