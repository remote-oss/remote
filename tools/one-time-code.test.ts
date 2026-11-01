import {deepStrictEqual, throws} from 'node:assert';
import {base32Of, bytesOfBase32, oneTimeCode} from './one-time-code.ts';

/** RFC 6238's SHA-1 test secret, the ASCII digits 1234567890 twice, in base32. */
const RFC_SECRET = base32Of(Buffer.from('12345678901234567890', 'ascii'));

describe('one-time codes (card tooling-34)', () => {
  it("RFC 6238's SHA-1 vectors, cut to six digits, at 59 s, 1111111109 s and 20000000000 s", () => {
    deepStrictEqual(
      [59, 1_111_111_109, 20_000_000_000].map(seconds =>
        oneTimeCode(RFC_SECRET, seconds * 1000),
      ),
      ['287082', '081804', '353130'],
    );
  });

  it('a code holds for its 30-second step and changes at the next', () => {
    deepStrictEqual(
      [0, 29_999, 30_000].map(moment => oneTimeCode(RFC_SECRET, moment)),
      [
        oneTimeCode(RFC_SECRET, 0),
        oneTimeCode(RFC_SECRET, 0),
        oneTimeCode(RFC_SECRET, 30_000),
      ],
    );
  });

  it("base32 is RFC 4648's: the test secret, 20 bytes as 32 characters, and back, padding and case aside", () => {
    deepStrictEqual(
      [
        RFC_SECRET,
        base32Of(new Uint8Array(20)).length,
        bytesOfBase32(`${RFC_SECRET.toLowerCase()}====`).toString('ascii'),
        base32Of(Buffer.from('f')),
      ],
      ['GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 32, '12345678901234567890', 'MY'],
    );
  });

  it('a character outside the alphabet is refused', () => {
    throws(() => bytesOfBase32('GEZ1'), /not base32: "1"/);
  });
});
