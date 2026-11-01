import {deepStrictEqual} from 'node:assert';
import {withLogTail} from './harness.ts';

describe('withLogTail', () => {
  it('tooling-90: a message with no log lines is the message', () => {
    deepStrictEqual(withLogTail('timed out', []), 'timed out');
  });

  it('tooling-90: a message with few lines carries them all after a line break', () => {
    deepStrictEqual(
      withLogTail('timed out', ['one', 'two']),
      'timed out\none\ntwo',
    );
  });

  it('tooling-90: a message with more than forty lines carries the last forty', () => {
    const lines = [...Array(45).keys()].map(
      position => `line ${String(position)}`,
    );
    const carried = withLogTail('timed out', lines).split('\n');
    deepStrictEqual(
      [carried.length, carried[1], carried.at(-1)],
      [41, 'line 5', 'line 44'],
    );
  });
});
