import {deepStrictEqual, strictEqual} from 'node:assert';
import {
  decodeAuthority,
  encodeAuthority,
  sshRemoteCodec,
} from '../../src/index.ts';
import type {SshTarget} from '../../src/index.ts';

const HEX_H_U_2222 =
  '7b22686f73744e616d65223a2268222c2275736572223a2275222c22706f7274223a323232327d';
const HEX_H_PORT_70000 =
  '7b22686f73744e616d65223a2268222c22706f7274223a37303030307d';
const HEX_NO_HOST = '7b2275736572223a2275227d';
const HEX_NULL = '6e756c6c';
const HEX_BAD_USER = '7b22686f73744e616d65223a2268222c2275736572223a34327d';
const HEX_H_U = '7b22686f73744e616d65223a2268222c2275736572223a2275227d';
const HEX_H_PORT_22 = '7b22686f73744e616d65223a2268222c22706f7274223a32327d';

/** The 200 generated ssh-remote targets the property test round-trips, from a seeded generator. */
function seededTargets(count: number): SshTarget[] {
  let state = 0x12345678;
  function next(): number {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  }
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
    const hostName = hostNames[Math.floor(next() * hostNames.length)] ?? 'host';
    if (roll < 0.3) {
      targets.push({kind: 'alias', alias: `alias_${String(index)}`});
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

describe('ssh-remote codec (card authority-01 table)', () => {
  it("decodeAuthority('ssh-remote+myhost') -> host myhost", () => {
    deepStrictEqual(decodeAuthority('ssh-remote+myhost'), {
      family: 'ssh-remote',
      target: {kind: 'host', hostName: 'myhost'},
      rawHostString: 'myhost',
    });
  });

  it("decodeAuthority('ssh-remote+my_host') -> alias my_host", () => {
    deepStrictEqual(decodeAuthority('ssh-remote+my_host'), {
      family: 'ssh-remote',
      target: {kind: 'alias', alias: 'my_host'},
      rawHostString: 'my_host',
    });
  });

  it("decodeAuthority('ssh-remote+' + hex of hostName h, user u, port 2222) -> host h, u, 2222", () => {
    deepStrictEqual(decodeAuthority(`ssh-remote+${HEX_H_U_2222}`), {
      family: 'ssh-remote',
      target: {kind: 'host', hostName: 'h', user: 'u', port: 2222},
      rawHostString: HEX_H_U_2222,
    });
  });

  it("decodeAuthority('ssh-remote+' + hex with port 70000) -> malformed badPort", () => {
    deepStrictEqual(decodeAuthority(`ssh-remote+${HEX_H_PORT_70000}`), {
      malformed: {
        family: 'ssh-remote',
        payload: HEX_H_PORT_70000,
        reason: 'badPort',
      },
    });
  });

  it("decodeAuthority('ssh-remote+' + hex without hostName) -> malformed badJson", () => {
    deepStrictEqual(decodeAuthority(`ssh-remote+${HEX_NO_HOST}`), {
      malformed: {
        family: 'ssh-remote',
        payload: HEX_NO_HOST,
        reason: 'badJson',
      },
    });
  });

  it("decodeAuthority('ssh-remote+' + hex of null) -> malformed badJson", () => {
    deepStrictEqual(decodeAuthority(`ssh-remote+${HEX_NULL}`), {
      malformed: {family: 'ssh-remote', payload: HEX_NULL, reason: 'badJson'},
    });
  });

  it("decodeAuthority('ssh-remote+' + hex with a numeric user) -> malformed badJson (no table row)", () => {
    deepStrictEqual(decodeAuthority(`ssh-remote+${HEX_BAD_USER}`), {
      malformed: {
        family: 'ssh-remote',
        payload: HEX_BAD_USER,
        reason: 'badJson',
      },
    });
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
      malformed: {family: 'ssh-remote', payload: 'a\u0001', reason: 'control'},
    });
  });

  it("decodeAuthority('ssh-remote+[::1]') -> host ::1, and encode gives [::1]", () => {
    deepStrictEqual(
      [
        decodeAuthority('ssh-remote+[::1]'),
        sshRemoteCodec.encode({kind: 'host', hostName: '::1'}),
      ],
      [
        {
          family: 'ssh-remote',
          target: {kind: 'host', hostName: '::1'},
          rawHostString: '[::1]',
        },
        '[::1]',
      ],
    );
  });

  it("encode({kind: 'host', hostName: 'h'}) -> h", () => {
    strictEqual(sshRemoteCodec.encode({kind: 'host', hostName: 'h'}), 'h');
  });

  it("encode({kind: 'host', hostName: 'h', user: 'u'}) -> hex of {hostName, user}", () => {
    strictEqual(
      sshRemoteCodec.encode({kind: 'host', hostName: 'h', user: 'u'}),
      HEX_H_U,
    );
  });

  it("encode({kind: 'host', hostName: 'h', port: 22}) -> hex of {hostName, port}", () => {
    strictEqual(
      sshRemoteCodec.encode({kind: 'host', hostName: 'h', port: 22}),
      HEX_H_PORT_22,
    );
  });

  it('label of an alias, a host, a user host, a port host and a user port host -> the present parts', () => {
    deepStrictEqual(
      [
        sshRemoteCodec.label({kind: 'alias', alias: 'a'}),
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

  it('for 200 generated targets, decode(encode(target)) -> deep-equals the target', () => {
    const targets = seededTargets(200);
    const outcomes = targets.map(target =>
      sshRemoteCodec.decode(sshRemoteCodec.encode(target)),
    );
    deepStrictEqual(
      [
        outcomes.every(outcome => 'target' in outcome),
        outcomes.map(outcome => (outcome as {target: SshTarget}).target),
      ],
      [true, targets],
    );
  });

  it('for the three fixed forms, encode(decode(authority)) -> equals the authority', () => {
    const forms = [
      'ssh-remote+myhost',
      `ssh-remote+${HEX_H_U}`,
      'ssh-remote+my_alias',
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
