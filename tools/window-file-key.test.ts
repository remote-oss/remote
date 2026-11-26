import {deepStrictEqual} from 'node:assert';
import {createHash} from 'node:crypto';
import {windowFileKey} from './window-file-key.ts';

/** The first 16 hex digits of the SHA-256 of `name`. */
function hashOf(name: string): string {
  return createHash('sha256').update(name, 'utf8').digest('hex').slice(0, 16);
}

describe('the key a launch names its per-window files by (card #3053)', () => {
  it('a name of at most 200 bytes is its own key', () => {
    deepStrictEqual(
      [windowFileKey('w1'), windowFileKey('a'.repeat(200))],
      ['w1', 'a'.repeat(200)],
    );
  });

  it('a name of 201 bytes is its first 180 bytes, a mark and the name hash, of 197 bytes', () => {
    const name = 'a'.repeat(201);
    const key = windowFileKey(name);
    deepStrictEqual(
      [
        Buffer.byteLength(key, 'utf8'),
        key === `${'a'.repeat(180)}~${hashOf(name)}`,
      ],
      [197, true],
    );
  });

  it('a 300-character name gives a key of at most 197 bytes', () => {
    const name = 'x'.repeat(300);
    deepStrictEqual(
      Buffer.byteLength(windowFileKey(name), 'utf8') <= 197,
      true,
    );
  });

  it('two long names with the same first 180 bytes give different keys', () => {
    const first = `${'b'.repeat(180)}1${'c'.repeat(20)}`;
    const second = `${'b'.repeat(180)}2${'d'.repeat(20)}`;
    const keys = [windowFileKey(first), windowFileKey(second)];
    deepStrictEqual(
      [
        keys[0] === keys[1],
        keys.every(key => Buffer.byteLength(key, 'utf8') <= 197),
      ],
      [false, true],
    );
  });

  it('a multi-byte name is cut on a character boundary, and at the boundary it stays its own key', () => {
    deepStrictEqual(
      [
        windowFileKey('é'.repeat(100)),
        windowFileKey('é'.repeat(101)) ===
          `${'é'.repeat(90)}~${hashOf('é'.repeat(101))}`,
        windowFileKey('é'.repeat(101)).startsWith('é'.repeat(90)),
      ],
      ['é'.repeat(100), true, true],
    );
  });
});
