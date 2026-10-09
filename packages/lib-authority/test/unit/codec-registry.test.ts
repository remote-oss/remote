import {deepStrictEqual, strictEqual} from 'node:assert';
import {
  containerCodec,
  decodeAuthority,
  encodeAuthority,
  sshRemoteCodec,
  tunnelCodec,
  wslCodec,
} from '../../src/index.ts';

/** The authority's re-encode, naming the refusal instead of throwing. */
function encoded(authority: string): string {
  const outcome = decodeAuthority(authority);
  return 'malformed' in outcome
    ? `malformed:${outcome.malformed.reason}`
    : encodeAuthority(outcome);
}

/** The outer codec the container codec is built on here: the registry's own decode and encode. */
const REGISTRY_OUTER = {decode: decodeAuthority, encode: encodeAuthority};

describe('authority registry (card authority-01 table)', () => {
  it("decodeAuthority('nope+x') -> malformed unknownFamily", () => {
    deepStrictEqual(decodeAuthority('nope+x'), {
      malformed: {family: 'nope', payload: 'nope+x', reason: 'unknownFamily'},
    });
  });

  it("decodeAuthority('noplus') -> malformed unknownFamily (no +)", () => {
    deepStrictEqual(decodeAuthority('noplus'), {
      malformed: {family: 'noplus', payload: 'noplus', reason: 'unknownFamily'},
    });
  });

  it('a bare family without + (wsl, exec, tunnel, ssh-remote) -> malformed unknownFamily', () => {
    deepStrictEqual(
      ['wsl', 'exec', 'tunnel', 'ssh-remote'].map(authority => {
        const outcome = decodeAuthority(authority);
        return 'malformed' in outcome ? outcome.malformed : undefined;
      }),
      ['wsl', 'exec', 'tunnel', 'ssh-remote'].map(authority => ({
        family: authority,
        payload: authority,
        reason: 'unknownFamily',
      })),
    );
  });

  it('encodeAuthority(decodeAuthority(a)) for one authority per family -> equals a', () => {
    deepStrictEqual(
      [
        'ssh-remote+myhost',
        'wsl+Ubuntu',
        'dev-container+abcd@ssh-remote+h',
        'attached-container+abcd',
        'k8s-container+k',
        'apple-container+abcd@wsl+Ubuntu',
        'exec+abcd',
        'tunnel+mytunnel/Ubuntu',
      ].map(encoded),
      [
        'ssh-remote+myhost',
        'wsl+Ubuntu',
        'dev-container+abcd@ssh-remote+h',
        'attached-container+abcd',
        'k8s-container+k',
        'apple-container+abcd@wsl+Ubuntu',
        'exec+abcd',
        'tunnel+mytunnel/Ubuntu',
      ],
    );
  });

  it('decodeAuthority of a payload with a malformed outer -> the inner reason, the outer family', () => {
    deepStrictEqual(decodeAuthority('apple-container+abcd@wsl+Ubuntu@nope+x'), {
      malformed: {
        family: 'apple-container',
        payload: 'abcd@wsl+Ubuntu@nope+x',
        reason: 'badOuter',
      },
    });
  });

  it('every codec the registry dispatches -> the same shape the card names', () => {
    deepStrictEqual(
      [
        sshRemoteCodec.decode('myhost'),
        wslCodec.decode('Ubuntu'),
        containerCodec('dev-container', REGISTRY_OUTER).decode('abcd'),
        tunnelCodec.decode('mytunnel'),
      ],
      [
        {target: {kind: 'plain', text: 'myhost'}, rawHostString: 'myhost'},
        {target: {distro: 'Ubuntu'}, rawHostString: 'Ubuntu'},
        {target: {payload: 'abcd'}, rawHostString: 'abcd'},
        {target: {tunnelName: 'mytunnel'}, rawHostString: 'mytunnel'},
      ],
    );
  });

  it('encodeAuthority of a decoded ssh-remote hex authority -> the hex, not the plain text', () => {
    const encodedHex = '7b22686f73744e616d65223a2268222c2275736572223a2275227d';
    strictEqual(
      encoded(`ssh-remote+${encodedHex}`),
      `ssh-remote+${encodedHex}`,
    );
  });
});
