import {deepStrictEqual} from 'node:assert';
import {ConnectWait} from '../../src/index.ts';
import {FakeClock} from 'lib-helper/testing/fake-clock';

const POLICY = {connectTimeoutSeconds: 10, unboundedWaitSeconds: 120};

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
    deepStrictEqual(timeouts, 0);
    clock.advance(1);
    deepStrictEqual(timeouts, 1);
  });

  it('F-2105: with ConnectTimeout 0 the wait is exactly the unbounded limit, with no margin', () => {
    waitFor({connectTimeoutSeconds: 0, unboundedWaitSeconds: 120}).start();
    clock.advance(119999);
    deepStrictEqual(timeouts, 0);
    clock.advance(1);
    deepStrictEqual(timeouts, 1);
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
    deepStrictEqual(timeouts, 0);
    clock.advance(1);
    deepStrictEqual(timeouts, 1);
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
});
