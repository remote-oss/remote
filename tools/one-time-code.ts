/**
 * @fileoverview one-time-code: RFC 4648's base32 and RFC 6238's time-based one-time codes (SHA-1, 30-second steps, six
 * digits), as the SSH host's two-factor account checks them. Node's crypto only.
 */

import {createHmac} from 'node:crypto';

/** The alphabet of RFC 4648's base32, in which a one-time-code secret is written. */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** The length of one step of the code, in milliseconds. */
const STEP_MILLISECONDS = 30_000;

/** The number of digits of a code. */
const CODE_DIGITS = 6;

/** `bytes` in base32 without padding, five bits to a character, the last one filled with zero bits. */
export function base32Of(bytes: Uint8Array): string {
  let bits = '';
  for (const byte of bytes) {
    bits += byte.toString(2).padStart(8, '0');
  }
  const characters: string[] = [];
  for (let start = 0; start < bits.length; start += 5) {
    const chunk = bits.slice(start, start + 5).padEnd(5, '0');
    characters.push(BASE32_ALPHABET.charAt(Number.parseInt(chunk, 2)));
  }
  return characters.join('');
}

/** The bytes of a base32 text, padding and case ignored; a character outside the alphabet throws. */
export function bytesOfBase32(text: string): Buffer {
  let bits = '';
  for (const character of text.toUpperCase().replace(/=+$/, '')) {
    const value = BASE32_ALPHABET.indexOf(character);
    if (value < 0) {
      throw new Error(`not base32: ${JSON.stringify(character)}`);
    }
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let start = 0; start + 8 <= bits.length; start += 8) {
    bytes.push(Number.parseInt(bits.slice(start, start + 8), 2));
  }
  return Buffer.from(bytes);
}

/** The six-digit code of the base32 `secret` at `moment`, in milliseconds since the epoch (RFC 6238 over RFC 4226). */
export function oneTimeCode(secret: string, moment: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(moment / STEP_MILLISECONDS)));
  const digest = createHmac('sha1', bytesOfBase32(secret))
    .update(counter)
    .digest();
  const offset = digest.readUInt8(digest.length - 1) & 0x0f;
  const truncated = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(truncated % 10 ** CODE_DIGITS).padStart(CODE_DIGITS, '0');
}
