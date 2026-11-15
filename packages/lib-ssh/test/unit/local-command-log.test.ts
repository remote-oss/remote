import {deepStrictEqual} from 'node:assert';
import {
  LOCAL_COMMAND_BYTE_LIMIT,
  LOCAL_COMMAND_DROPPED_LINE,
  LocalCommandLog,
} from '../../src/connection-server/local-command-log.ts';

describe('the output lines of a LocalCommand (card #2598, F-2109 AC-12)', () => {
  it('#2598: a line is given as it is, and a blank line is neither given nor counted', () => {
    const commandLog = new LocalCommandLog();
    deepStrictEqual(
      [
        commandLog.hear('out-marker'),
        commandLog.hear(''),
        commandLog.hear('  '),
        commandLog.hear('next'),
      ],
      ['out-marker', undefined, undefined, 'next'],
    );
  });

  it('#2598: the hundred-and-first line is the one dropped line, and nothing follows it', () => {
    const commandLog = new LocalCommandLog();
    for (let line = 1; line <= 100; line += 1) {
      commandLog.hear(`line ${String(line)}`);
    }
    deepStrictEqual(
      [
        commandLog.hear('line 101'),
        commandLog.hear('line 102'),
        commandLog.hear('line 103'),
      ],
      [LOCAL_COMMAND_DROPPED_LINE, undefined, undefined],
    );
  });

  it('#2598: the bytes count, not the characters: a line that takes the output past 8 KiB is the dropped line', () => {
    const commandLog = new LocalCommandLog();
    const wide = 'é'.repeat(LOCAL_COMMAND_BYTE_LIMIT / 4);
    deepStrictEqual(
      [
        commandLog.hear(wide),
        commandLog.hear(wide),
        commandLog.hear('é'),
        commandLog.hear('more'),
      ],
      [wide, wide, LOCAL_COMMAND_DROPPED_LINE, undefined],
    );
  });

  it('#2598: a line that fills the 8 KiB exactly is kept, and the next one is dropped', () => {
    const commandLog = new LocalCommandLog();
    deepStrictEqual(
      [
        commandLog.hear('a'.repeat(LOCAL_COMMAND_BYTE_LIMIT)),
        commandLog.hear('b'),
      ],
      ['a'.repeat(LOCAL_COMMAND_BYTE_LIMIT), LOCAL_COMMAND_DROPPED_LINE],
    );
  });
});
