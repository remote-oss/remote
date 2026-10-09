import {deepStrictEqual, strictEqual} from 'node:assert';
import {
  decodeAuthority,
  encodeAuthority,
  sshRemoteCodec,
} from '../../src/index.ts';
import type {SshTarget} from '../../src/index.ts';

function hexOf(text: string): string {
  return Buffer.from(text).toString('hex');
}

const HEX_H_U_2222 = hexOf('{"hostName":"h","user":"u","port":2222}');
const HEX_H_PORT_22 = hexOf('{"hostName":"h","port":22}');
const HEX_H_U = hexOf('{"hostName":"h","user":"u"}');
const HEX_MIXED = hexOf('{"hostName":"Mixed.invalid"}');
const HEX_U_UPPER = hexOf('{"hostName":"Ü.invalid"}');
const HEX_SLASH = hexOf('{"hostName":"a/b"}');
const HEX_PLUS = hexOf('{"hostName":"a+b"}');
const HEX_BACKSLASH = hexOf('{"hostName":"a\\\\b"}');
const HEX_UPPER_PLAIN = hexOf('{"hostName":"UPPER-Alias"}');
const HEX_NO_HOST = hexOf('{"user":"u"}');
const HEX_EMPTY_HOST = hexOf('{"hostName":""}');
const HEX_PORT_2X = hexOf('{"hostName":"h","port":"2x"}');
const HEX_PORT_70000 = hexOf('{"hostName":"h","port":70000}');
const HEX_PORT_0 = hexOf('{"hostName":"h","port":0}');
const HEX_PORT_22_DIGITS = hexOf('{"hostName":"h","port":"22"}');
const HEX_IPV6_PORT = hexOf('{"hostName":"::1","port":22}');
const HEX_PORT_2_5 = hexOf('{"hostName":"h","port":2.5}');
const HEX_NOT_JSON = hexOf('123456');
const HEX_BYTES_NOT_JSON = hexOf('ab');
const HEX_ARRAY = hexOf('[1]');
const HEX_USER_NUM = hexOf('{"hostName":"h","user":7}');

/** The 200 generated ssh-remote targets the property test round-trips, from a seeded generator. */
function seededTargets(count: number): SshTarget[] {
  let state = 0x12345678;
  function next(): number {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  }
  const plainTexts = [
    'alias_one',
    'a_b.invalid',
    'a%b.invalid',
    'host',
    'myhost',
    'box',
    'c.d',
    'e-f',
    'g.h.i',
    'v1',
    '::1',
  ];
  const hostNames = [
    'host',
    'myhost',
    'box',
    'c.d',
    'e-f',
    'g.h.i',
    'ip',
    'v1',
  ];
  const users = ['u', 'alice', 'bob'];
  const targets: SshTarget[] = [];
  for (let index = 0; index < count; index += 1) {
    const roll = next();
    const plainText =
      plainTexts[Math.floor(next() * plainTexts.length)] ?? 'alias_one';
    const hostName = hostNames[Math.floor(next() * hostNames.length)] ?? 'host';
    if (roll < 0.3) {
      targets.push({kind: 'plain', text: plainText});
    } else if (roll < 0.6) {
      targets.push({kind: 'host', hostName});
    } else if (roll < 0.8) {
      const user = users[Math.floor(next() * users.length)] ?? 'u';
      targets.push({kind: 'host', hostName, user});
    } else {
      const port = 1 + Math.floor(next() * 65535);
      targets.push({kind: 'host', hostName, port});
    }
  }
  return targets;
}

/** The plain/host collapse the property test allows: a plain host back as a plain text. */
function collapsed(target: SshTarget): SshTarget {
  if (
    target.kind === 'host' &&
    target.user === undefined &&
    target.port === undefined
  ) {
    return {kind: 'plain', text: target.hostName};
  }
  return target;
}

