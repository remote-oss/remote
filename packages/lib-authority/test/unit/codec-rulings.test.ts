import {readFileSync, readdirSync} from 'node:fs';
import {deepStrictEqual, strictEqual} from 'node:assert';
import path from 'node:path';
import {
  containerCodec,
  decodeAuthority,
  encodeAuthority,
  sshRemoteCodec,
  wslCodec,
  wslCodecOf,
} from '../../src/index.ts';
import type {DecodedTarget} from '../../src/index.ts';

/** The lower-case hex of a text, as the JSON form of a host is written. */
function hexOf(text: string): string {
  return Buffer.from(text, 'utf-8').toString('hex');
}

/** The refusal reason a decode earns, naming it instead of the shape. */
function reasonOf(
  outcome: {malformed: {reason: string}} | {target: unknown},
): string | undefined {
  return 'malformed' in outcome ? outcome.malformed.reason : undefined;
}

/** The target an authority decodes to; the test table's rows all decode. */
function targetOf(authority: string): DecodedTarget {
  const outcome = decodeAuthority(authority);
  return 'malformed' in outcome ? (undefined as never) : outcome;
}

describe('codec rulings (card authority-01b table)', () => {
  it('F-5901 rule 1: a BOM before the JSON is a refusal of its own', () => {
    const payload = hexOf('\uFEFF{"hostName":"h"}');
    strictEqual(reasonOf(decodeAuthority(`ssh-remote+${payload}`)), 'badJson');
  });

  it('F-5901 rule 2: a non-break or ideographic space in a host name is whitespace', () => {
    deepStrictEqual(
      ['a\u00A0b', 'a\u3000b'].map(text =>
        reasonOf(sshRemoteCodec.decode(text)),
      ),
      ['whitespace', 'whitespace'],
    );
  });

  it('F-5901 rule 2: the line and paragraph separators in a host name are whitespace', () => {
    deepStrictEqual(
      ['a\u2028b', 'a\u2029b'].map(text =>
        reasonOf(sshRemoteCodec.decode(text)),
      ),
      ['whitespace', 'whitespace'],
    );
  });

  it('F-5901 rule 2: the C1 control range in a host name is control', () => {
    deepStrictEqual(
      ['a\u0085b', 'a\u009Fb'].map(text =>
        reasonOf(sshRemoteCodec.decode(text)),
      ),
      ['control', 'control'],
    );
  });

  it('F-5901 rule 2: the same rule in the JSON form', () => {
    const payload = hexOf('{"hostName":"a\u0085b"}');
    strictEqual(reasonOf(decodeAuthority(`ssh-remote+${payload}`)), 'control');
  });

  it('F-5901 rule 3: a JSON user that is empty is absent, and encode keeps it plain', () => {
    const payload = hexOf('{"hostName":"h","user":""}');
    deepStrictEqual(
      [
        targetOf(`ssh-remote+${payload}`).target,
        sshRemoteCodec.encode({kind: 'host', hostName: 'h', user: ''}),
      ],
      [{kind: 'host', hostName: 'h'}, 'h'],
    );
  });

  it('F-5901 rule 3: a JSON user that is empty with a port encodes without the key', () => {
    const payload = hexOf('{"hostName":"h","user":"","port":22}');
    deepStrictEqual(
      [
        targetOf(`ssh-remote+${payload}`).target,
        encodeAuthority(targetOf(`ssh-remote+${payload}`)),
      ],
      [
        {kind: 'host', hostName: 'h', port: 22},
        `ssh-remote+${hexOf('{"hostName":"h","port":22}')}`,
      ],
    );
  });

  it('F-5901 rule 4: the wsl default-distro label is its id, and a named distro is the distro', () => {
    deepStrictEqual(
      [wslCodec.label({distro: ''}), wslCodec.label({distro: 'Ubuntu'})],
      ['wsl.defaultDistro', 'Ubuntu'],
    );
  });

  it('F-5901 rule 5: no codec but the registry mentions the registry', () => {
    const codecsDir = path.join(
      import.meta.dirname,
      '..',
      '..',
      'src',
      'codecs',
    );
    deepStrictEqual(
      readdirSync(codecsDir)
        .filter(name => name.endsWith('.ts'))
        .filter(
          name =>
            name !== 'registry.ts' &&
            /registry/i.test(readFileSync(path.join(codecsDir, name), 'utf8')),
        ),
      [],
    );
  });

  it('F-5901 rule 5: the container codec decodes and re-encodes the outer through the injected codec', () => {
    const outer = {decode: decodeAuthority, encode: encodeAuthority};
    const codec = containerCodec('dev-container', outer);
    deepStrictEqual(
      [
        targetOf('dev-container+abcd@ssh-remote+h').target,
        codec.encode({
          payload: 'abcd',
          outer: {
            family: 'ssh-remote',
            target: {kind: 'plain', text: 'h'},
            rawHostString: 'h',
          },
        }),
      ],
      [
        {
          payload: 'abcd',
          outer: {
            family: 'ssh-remote',
            target: {kind: 'plain', text: 'h'},
            rawHostString: 'h',
          },
        },
        'abcd@ssh-remote+h',
      ],
    );
  });

  it('F-5901 rule 5: the wsl codec takes the outer by injection, a fake proving it', () => {
    const fixed = {
      family: 'ssh-remote',
      target: {kind: 'plain', text: 'x'},
      rawHostString: 'x',
    } satisfies DecodedTarget;
    const fakeOuter = {
      decode: () => fixed,
      encode: () => 'ssh-remote+x',
    };
    const outcome = wslCodecOf(fakeOuter).decode('Ubuntu@x');
    deepStrictEqual(
      'target' in outcome ? outcome.target.outer : undefined,
      fixed,
    );
  });

  it('the existing authority-01 tests: a BOM-free hex JSON and a user round-trip are unchanged', () => {
    deepStrictEqual(
      targetOf(`ssh-remote+${hexOf('{"hostName":"h","user":"u"}')}`).target,
      {kind: 'host', hostName: 'h', user: 'u'},
    );
  });
});
