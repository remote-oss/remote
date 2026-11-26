import {deepStrictEqual} from 'node:assert';
import {VSCODIUM_RELEASE} from './acceptance.ts';
import {
  EARLIER_SERVER_ARCHIVE,
  SERVER_ARCHIVE,
} from './acceptance-downloads.ts';
import {pinsKeyOf, VSCODIUM_PINS} from './vscodium-pins-key.ts';

describe('vscodium-pins-key (card #3197)', () => {
  it('the key covers the pins of the editor, the servers and the earlier servers, as 16 hex digits that stay put', () => {
    deepStrictEqual(
      [
        VSCODIUM_PINS,
        /^[0-9a-f]{16}$/u.test(pinsKeyOf()),
        pinsKeyOf() === pinsKeyOf([...VSCODIUM_PINS]),
      ],
      [[VSCODIUM_RELEASE, SERVER_ARCHIVE, EARLIER_SERVER_ARCHIVE], true, true],
    );
  });

  it('a pin change misses the cache: another tag or any one sha256 gives another key', () => {
    const server = {
      ...SERVER_ARCHIVE,
      sha256: {...SERVER_ARCHIVE.sha256, 'alpine-x64': '0'.repeat(64)},
    };
    const editor = {
      ...VSCODIUM_RELEASE,
      sha256: {...VSCODIUM_RELEASE.sha256, 'linux-x64': '0'.repeat(64)},
    };
    const changed = [
      [
        {...VSCODIUM_RELEASE, tagName: '1.140.06929-insider'},
        SERVER_ARCHIVE,
        EARLIER_SERVER_ARCHIVE,
      ],
      [editor, SERVER_ARCHIVE, EARLIER_SERVER_ARCHIVE],
      [VSCODIUM_RELEASE, server, EARLIER_SERVER_ARCHIVE],
      [
        VSCODIUM_RELEASE,
        SERVER_ARCHIVE,
        {...EARLIER_SERVER_ARCHIVE, tagName: '1.140.06629-insider'},
      ],
    ].map(pins => pinsKeyOf(pins));
    deepStrictEqual(
      [new Set([pinsKeyOf(), ...changed]).size],
      [changed.length + 1],
    );
  });
});
