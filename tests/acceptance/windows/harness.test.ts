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
  describe('a Feature that failed to install (card #2675)', () => {
    const failure =
      '#14 64.95 ERROR: Feature "Java (via SDKMAN!)" (ghcr.io/devcontainers/features/java) failed to install!';
    const later = [...Array(45).keys()].map(
      position => `later ${String(position)}`,
    );

    it('#2675: a failure older than the last forty lines goes before them with the three lines that said why', () => {
      const lines = [
        'earlier',
        '#14 64.76 Downloading: maven 3.10.0',
        '#14 64.95 Stop! The archive was corrupt and has been removed!',
        '#14 64.95 (!) Installing maven  via SDKMAN failed after 5 attempts.',
        failure,
        ...later,
      ];
      const carried = withLogTail('timed out', lines).split('\n');
      deepStrictEqual(
        [carried.slice(0, 6), carried.length, carried.at(-1)],
        [
          [
            'timed out',
            'the Feature that failed to install:',
            '#14 64.76 Downloading: maven 3.10.0',
            '#14 64.95 Stop! The archive was corrupt and has been removed!',
            '#14 64.95 (!) Installing maven  via SDKMAN failed after 5 attempts.',
            failure,
          ],
          // the message, the heading and four lines, the heading of the tail and its forty lines
          1 + 1 + 4 + 1 + 40,
          'later 44',
        ],
      );
    });

    it('#2675: a failure near the start carries the lines there are before it', () => {
      const carried = withLogTail('timed out', [
        'first',
        failure,
        ...later,
      ]).split('\n');
      deepStrictEqual(carried.slice(1, 4), [
        'the Feature that failed to install:',
        'first',
        failure,
      ]);
    });

    it('#2675: a failure inside the last forty lines is not carried twice', () => {
      const lines = ['before', failure, 'after'];
      deepStrictEqual(
        withLogTail('timed out', lines),
        `timed out\nbefore\n${failure}\nafter`,
      );
    });
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