describe('ssh-remote codec (card authority-01 table)', () => {
  it("decodeAuthority('ssh-remote+myhost') -> plain myhost", () => {
    deepStrictEqual(decodeAuthority('ssh-remote+myhost'), {
      family: 'ssh-remote',
      target: {kind: 'plain', text: 'myhost'},
      rawHostString: 'myhost',
    });
  });

  it('the plain texts a_b.invalid, a%b.invalid, abcd, ff, ::1, [::1] and lab@ -> plain as written', () => {
    const texts = [
      'a_b.invalid',
      'a%b.invalid',
      'abcd',
      'ff',
      '::1',
      '[::1]',
      'lab@',
    ];
    deepStrictEqual(
      texts.map(text => {
        const outcome = decodeAuthority(`ssh-remote+${text}`);
        return 'malformed' in outcome
          ? `malformed:${outcome.malformed.reason}`
          : outcome.target;
      }),
      texts.map(text => ({kind: 'plain', text})),
    );
  });

  it("decodeAuthority('ssh-remote+' + hex of hostName h, user u, port 2222) -> host h, u, 2222", () => {
    deepStrictEqual(decodeAuthority(`ssh-remote+${HEX_H_U_2222}`), {
      family: 'ssh-remote',
      target: {kind: 'host', hostName: 'h', user: 'u', port: 2222},
      rawHostString: HEX_H_U_2222,
    });
  });

  it('hex JSON with a digit-string port "22" -> host with port 22', () => {
    deepStrictEqual(decodeAuthority(`ssh-remote+${HEX_PORT_22_DIGITS}`), {
      family: 'ssh-remote',
      target: {kind: 'host', hostName: 'h', port: 22},
      rawHostString: HEX_PORT_22_DIGITS,
    });
  });

  it('hex JSON with port "2x", 70000 and 0 -> malformed badPort', () => {
    deepStrictEqual(
      [HEX_PORT_2X, HEX_PORT_70000, HEX_PORT_0].map(payload => {
        const outcome = decodeAuthority(`ssh-remote+${payload}`);
        return 'malformed' in outcome ? outcome.malformed.reason : undefined;
      }),
      ['badPort', 'badPort', 'badPort'],
    );
  });

  it('hex JSON with a non-integer number port 2.5 -> malformed badPort', () => {
    deepStrictEqual(decodeAuthority(`ssh-remote+${HEX_PORT_2_5}`), {
      malformed: {
        family: 'ssh-remote',
        payload: HEX_PORT_2_5,
        reason: 'badPort',
      },
    });
  });

  it('hex JSON without hostName, and hostName "" -> malformed badJson', () => {
    deepStrictEqual(
      [HEX_NO_HOST, HEX_EMPTY_HOST].map(payload => {
        const outcome = decodeAuthority(`ssh-remote+${payload}`);
        return 'malformed' in outcome ? outcome.malformed.reason : undefined;
      }),
      ['badJson', 'badJson'],
    );
  });

  it('a hex payload whose bytes are not JSON, or a JSON array -> plain as written', () => {
    deepStrictEqual(
      [HEX_NOT_JSON, HEX_BYTES_NOT_JSON, HEX_ARRAY].map(payload => {
        const outcome = decodeAuthority(`ssh-remote+${payload}`);
        return 'malformed' in outcome
          ? outcome.malformed.reason
          : outcome.target;
      }),
      [
        {kind: 'plain', text: HEX_NOT_JSON},
        {kind: 'plain', text: HEX_BYTES_NOT_JSON},
        {kind: 'plain', text: HEX_ARRAY},
      ],
    );
  });

  it('hex JSON with a non-string user 7 -> malformed badJson', () => {
    deepStrictEqual(decodeAuthority(`ssh-remote+${HEX_USER_NUM}`), {
      malformed: {
        family: 'ssh-remote',
        payload: HEX_USER_NUM,
        reason: 'badJson',
      },
    });
  });

  it('hex JSON {"hostName":"::1","port":22} -> host ::1 port 22; encode gives the same hex', () => {
    const outcome = decodeAuthority(`ssh-remote+${HEX_IPV6_PORT}`);
    deepStrictEqual(
      [
        'malformed' in outcome
          ? `malformed:${outcome.malformed.reason}`
          : outcome.target,
        sshRemoteCodec.encode({kind: 'host', hostName: '::1', port: 22}),
      ],
      [{kind: 'host', hostName: '::1', port: 22}, HEX_IPV6_PORT],
    );
  });

  it("decodeAuthority('ssh-remote+') -> malformed empty", () => {
    deepStrictEqual(decodeAuthority('ssh-remote+'), {
      malformed: {family: 'ssh-remote', payload: '', reason: 'empty'},
    });
  });

  it("decodeAuthority('ssh-remote+a b') -> malformed whitespace", () => {
    deepStrictEqual(decodeAuthority('ssh-remote+a b'), {
      malformed: {family: 'ssh-remote', payload: 'a b', reason: 'whitespace'},
    });
  });

  it("decodeAuthority('ssh-remote+a\\u0001') -> malformed control", () => {
    deepStrictEqual(decodeAuthority('ssh-remote+a\u0001'), {
      malformed: {
        family: 'ssh-remote',
        payload: 'a\u0001',
        reason: 'control',
      },
    });
  });

  it("encode({kind:'plain', text:'a_b.invalid'}) -> a_b.invalid", () => {
    strictEqual(
      sshRemoteCodec.encode({kind: 'plain', text: 'a_b.invalid'}),
      'a_b.invalid',
    );
  });

  it("encode({kind:'host', hostName:'h'}) -> h, plain", () => {
    strictEqual(sshRemoteCodec.encode({kind: 'host', hostName: 'h'}), 'h');
  });

  it('encode of Mixed.invalid, Ü.invalid, a/b, a+b and a\\b -> the hex JSON form each', () => {
    deepStrictEqual(
      ['Mixed.invalid', 'Ü.invalid', 'a/b', 'a+b', 'a\\b'].map(text =>
        sshRemoteCodec.encode({kind: 'host', hostName: text}),
      ),
      [HEX_MIXED, HEX_U_UPPER, HEX_SLASH, HEX_PLUS, HEX_BACKSLASH],
    );
  });

  it("encode({kind:'host', hostName:'h', user:'u'}) -> hex of {hostName, user}", () => {
    strictEqual(
      sshRemoteCodec.encode({kind: 'host', hostName: 'h', user: 'u'}),
      HEX_H_U,
    );
  });

  it("encode({kind:'host', hostName:'h', port:22}) -> hex of {hostName, port}", () => {
    strictEqual(
      sshRemoteCodec.encode({kind: 'host', hostName: 'h', port: 22}),
      HEX_H_PORT_22,
    );
  });

  it("encode({kind:'plain', text:'UPPER-Alias'}) -> hex of {hostName: UPPER-Alias}", () => {
    strictEqual(
      sshRemoteCodec.encode({kind: 'plain', text: 'UPPER-Alias'}),
      HEX_UPPER_PLAIN,
    );
  });

  it('label of plain a, host h, u@h, h port 22 and u@h port 22 -> the present parts', () => {
    deepStrictEqual(
      [
        sshRemoteCodec.label({kind: 'plain', text: 'a'}),
        sshRemoteCodec.label({kind: 'host', hostName: 'h'}),
        sshRemoteCodec.label({kind: 'host', hostName: 'h', user: 'u'}),
        sshRemoteCodec.label({kind: 'host', hostName: 'h', port: 22}),
        sshRemoteCodec.label({
          kind: 'host',
          hostName: 'h',
          user: 'u',
          port: 22,
        }),
      ],
      ['a', 'h', 'u@h', 'h:22', 'u@h:22'],
    );
  });

  it('for 200 generated targets, decode(encode(target)) -> the target up to the plain/host collapse', () => {
    const targets = seededTargets(200);
    deepStrictEqual(
      targets.map(target => {
        const encoded = sshRemoteCodec.encode(target);
        const outcome = sshRemoteCodec.decode(encoded);
        return 'target' in outcome ? outcome.target : undefined;
      }),
      targets.map(collapsed),
    );
  });

  it('for each fixed form, encode(decode(authority)) -> the authority, plain and hex', () => {
    const forms = [
      'ssh-remote+a_b.invalid',
      'ssh-remote+myhost',
      `ssh-remote+${HEX_H_U}`,
      `ssh-remote+${HEX_H_PORT_22}`,
    ];
    deepStrictEqual(
      forms.map(authority => {
        const outcome = decodeAuthority(authority);
        return 'malformed' in outcome
          ? `malformed:${outcome.malformed.reason}`
          : encodeAuthority(outcome);
      }),
      forms,
    );
  });
});
