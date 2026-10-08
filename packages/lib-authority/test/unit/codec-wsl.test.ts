import {deepStrictEqual} from 'node:assert';
import {decodeAuthority, encodeAuthority, wslCodec} from '../../src/index.ts';

/** The authority's re-encode, naming the refusal instead of throwing. */
function encoded(authority: string): string {
  const outcome = decodeAuthority(authority);
  return 'malformed' in outcome
    ? `malformed:${outcome.malformed.reason}`
    : encodeAuthority(outcome);
}

describe('wsl codec (card authority-01 table)', () => {
  it("decodeAuthority('wsl+Ubuntu') -> distro Ubuntu, label Ubuntu", () => {
    deepStrictEqual(
      [decodeAuthority('wsl+Ubuntu'), wslCodec.label({distro: 'Ubuntu'})],
      [
        {family: 'wsl', target: {distro: 'Ubuntu'}, rawHostString: 'Ubuntu'},
        'Ubuntu',
      ],
    );
  });

  it("decodeAuthority('wsl+') -> default distro, label default distro, encode ''", () => {
    deepStrictEqual(
      [
        decodeAuthority('wsl+'),
        wslCodec.label({distro: ''}),
        wslCodec.encode({distro: ''}),
      ],
      [
        {family: 'wsl', target: {distro: ''}, rawHostString: ''},
        'default distro',
        '',
      ],
    );
  });

  it("decodeAuthority('wsl+Ubuntu@ssh-remote+h') -> distro Ubuntu with the outer hop, and encodes back", () => {
    deepStrictEqual(
      [
        decodeAuthority('wsl+Ubuntu@ssh-remote+h'),
        encoded('wsl+Ubuntu@ssh-remote+h'),
      ],
      [
        {
          family: 'wsl',
          target: {
            distro: 'Ubuntu',
            outer: {
              family: 'ssh-remote',
              target: {kind: 'host', hostName: 'h'},
              rawHostString: 'h',
            },
          },
          rawHostString: 'Ubuntu@ssh-remote+h',
        },
        'wsl+Ubuntu@ssh-remote+h',
      ],
    );
  });

  it("decodeAuthority('wsl+Ubuntu@nope+x') -> malformed badOuter", () => {
    deepStrictEqual(decodeAuthority('wsl+Ubuntu@nope+x'), {
      malformed: {family: 'wsl', payload: 'Ubuntu@nope+x', reason: 'badOuter'},
    });
  });
});
