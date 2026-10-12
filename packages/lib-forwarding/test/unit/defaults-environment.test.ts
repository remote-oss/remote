import {deepStrictEqual} from 'node:assert';
import {environmentTunnels} from '../../src/index.ts';

function address(host: string, port: number) {
  return {host, port};
}

describe('environmentTunnels (card forwarding-02 table)', () => {
  it('F-2507.AC-23: maps a bind address and a target', () => {
    deepStrictEqual(environmentTunnels(['127.0.0.1:13000 127.0.0.1:8000']), {
      tunnels: [
        {
          remoteAddress: address('127.0.0.1', 8000),
          localAddress: address('127.0.0.1', 13000),
        },
      ],
      skipped: [],
    });
  });

  it('F-2507.AC-24: a listen port alone is on localhost', () => {
    deepStrictEqual(environmentTunnels(['13002 localhost:8000']).tunnels, [
      {
        remoteAddress: address('localhost', 8000),
        localAddress: address('localhost', 13002),
      },
    ]);
  });

  it('F-2507.BR-10: a localhost bind is on localhost', () => {
    deepStrictEqual(
      environmentTunnels(['localhost:13003 127.0.0.1:8001']).tunnels,
      [
        {
          remoteAddress: address('127.0.0.1', 8001),
          localAddress: address('localhost', 13003),
        },
      ],
    );
  });

  it('F-2507.AC-24: a named target host is kept', () => {
    deepStrictEqual(environmentTunnels(['13004 db.invalid:22']).tunnels, [
      {
        remoteAddress: address('db.invalid', 22),
        localAddress: address('localhost', 13004),
      },
    ]);
  });

  it('F-2507.AC-35: one entry gives one tunnel', () => {
    deepStrictEqual(
      environmentTunnels(['13002 localhost:8000']).tunnels.length,
      1,
    );
  });

  it('F-2507.BR-10: a bracketed target is unwrapped', () => {
    deepStrictEqual(environmentTunnels(['8080 [127.0.0.1]:80']).tunnels, [
      {
        remoteAddress: address('127.0.0.1', 80),
        localAddress: address('localhost', 8080),
      },
    ]);
  });

  it('F-2507.BR-10 (provisional): a bracketed bind is unwrapped', () => {
    deepStrictEqual(
      environmentTunnels(['[127.0.0.1]:13000 [127.0.0.1]:8000']).tunnels,
      [
        {
          remoteAddress: address('127.0.0.1', 8000),
          localAddress: address('127.0.0.1', 13000),
        },
      ],
    );
  });

  it('F-2507.BR-10: repeated blanks separate the two parts', () => {
    deepStrictEqual(environmentTunnels(['13000   h.invalid:80']).tunnels, [
      {
        remoteAddress: address('h.invalid', 80),
        localAddress: address('localhost', 13000),
      },
    ]);
  });

  it('F-2507.BR-10: tunnels are in input order', () => {
    deepStrictEqual(
      environmentTunnels([
        '13000 a.invalid:80',
        '13001 b.invalid:81',
      ]).tunnels.map(tunnel => tunnel.localAddress.port),
      [13000, 13001],
    );
  });

  it('F-2507.6.2 (provisional): a local socket is skipped', () => {
    deepStrictEqual(environmentTunnels(['/tmp/f.sock 127.0.0.1:8000']), {
      tunnels: [],
      skipped: [{index: 0, reason: 'localSocket'}],
    });
  });

  it('F-2507.6.2 (provisional): a remote socket is skipped', () => {
    deepStrictEqual(environmentTunnels(['13005 /tmp/r.sock']), {
      tunnels: [],
      skipped: [{index: 0, reason: 'remoteSocket'}],
    });
  });

  const ipv6 = [
    '[::1]:13006 [::1]:8000',
    '13007 [::1]:8000',
    '[::1]:13008 h.invalid:80',
  ];
  for (const text of ipv6) {
    it(`F-2507.6.2 (provisional): ${text} has a bracketed IPv6 address`, () => {
      deepStrictEqual(environmentTunnels([text]), {
        tunnels: [],
        skipped: [{index: 0, reason: 'bracketedIpv6'}],
      });
    });
  }

  const badPorts = [
    '70000 h:80',
    '0 h:80',
    'abc h:80',
    '13000 h:abc',
    '13000 h:0',
    '13000 h:',
    '-5 h:80',
  ];
  for (const text of badPorts) {
    it(`F-2507.BR-10 (provisional): ${JSON.stringify(text)} has a bad port`, () => {
      deepStrictEqual(environmentTunnels([text]).skipped, [
        {index: 0, reason: 'badPort'},
      ]);
    });
  }

  const badShapes = [
    '',
    '13000',
    '13000 h:80 extra',
    '13000 h80',
    ':13000 h:80',
    '13000 :80',
    '[h 13000',
  ];
  for (const text of badShapes) {
    it(`F-2507.BR-10 (provisional): ${JSON.stringify(text)} has a bad shape`, () => {
      deepStrictEqual(environmentTunnels([text]).skipped, [
        {index: 0, reason: 'badShape'},
      ]);
    });
  }

  it('F-2507.BR-10 (provisional): valid entries stay when others are skipped', () => {
    deepStrictEqual(
      environmentTunnels(['13000 h:80', 'x', '13001 h:81', '/s h:1']),
      {
        tunnels: [
          {
            remoteAddress: address('h', 80),
            localAddress: address('localhost', 13000),
          },
          {
            remoteAddress: address('h', 81),
            localAddress: address('localhost', 13001),
          },
        ],
        skipped: [
          {index: 1, reason: 'badShape'},
          {index: 3, reason: 'localSocket'},
        ],
      },
    );
  });

  it('F-2507.BR-10: an empty list gives empty lists', () => {
    deepStrictEqual(environmentTunnels([]), {tunnels: [], skipped: []});
  });

  it('F-2507.BR-7: mapping the same list twice gives equal results', () => {
    const list = ['13000 h:80', 'x'];
    deepStrictEqual(environmentTunnels(list), environmentTunnels(list));
  });

  it('F-2507.BR-7: the list is not modified', () => {
    const list = ['13000 h:80', 'x'];
    environmentTunnels(list);
    deepStrictEqual(list, ['13000 h:80', 'x']);
  });
});
