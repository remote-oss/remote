import {deepStrictEqual} from 'node:assert';
import {FakeClock} from 'lib-helper/testing/fake-clock';
import {
  SSH_LINE_BATCH_LINES,
  SSH_LINE_BATCH_MILLISECONDS,
  SshLineFeed,
} from '../../src/connection-server/ssh-line-feed.ts';

describe('the live feed of ssh’s lines (card connect-66)', () => {
  function feedOf(): {
    clock: FakeClock;
    batches: string[][];
    feed: SshLineFeed;
  } {
    const clock = new FakeClock();
    const batches: string[][] = [];
    return {
      clock,
      batches,
      feed: new SshLineFeed(batch => batches.push(batch), clock.scheduler()),
    };
  }

  it('F-2003 BR-6 item 6: lines leave together after 100 ms, in order', () => {
    const {clock, batches, feed} = feedOf();
    feed.push('first');
    clock.advance(SSH_LINE_BATCH_MILLISECONDS - 1);
    feed.push('second');
    const early = batches.length;
    clock.advance(1);
    deepStrictEqual([early, batches], [0, [['first', 'second']]]);
  });

  it('F-2003 BR-6 item 6: a batch holds at most 200 lines, and the rest leave 100 ms later', () => {
    const {clock, batches, feed} = feedOf();
    for (let line = 0; line < SSH_LINE_BATCH_LINES + 5; line++) {
      feed.push(`line ${String(line)}`);
    }
    clock.advance(SSH_LINE_BATCH_MILLISECONDS);
    const first = batches.map(batch => batch.length);
    clock.advance(SSH_LINE_BATCH_MILLISECONDS);
    deepStrictEqual(
      [first, batches.map(batch => batch.length), batches[1]?.[0]],
      [[SSH_LINE_BATCH_LINES], [SSH_LINE_BATCH_LINES, 5], 'line 200'],
    );
  });

  it('a flush sends what waits at once, in batches of at most 200, and the timer then sends nothing', () => {
    const {clock, batches, feed} = feedOf();
    for (let line = 0; line < SSH_LINE_BATCH_LINES + 1; line++) {
      feed.push(`line ${String(line)}`);
    }
    feed.flush();
    const flushed = batches.map(batch => batch.length);
    clock.advance(SSH_LINE_BATCH_MILLISECONDS * 3);
    deepStrictEqual([flushed, batches.length], [[SSH_LINE_BATCH_LINES, 1], 2]);
  });

  it('a flush with nothing waiting sends nothing, and a line after it starts a new batch', () => {
    const {clock, batches, feed} = feedOf();
    feed.flush();
    feed.push('late');
    clock.advance(SSH_LINE_BATCH_MILLISECONDS);
    deepStrictEqual(batches, [['late']]);
  });
});
