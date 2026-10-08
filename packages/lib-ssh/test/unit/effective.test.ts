import {deepStrictEqual, match} from 'node:assert';
import {readFileSync} from 'node:fs';
import {parseEffectiveOptions} from '../../src/index.ts';

function fixtureText(name: string): string {
  const fixture = JSON.parse(
    readFileSync(
      new URL(`../fixtures/effective/${name}.json`, import.meta.url),
      'utf8',
    ),
  ) as {source: string; text: string};
  return fixture.text;
}

describe('parseEffectiveOptions (the options of the ssh -G output)', () => {
  it('F-2105.BR-1: the recorded options, local forwards included', () => {
    deepStrictEqual(parseEffectiveOptions(fixtureText('recorded')), {
      options: {
        hostName: '127.0.0.1',
        user: 'dev',
        port: '2222',
        connectTimeout: '21',
        remoteCommand: 'echo "hi there"',
        localForwards: ['8080 [127.0.0.1]:80', '8081 [127.0.0.1]:81'],
      },
    });
  });

  it('F-2105.BR-2: the bare options leave the unset ones out', () => {
    deepStrictEqual(parseEffectiveOptions(fixtureText('bare')), {
      options: {
        hostName: '192.0.2.10',
        user: 'dev',
        port: '22',
        localForwards: [],
      },
    });
  });

  it('F-2105.BR-2: connecttimeout 0 is a value', () => {
    deepStrictEqual(
      parseEffectiveOptions('hostname h\nuser u\nport 22\nconnecttimeout 0'),
      {
        options: {
          hostName: 'h',
          user: 'u',
          port: '22',
          connectTimeout: '0',
          localForwards: [],
        },
      },
    );
  });

  it('F-2107.BR-1: remotecommand none leaves the option out', () => {
    deepStrictEqual(
      parseEffectiveOptions('hostname h\nuser u\nport 22\nremotecommand none'),
      {options: {hostName: 'h', user: 'u', port: '22', localForwards: []}},
    );
  });

  it('F-2107.BR-1 (provisional): a remotecommand without a value leaves the option out', () => {
    deepStrictEqual(
      parseEffectiveOptions('hostname h\nuser u\nport 22\nremotecommand'),
      {options: {hostName: 'h', user: 'u', port: '22', localForwards: []}},
    );
  });

  it('F-2105.6.2 (provisional): keywords in any case fold to lower case', () => {
    deepStrictEqual(parseEffectiveOptions('HostName h\nUSER dev\nPort 22'), {
      options: {hostName: 'h', user: 'dev', port: '22', localForwards: []},
    });
  });

  it('F-2107.BR-1: a remote command keeps its inner blanks', () => {
    deepStrictEqual(
      parseEffectiveOptions(
        "hostname h\nuser u\nport 22\nremotecommand sh -c 'a  b'",
      ),
      {
        options: {
          hostName: 'h',
          user: 'u',
          port: '22',
          remoteCommand: "sh -c 'a  b'",
          localForwards: [],
        },
      },
    );
  });

  it('F-2202.BR-21: local forwards in printed order', () => {
    deepStrictEqual(
      parseEffectiveOptions(
        'hostname h\nuser u\nport 22\n' +
          'localforward 1 [127.0.0.1]:2\n' +
          'localforward 1 [127.0.0.1]:2\n' +
          'localforward 3 [127.0.0.1]:4',
      ),
      {
        options: {
          hostName: 'h',
          user: 'u',
          port: '22',
          localForwards: [
            '1 [127.0.0.1]:2',
            '1 [127.0.0.1]:2',
            '3 [127.0.0.1]:4',
          ],
        },
      },
    );
  });

  it('F-2202.BR-21: the first hostname wins', () => {
    deepStrictEqual(
      parseEffectiveOptions('hostname first\nhostname second\nuser u\nport 22'),
      {
        options: {
          hostName: 'first',
          user: 'u',
          port: '22',
          localForwards: [],
        },
      },
    );
  });

  it('S4 contract: the six known options, the rest ignored', () => {
    deepStrictEqual(
      parseEffectiveOptions(
        'hostname h\nuser u\nport 22\nidentityfile ~/x\ncompression no',
      ),
      {options: {hostName: 'h', user: 'u', port: '22', localForwards: []}},
    );
  });

  it('S4 contract: CRLF line ends', () => {
    deepStrictEqual(
      parseEffectiveOptions('hostname h\r\nuser u\r\nport 22\r\n'),
      {options: {hostName: 'h', user: 'u', port: '22', localForwards: []}},
    );
  });

  it('S4 contract: blank lines between the basic lines', () => {
    deepStrictEqual(parseEffectiveOptions('hostname h\n\nuser u\n\nport 22'), {
      options: {hostName: 'h', user: 'u', port: '22', localForwards: []},
    });
  });

  for (const [given, text] of [
    ['without hostname', 'user u\nport 22'],
    ['without user', 'hostname h\nport 22'],
    ['without port', 'hostname h\nuser u'],
    ['empty', ''],
  ] as const) {
    it(`S4 contract: text ${given} is a parse error`, () => {
      match(
        JSON.stringify(parseEffectiveOptions(text)),
        /^\{"parseError":".+"\}$/,
      );
    });
  }
});
