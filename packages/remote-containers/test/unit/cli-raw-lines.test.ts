import {deepStrictEqual} from 'node:assert';
import {rawHoldOf, type RawEvent} from '../../src/cli/cli-raw-lines.ts';

function chunk(text: string, channel?: string): RawEvent {
  return {kind: 'log', level: 3, text, channel};
}

describe('the output of lifecycle commands held by line (card containers-04)', () => {
  it('R-26: a chunk with complete lines gives them as one event and holds the rest', () => {
    const hold = rawHoldOf();
    deepStrictEqual(
      [hold.push(chunk('one\ntwo\nthr', 'postCreate')), hold.releaseAll()],
      [[chunk('one\ntwo\n', 'postCreate')], [chunk('thr', 'postCreate')]],
    );
  });

  it('R-26: a value split across two chunks goes out in one event at its newline', () => {
    const hold = rawHoldOf();
    deepStrictEqual(
      [hold.push(chunk('echo s3cr3t-')), hold.push(chunk('token\n'))],
      [[], [chunk('echo s3cr3t-token\n')]],
    );
  });

  it('R-26: a chunk that ends at a newline holds nothing', () => {
    const hold = rawHoldOf();
    hold.push(chunk('a\n'));
    deepStrictEqual(hold.releaseAll(), []);
  });

  it('R-26: releasing a channel gives its tail once, and the other channels keep theirs', () => {
    const hold = rawHoldOf();
    hold.push(chunk('abc', 'postCreate'));
    hold.push(chunk('def', 'postStart'));
    deepStrictEqual(
      [
        hold.release('postCreate'),
        hold.release('postCreate'),
        hold.releaseAll(),
      ],
      [[chunk('abc', 'postCreate')], [], [chunk('def', 'postStart')]],
    );
  });

  it('R-26: events with no channel share one hold', () => {
    const hold = rawHoldOf();
    hold.push(chunk('ab'));
    deepStrictEqual(hold.release(undefined), [chunk('ab')]);
  });
});
