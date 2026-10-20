import {deepStrictEqual} from 'node:assert';
import {
  declaredForwards,
  defaultProtocolOf,
} from '../../src/ports/declared-forwards.ts';

const LOCAL = 'localhost';

describe('the forwards a configuration declares (card containers-72)', () => {
  it('F-1101 AC-1: a port number is a forward to localhost', () => {
    deepStrictEqual(declaredForwards([3000], undefined), {
      forwards: [{host: LOCAL, port: 3000}],
      dashed: [],
    });
  });

  it('F-1101 AC-31: the entries forward in order, and the number 1 and 65535 are the bounds', () => {
    deepStrictEqual(declaredForwards([65535, 1, 80], undefined).forwards, [
      {host: LOCAL, port: 65535},
      {host: LOCAL, port: 1},
      {host: LOCAL, port: 80},
    ]);
  });

  it('F-1101 AC-31: a number outside 1 to 65535, a fraction and a non-number entry are dropped silently', () => {
    deepStrictEqual(
      declaredForwards([0, 65536, 3000.5, null, true, {}, []], undefined),
      {forwards: [], dashed: []},
    );
  });

  it('F-1101 AC-25: a host:port string forwards to that host', () => {
    deepStrictEqual(declaredForwards(['side:8080'], undefined).forwards, [
      {host: 'side', port: 8080},
    ]);
  });

  it('F-1101 AC-37: localhost:port is the same target as the number', () => {
    deepStrictEqual(
      declaredForwards([4000, 'localhost:4000', 'localhost:5000'], undefined)
        .forwards,
      [
        {host: LOCAL, port: 4000},
        {host: LOCAL, port: 5000},
      ],
    );
  });

  it('F-1101 AC-37: a repeated target is forwarded once, at its first place', () => {
    deepStrictEqual(declaredForwards([3000, 4000, 3000], undefined).forwards, [
      {host: LOCAL, port: 3000},
      {host: LOCAL, port: 4000},
    ]);
  });

  it('F-1101 AC-38: the same port on another host is another forward', () => {
    deepStrictEqual(declaredForwards([3000, 'side:3000'], undefined).forwards, [
      {host: LOCAL, port: 3000},
      {host: 'side', port: 3000},
    ]);
  });

  it('F-1101 AC-32: a bare string of digits is dropped silently', () => {
    deepStrictEqual(declaredForwards(['3000'], undefined), {
      forwards: [],
      dashed: [],
    });
  });

  it('F-1101 AC-26: a host that is an address, has a dot, an uppercase letter or an underscore is dropped silently', () => {
    deepStrictEqual(
      declaredForwards(
        ['127.0.0.1:3000', 'my.host:3000', 'Side:3000', 'my_host:3000'],
        undefined,
      ),
      {forwards: [], dashed: []},
    );
  });

  it('F-1101 AC-31: a host:port string with a port outside 1 to 65535 or more than five digits is dropped silently', () => {
    deepStrictEqual(
      declaredForwards(['side:0', 'side:65536', 'side:123456'], undefined),
      {forwards: [], dashed: []},
    );
  });

  it('F-1101 AC-13, AC-16: a negative number, a string with a dash first and a host:port whose port has a dash are reported as written and not forwarded', () => {
    deepStrictEqual(
      declaredForwards([4000, -3000, '-3000', 'myhost:-1234'], undefined),
      {
        forwards: [{host: LOCAL, port: 4000}],
        dashed: ['-3000', '-3000', 'myhost:-1234'],
      },
    );
  });

  it('F-1101 AC-13: a key of portsAttributes that starts with a dash is reported after the entries', () => {
    deepStrictEqual(
      declaredForwards(['-1'], {
        '-3000': {label: 'a'},
        '-3000-4000': {},
        5000: {},
      }),
      {forwards: [], dashed: ['-1', '-3000', '-3000-4000']},
    );
  });

  it('F-1101 AC-13: portsAttributes that is not an object has no keys to report', () => {
    deepStrictEqual(declaredForwards([], ['-1']), {forwards: [], dashed: []});
  });

  it('F-1101 AC-31: a forwardPorts that is not a list declares nothing', () => {
    deepStrictEqual(declaredForwards('3000', undefined), {
      forwards: [],
      dashed: [],
    });
  });
});

describe('the protocol a declared forward opens with (card containers-72)', () => {
  it('F-1101 AC-18: 443 and 8443 open with https when nothing chooses a protocol', () => {
    deepStrictEqual(
      [443, 8443].map(port => defaultProtocolOf(port, undefined, undefined)),
      ['https', 'https'],
    );
  });

  it('F-1101 AC-18: any other port keeps core’s default', () => {
    deepStrictEqual(defaultProtocolOf(8080, undefined, undefined), undefined);
  });

  it('F-1101 AC-18: an entry for the port that sets a protocol, by key or by range, keeps core’s default', () => {
    deepStrictEqual(
      [
        defaultProtocolOf(443, {'443': {protocol: 'http'}}, undefined),
        defaultProtocolOf(8443, {'8000-9000': {protocol: 'http'}}, undefined),
      ],
      [undefined, undefined],
    );
  });

  it('F-1101 AC-18: an entry for the port that sets no protocol leaves https, whatever otherPortsAttributes says', () => {
    deepStrictEqual(
      defaultProtocolOf(443, {'443': {label: 'web'}}, {protocol: 'http'}),
      'https',
    );
  });

  it('F-1101 AC-18: an entry for another port does not count', () => {
    deepStrictEqual(
      defaultProtocolOf(
        443,
        {'80': {protocol: 'http'}, '1-100': {}},
        undefined,
      ),
      'https',
    );
  });

  it('F-1101 AC-18: otherPortsAttributes that sets a protocol keeps core’s default for a port with no entry', () => {
    deepStrictEqual(
      defaultProtocolOf(443, {'80': {}}, {protocol: 'http'}),
      undefined,
    );
  });

  it('F-1101 AC-18: attributes that are not objects, or whose protocol is not text, set no protocol', () => {
    deepStrictEqual(
      [
        defaultProtocolOf(443, {'443': 'x'}, undefined),
        defaultProtocolOf(443, {'443': {protocol: 1}}, undefined),
        defaultProtocolOf(443, undefined, {protocol: 1}),
        defaultProtocolOf(443, [], 'x'),
      ],
      ['https', 'https', 'https', 'https'],
    );
  });
});
