import {deepStrictEqual} from 'node:assert';
import {PlainTextFilter} from '../../src/index.ts';

/** The results of pushing each piece in turn, then the flush. */
function filtered(...pieces: string[]): string[] {
  const filter = new PlainTextFilter();
  return [...pieces.map(piece => filter.push(piece)), filter.flush()];
}

describe('PlainTextFilter (card ssh-18 table)', () => {
  it('#299: plain text and line ends pass through', () => {
    deepStrictEqual(filtered('plain text\r\n'), ['plain text\r\n', '']);
  });

  it('#299: a control sequence is removed', () => {
    deepStrictEqual(filtered('\x1b[1;32mgreen\x1b[0m\n'), ['green\n', '']);
  });

  it('#299: a private mode sequence before a marker is removed', () => {
    deepStrictEqual(filtered('\x1b[?2004lAbC123:start\r\n'), [
      'AbC123:start\r\n',
      '',
    ]);
  });

  it('#299: an operating system command ended by the bell is removed', () => {
    deepStrictEqual(filtered('\x1b]0;user@host: ~\x07prompt$ '), [
      'prompt$ ',
      '',
    ]);
  });

  it('#299: an operating system command ended by the string terminator is removed', () => {
    deepStrictEqual(filtered('\x1b]0;title\x1b\\after'), ['after', '']);
  });

  it('#299: a device control string is removed', () => {
    deepStrictEqual(filtered('\x1bP1$r0m\x1b\\x'), ['x', '']);
  });

  it('#299: two-byte and charset escapes are removed', () => {
    deepStrictEqual(filtered('a\x1b=b\x1b(Bc'), ['abc', '']);
  });

  it('#299: a control sequence split across pieces is held', () => {
    deepStrictEqual(filtered('ab\x1b[', '0mcd'), ['ab', 'cd', '']);
  });

  it('#299: a string sequence split across pieces is held', () => {
    deepStrictEqual(filtered('\x1b]0;ti', 'tle\x07rest'), ['', 'rest', '']);
  });

  it('#299: a piece that ends right after the escape is held', () => {
    deepStrictEqual(filtered('x\x1b', '[2Ky'), ['x', 'y', '']);
  });

  it('#299: a bell outside a string sequence and a tab are kept', () => {
    deepStrictEqual(filtered('\x07bell\ttab'), ['\x07bell\ttab', '']);
  });

  it('#299: an unfinished sequence at the end is dropped', () => {
    deepStrictEqual(filtered('end\x1b[1'), ['end', '']);
  });

  it('#299: a control sequence broken off by a control character keeps what follows', () => {
    deepStrictEqual(filtered('a\x1b[1\nb'), ['a\nb', '']);
  });

  it('#299: a charset escape split across pieces is held', () => {
    deepStrictEqual(filtered('a\x1b(', 'Bc'), ['a', 'c', '']);
  });

  it('#299: an escape with intermediates broken off by a control character keeps what follows', () => {
    deepStrictEqual(filtered('a\x1b(\nb'), ['a\nb', '']);
  });

  it('#299: an escape with intermediates broken off by a byte past the final range keeps what follows', () => {
    deepStrictEqual(filtered('a\x1b(\x7fb'), ['a\x7fb', '']);
  });

  describe('a string sequence that never ends', () => {
    it('#341: a stray operating system command is cancelled by the next escape sequence', () => {
      deepStrictEqual(filtered('\x1b]0;stray\n\x1b[31mmotd\x1b[0m\n'), [
        'motd\n',
        '',
      ]);
    });

    it('#341: the cancelling escape starts the next sequence, which is removed', () => {
      deepStrictEqual(filtered('a\x1b]0;x\x1b[1mb'), ['ab', '']);
    });

    it('#341: a cancelled string ends at the cancel character, and the text after it stays', () => {
      deepStrictEqual(filtered('a\x1b]0;x\x18b'), ['ab', '']);
    });

    it('#341: a substitute character cancels a string too', () => {
      deepStrictEqual(filtered('a\x1bP1$r\x1ab'), ['ab', '']);
    });

    it('#341: the prompt after a stray string is not swallowed', () => {
      deepStrictEqual(filtered('\x1b]0;stray\nlast login\n\x1b[0mPassword: '), [
        'Password: ',
        '',
      ]);
    });

    it('#341: a string cancelled in a later piece lets the text through', () => {
      deepStrictEqual(filtered('a\x1b]0;x', '\x18b'), ['a', 'b', '']);
    });

    it('#341: a string open past 4 KiB is dropped through the next line end, in one piece', () => {
      deepStrictEqual(filtered(`a\x1b]0;${'z'.repeat(5000)}\nnext line`), [
        'anext line',
        '',
      ]);
    });

    it('#341: a string open past 4 KiB is dropped through a line end in a later piece', () => {
      deepStrictEqual(
        filtered('a\x1b]0;', 'z'.repeat(3000), `${'z'.repeat(3000)}\nafter`),
        ['a', '', 'after', ''],
      );
    });

    it('#341: a cap reached with no line end drops the next piece up to its first line end', () => {
      deepStrictEqual(filtered(`a\x1b]0;${'z'.repeat(5000)}`, 'zz\nok'), [
        'a',
        'ok',
        '',
      ]);
    });

    it('#341: a carriage return alone ends the dropped line too', () => {
      deepStrictEqual(filtered(`a\x1b]0;${'z'.repeat(5000)}\rnext`), [
        'anext',
        '',
      ]);
    });

    it('#341: a string whose terminator comes before the cap ends normally, also in the piece that crosses it', () => {
      deepStrictEqual(
        filtered(`a\x1b]0;${'x'.repeat(3000)}`, `${'y'.repeat(900)}\x07z`),
        ['a', 'z', ''],
      );
    });

    const longStray = `a\x1b]0;${'z'.repeat(5000)}\nB`;

    it('#341: a later escape sequence does not rescue a string that is past the cap', () => {
      deepStrictEqual(filtered(`${longStray}\x1b[1mC`), ['aBC', '']);
    });

    it('#341: a later operating system command does not rescue a string that is past the cap', () => {
      deepStrictEqual(filtered(`${longStray}\x1b]0;t\x07C`), ['aBC', '']);
    });

    it('#341: a later bell does not rescue a string that is past the cap', () => {
      deepStrictEqual(filtered(`${longStray}\x07C`), ['aB\x07C', '']);
    });

    it('#341: a bell past the cap does not end a string that is open at the cap', () => {
      deepStrictEqual(filtered(`a\x1b]0;${'z'.repeat(4100)}\x07\nB`), [
        'aB',
        '',
      ]);
    });

    it('#341: a bell before the cap still ends the string normally', () => {
      deepStrictEqual(filtered(`a\x1b]0;${'z'.repeat(4000)}\x07B`), ['aB', '']);
    });

    it('#341: an escape that ends a piece inside a string waits for the next piece', () => {
      deepStrictEqual(filtered('a\x1b]0;x\x1b', '\\b'), ['a', 'b', '']);
    });

    it('#341: a string just under 4 KiB is still held', () => {
      const filter = new PlainTextFilter();
      deepStrictEqual(
        [filter.push(`\x1b]0;${'x'.repeat(4000)}`), filter.push('tail')],
        ['', ''],
      );
    });
  });
});
