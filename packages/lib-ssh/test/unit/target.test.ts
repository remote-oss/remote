import {deepStrictEqual, strictEqual} from 'node:assert';
import {validateTarget} from '../../src/index.ts';
import type {SshTarget} from '../../src/index.ts';

/** A target with a host, and a user when the row has one. */
function makeTarget(host: string, user?: string): SshTarget {
  const target: SshTarget = {host};
  if (user !== undefined) {
    target.user = user;
  }
  return target;
}

describe('validateTarget (the name checks that run before any ssh exists)', () => {
  it('F-2205.BR-1 / AC-2: an option-looking host is refused at its dash', () => {
    deepStrictEqual(validateTarget(makeTarget('-oProxyCommand=x')), {
      kind: 'invalidHost',
      reason: 'S119',
      character: '-',
    });
  });

  const DASH_HOSTS = ['-', '--x'] as const;
  for (const host of DASH_HOSTS) {
    it(`F-2205.7.E1: a host of ${host} is refused at its dash`, () => {
      deepStrictEqual(validateTarget(makeTarget(host)), {
        kind: 'invalidHost',
        reason: 'S119',
        character: '-',
      });
    });
  }

  it('F-2205.BR-2: a leading dash wins over a forbidden character', () => {
    deepStrictEqual(validateTarget(makeTarget('-a%b')), {
      kind: 'invalidHost',
      reason: 'S119',
      character: '-',
    });
  });

  const FORBIDDEN_HOSTS: Array<[string, string]> = [
    ['a\\b', '\\'],
    ["a'b", "'"],
    ['a"b', '"'],
    ['a`b', '`'],
    ['a!b', '!'],
    ['a%b', '%'],
  ];
  for (const [host, character] of FORBIDDEN_HOSTS) {
    it(`F-2205.AC-4: a host of ${host} is refused at ${character}`, () => {
      deepStrictEqual(validateTarget(makeTarget(host)), {
        kind: 'invalidHost',
        reason: 'S120',
        character,
      });
    });
  }

  const FIRST_FORBIDDEN_HOSTS: Array<[string, string]> = [
    ["a%b'c", "'"],
    ['a!b`c', '`'],
    ['a`%b', '`'],
    ['a!%\\"\'`b', '\\'],
  ];
  for (const [host, character] of FIRST_FORBIDDEN_HOSTS) {
    it(`F-2205.AC-5: a host of ${host} is refused at ${character}`, () => {
      deepStrictEqual(validateTarget(makeTarget(host)), {
        kind: 'invalidHost',
        reason: 'S120',
        character,
      });
    });
  }

  it('F-2205.AC-6: a user starting with a dash is refused', () => {
    deepStrictEqual(validateTarget(makeTarget('h.invalid', '-u')), {
      kind: 'invalidUser',
      reason: 'S121',
      character: '-',
    });
  });

  const FORBIDDEN_USERS: Array<[string, string]> = [
    ['u\\x', '\\'],
    ["u'x", "'"],
    ['u"x', '"'],
    ['u`x', '`'],
    ['u!x', '!'],
    ['u%x', '%'],
  ];
  for (const [user, character] of FORBIDDEN_USERS) {
    it(`F-2205.AC-7: a user of ${user} is refused at ${character}`, () => {
      deepStrictEqual(validateTarget(makeTarget('h.invalid', user)), {
        kind: 'invalidUser',
        reason: 'S122',
        character,
      });
    });
  }

  it('F-2205.BR-3: the first forbidden user character in the fixed order', () => {
    deepStrictEqual(validateTarget(makeTarget('h.invalid', "u%x'y")), {
      kind: 'invalidUser',
      reason: 'S122',
      character: "'",
    });
  });

  it('F-2205.AC-8: a bad host wins over a bad user', () => {
    deepStrictEqual(validateTarget(makeTarget('-h', '-u')), {
      kind: 'invalidHost',
      reason: 'S119',
      character: '-',
    });
  });

  it('F-2205.AC-8: a host character wins over a user character', () => {
    deepStrictEqual(validateTarget(makeTarget('a%b', 'u%')), {
      kind: 'invalidHost',
      reason: 'S120',
      character: '%',
    });
  });

  it('F-2205.AC-8: a leading host dash wins over a user character', () => {
    deepStrictEqual(validateTarget(makeTarget('-h', 'u%')), {
      kind: 'invalidHost',
      reason: 'S119',
      character: '-',
    });
  });

  it('F-2205.AC-8: a valid host leaves the bad user to report', () => {
    deepStrictEqual(validateTarget(makeTarget('a b', '-u')), {
      kind: 'invalidUser',
      reason: 'S121',
      character: '-',
    });
  });

  it('F-2205.AC-9: the host is checked before the port', () => {
    deepStrictEqual(validateTarget({host: 'a%b', user: 'u', port: 2222}), {
      kind: 'invalidHost',
      reason: 'S120',
      character: '%',
    });
  });

  const ALLOWED_HOSTS = [
    '.ab',
    '_ab',
    '~ab',
    '+ab',
    '/ab',
    '1ab',
    'ab-',
    'a-b',
    'a*b',
    'a?b',
    'a#b',
    'a[b]',
    'a=b',
    'a^b',
    'a:b',
    'äb',
  ] as const;
  for (const host of ALLOWED_HOSTS) {
    it(`F-2205.7.E10: a host of ${host} passes`, () => {
      deepStrictEqual(validateTarget(makeTarget(host)), undefined);
    });
  }

  const SSH_JUDGED_HOSTS = [
    'a;b',
    'a b',
    'a$b',
    'a(b',
    'a<b',
    'a{b',
    'a,b',
  ] as const;
  for (const host of SSH_JUDGED_HOSTS) {
    it(`F-2205.BR-1: a host of ${host} passes to ssh`, () => {
      deepStrictEqual(validateTarget(makeTarget(host)), undefined);
    });
  }

  const ALLOWED_USERS = [
    ' ',
    '$',
    '.u',
    '1u',
    'u-x',
    'u*x',
    'u?x',
    'u#x',
    'u,x',
    'u[x',
    'u=x',
    'u;x',
    'u(x',
    'u<x',
  ] as const;
  for (const user of ALLOWED_USERS) {
    it(`F-2205.7.E10: a user of ${user} passes`, () => {
      deepStrictEqual(validateTarget(makeTarget('h.invalid', user)), undefined);
    });
  }

  it('F-2205.7.E10: an empty user never blocks a bad host', () => {
    deepStrictEqual(validateTarget({host: '-h', user: ''}), {
      kind: 'invalidHost',
      reason: 'S119',
      character: '-',
    });
  });

  it('F-2205.7.E10: an empty host passes', () => {
    deepStrictEqual(validateTarget(makeTarget('', 'u')), undefined);
  });

  it('F-2205.7.E10: a host without a user passes', () => {
    deepStrictEqual(validateTarget(makeTarget('h.invalid')), undefined);
  });

  it('F-2205.7.E10: a host with an empty user passes', () => {
    deepStrictEqual(validateTarget({host: 'h.invalid', user: ''}), undefined);
  });

  const CONTROL_HOSTS: Array<[string, string]> = [
    ['a\nb', 'U+000A'],
    ['a\tb', 'U+0009'],
    ['\u007Fx', 'U+007F'],
    ['a\u0000b\u001F', 'U+0000'],
  ];
  for (const [host, codePoint] of CONTROL_HOSTS) {
    it(`F-2205.AC-37: a host of ${host} is refused at ${codePoint}`, () => {
      deepStrictEqual(validateTarget(makeTarget(host)), {
        kind: 'invalidHost',
        reason: 'S120',
        character: codePoint,
      });
    });
  }

  it('F-2205.AC-37: a control character in the user is not checked', () => {
    deepStrictEqual(
      validateTarget(makeTarget('host.example', 'u\nu')),
      undefined,
    );
  });

  it('F-2205.BR-1: a host of a space keeps the pre-existing pass', () => {
    deepStrictEqual(validateTarget(makeTarget('a b')), undefined);
  });

  it('F-2205.AC-37: a refused control host gives the caller no invocation to build', () => {
    const problem = validateTarget(makeTarget('a\nb'));
    strictEqual(
      problem === undefined ? false : problem.kind === 'invalidHost',
      true,
    );
  });

  it('F-2205.AC-37: a valid host and a plain host keep passing', () => {
    deepStrictEqual(validateTarget(makeTarget('host.example')), undefined);
  });
});
