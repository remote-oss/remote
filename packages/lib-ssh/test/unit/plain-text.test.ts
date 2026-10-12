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
});
