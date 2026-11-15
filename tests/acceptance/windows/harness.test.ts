import {deepStrictEqual} from 'node:assert';
import {completeLines, withLogTail} from './harness.ts';

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

describe('completeLines (card #2650)', () => {
  it('#2650: the lines a newline has ended are read, and a last line still being written is left out', () => {
    deepStrictEqual(
      [
        completeLines('{"event":"state"}\n{"event":"rep'),
        completeLines('{"event":"state"}\n{"event":"report"}\n'),
        completeLines('{"event":"sta'),
        completeLines(''),
      ],
      [[{event: 'state'}], [{event: 'state'}, {event: 'report'}], [], []],
    );
  });
});
