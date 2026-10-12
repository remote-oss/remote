import {deepStrictEqual} from 'node:assert';
import {decodeManagementOutput} from '../../src/index.ts';

/** The bytes of `text` as UTF-16LE, with the byte order mark when asked. */
function utf16(text: string, withMark = false): Uint8Array {
  const units = withMark ? `\uFEFF${text}` : text;
  const bytes = new Uint8Array(units.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < units.length; index++) {
    view.setUint16(index * 2, units.charCodeAt(index), true);
  }
  return bytes;
}

/** The bytes of `text` as UTF-8. */
function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** `bytes` followed by `extra`. */
function followedBy(bytes: Uint8Array, ...extra: number[]): Uint8Array {
  return Uint8Array.from([...bytes, ...extra]);
}

describe('decodeManagementOutput (card wsl-01 table)', () => {
  it('contracts.md §1 D1: a UTF-16LE mark is dropped', () => {
    deepStrictEqual(decodeManagementOutput(utf16('NAME\r\n', true)), 'NAME\n');
  });

  it('contracts.md §1 D1: UTF-16LE without a mark is found from the bytes', () => {
    deepStrictEqual(
      decodeManagementOutput(utf16('  NAME   STATE\r\n')),
      '  NAME   STATE\n',
    );
  });

  it('brief "Decoding": UTF-16LE text with a non-ASCII unit decodes whole', () => {
    deepStrictEqual(
      decodeManagementOutput(utf16('fixture γ\r\n')),
      'fixture γ\n',
    );
  });

  it('contracts.md §1 D1: UTF-8 text decodes as it is', () => {
    deepStrictEqual(decodeManagementOutput(utf8('fixture γ\n')), 'fixture γ\n');
  });

  it('contracts.md §1 D1: a UTF-8 mark is dropped', () => {
    deepStrictEqual(
      decodeManagementOutput(
        followedBy(Uint8Array.from([0xef, 0xbb, 0xbf]), ...utf8('abc')),
      ),
      'abc',
    );
  });

  it('brief "Decoding": NULs at the end of UTF-16LE text are removed', () => {
    deepStrictEqual(
      decodeManagementOutput(followedBy(utf16('abc'), 0, 0)),
      'abc',
    );
  });

  it('brief "Decoding": a NUL at the end of UTF-8 text is removed', () => {
    deepStrictEqual(
      decodeManagementOutput(followedBy(utf8('abcd'), 0)),
      'abcd',
    );
  });

  it('brief "Decoding": a NUL inside odd-length bytes is removed', () => {
    deepStrictEqual(
      decodeManagementOutput(Uint8Array.from([0x61, 0x00, 0x62])),
      'ab',
    );
  });

  it('brief "Decoding": empty bytes give empty text', () => {
    deepStrictEqual(decodeManagementOutput(new Uint8Array()), '');
  });

  it('brief "Decoding": CRLF in UTF-8 becomes LF', () => {
    deepStrictEqual(decodeManagementOutput(utf8('a\r\nb\r\n')), 'a\nb\n');
  });

  it('contracts.md §1 D1: one UTF-16LE unit without a mark is UTF-16LE', () => {
    deepStrictEqual(decodeManagementOutput(Uint8Array.from([0x41, 0x00])), 'A');
  });

  it('contracts.md §1 D1: an odd byte after the mark is dropped', () => {
    deepStrictEqual(
      decodeManagementOutput(Uint8Array.from([0xff, 0xfe, 0x41, 0x00, 0x42])),
      'A',
    );
  });

  it('contracts.md §1 D1: an invalid UTF-8 byte becomes U+FFFD', () => {
    deepStrictEqual(
      decodeManagementOutput(Uint8Array.from([0x41, 0xff])),
      'A�',
    );
  });

  it('contracts.md §1 D1: a zero-byte share exactly at the bound is UTF-16LE', () => {
    deepStrictEqual(
      decodeManagementOutput(Uint8Array.from([0x61, 0x62, 0x00, 0x00])),
      '扡',
    );
  });

  it('contracts.md §1 D1: a zero-byte share below the bound is UTF-8', () => {
    deepStrictEqual(
      decodeManagementOutput(
        Uint8Array.from([0x61, 0x62, 0x63, 0x64, 0x00, 0x00]),
      ),
      'abcd',
    );
  });
});
