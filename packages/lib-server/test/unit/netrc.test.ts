import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {authorizationOf, parseNetrc} from '../../src/transfer/netrc.ts';

const ENTRY = {
  machine: 'files.example.invalid',
  login: 'alice',
  password: 'secret',
};

function basic(login: string, password: string): string {
  return `Basic ${Buffer.from(`${login}:${password}`, 'utf8').toString('base64')}`;
}

describe('the netrc parser (card server-23)', () => {
  it('server-23: one entry, on one line or on several', () => {
    deepStrictEqual(
      [
        parseNetrc('machine files.example.invalid login alice password secret'),
        parseNetrc(
          'machine files.example.invalid\n  login alice\n\tpassword secret\n',
        ),
      ],
      [[ENTRY], [ENTRY]],
    );
  });

  it('server-23: several entries come in file order', () => {
    deepStrictEqual(
      parseNetrc(
        'machine one.invalid login a password b\nmachine two.invalid login c password d',
      ),
      [
        {machine: 'one.invalid', login: 'a', password: 'b'},
        {machine: 'two.invalid', login: 'c', password: 'd'},
      ],
    );
  });

  it('server-23: a quoted password keeps its space and its escapes', () => {
    deepStrictEqual(
      parseNetrc(
        'machine files.example.invalid login alice password "a b\\"c\\\\d\\ne\\rf\\tg\\x"',
      ),
      [{...ENTRY, password: 'a b"c\\d\ne\rf\tg\\x'}],
    );
  });

  it('server-23: a # at the start of a token drops the rest of its line, and a # inside a token stays', () => {
    deepStrictEqual(
      parseNetrc(
        '# machine other.invalid login x password y\nmachine files.example.invalid login alice # a note\npassword sec#ret\n',
      ),
      [{...ENTRY, password: 'sec#ret'}],
    );
  });

  it('server-23: default and macdef (with its lines) are ignored and take no entry', () => {
    deepStrictEqual(
      parseNetrc(
        [
          'default login anon password anon',
          'macdef init',
          'machine in-macro.invalid login x password y',
          '',
          'machine files.example.invalid login alice password secret',
          'default',
          'login z password z',
        ].join('\n'),
      ),
      [ENTRY],
    );
  });

  it('server-23: a macdef with no blank line after it runs to the end of the text', () => {
    deepStrictEqual(
      [
        parseNetrc(
          'machine files.example.invalid login alice password secret\nmacdef init\nmachine x.invalid login a password b',
        ),
        parseNetrc('macdef init'),
      ],
      [[ENTRY], []],
    );
  });

  it('server-23: an entry with only a login, only a password, or an empty one is dropped', () => {
    deepStrictEqual(
      parseNetrc(
        'machine a.invalid login alice\nmachine b.invalid password secret\nmachine c.invalid login alice password ""\nmachine d.invalid login "" password secret\nmachine files.example.invalid login alice password secret',
      ),
      [ENTRY],
    );
  });

  it('server-23: account is read and ignored, and an unknown keyword is skipped with its token', () => {
    deepStrictEqual(
      parseNetrc(
        'machine files.example.invalid account acct port 99 login alice password secret',
      ),
      [ENTRY],
    );
  });

  it('server-23: login and password before any machine take no entry', () => {
    deepStrictEqual(parseNetrc('login alice password secret'), []);
  });

  it('server-23: an unterminated quote ends the text, and the entry before it stays', () => {
    deepStrictEqual(
      [
        parseNetrc(
          'machine files.example.invalid login alice password secret\nmachine b.invalid login x password "oops',
        ),
        parseNetrc('machine files.example.invalid login alice password "oops'),
      ],
      [[ENTRY], []],
    );
  });

  it('server-23: a keyword with no token after it ends the text', () => {
    deepStrictEqual(
      [
        parseNetrc(
          'machine files.example.invalid login alice password secret\nmachine',
        ),
        parseNetrc('machine files.example.invalid login alice password'),
      ],
      [[ENTRY], []],
    );
  });

  it('server-23: an empty text has no entries', () => {
    deepStrictEqual(parseNetrc(''), []);
  });
});

describe('the authorization of an address (card server-23)', () => {
  function sceneOf(): {
    authorization: ReturnType<typeof authorizationOf>;
    sink: MemorySink;
  } {
    const sink = new MemorySink();
    return {
      authorization: authorizationOf(
        [
          ENTRY,
          {machine: 'files.example.invalid', login: 'second', password: 'x'},
        ],
        createLogger(sink, {minimumLevel: () => 'debug'}),
      ),
      sink,
    };
  }

  it('server-23: a host matched ignoring case, the port ignored, gets Basic of the exact bytes; another host and a bad address get none', () => {
    const {authorization} = sceneOf();
    deepStrictEqual(
      [
        authorization('https://FILES.example.invalid/a'),
        authorization('https://files.example.invalid:8443/a'),
        authorization('https://other.example.invalid/a'),
        authorization('not an address'),
      ],
      [
        basic('alice', 'secret'),
        basic('alice', 'secret'),
        undefined,
        undefined,
      ],
    );
  });

  it('server-23: a machine written in mixed case matches the host', () => {
    const authorization = authorizationOf(
      [{...ENTRY, machine: 'Files.Example.Invalid'}],
      createLogger(new MemorySink(), {minimumLevel: () => 'debug'}),
    );
    deepStrictEqual(
      authorization('https://files.example.invalid/a'),
      basic('alice', 'secret'),
    );
  });

  it('server-23: a login and password with non-ASCII characters are encoded as UTF-8', () => {
    const authorization = authorizationOf(
      [{machine: 'files.example.invalid', login: 'zoë', password: 'pässwörd'}],
      createLogger(new MemorySink(), {minimumLevel: () => 'debug'}),
    );
    deepStrictEqual(
      authorization('https://files.example.invalid/a'),
      basic('zoë', 'pässwörd'),
    );
  });

  it('server-23: an http address gets none, and the log says so once for two of them, without the login or the password', () => {
    const {authorization, sink} = sceneOf();
    deepStrictEqual(
      [
        authorization('http://files.example.invalid/a'),
        authorization('http://files.example.invalid/b'),
        sink.lines.map(line => line.message),
      ],
      [
        undefined,
        undefined,
        ['a netrc entry for files.example.invalid was not sent over http'],
      ],
    );
  });

  it('server-23: an http address with no entry says nothing', () => {
    const {authorization, sink} = sceneOf();
    authorization('http://other.example.invalid/a');
    deepStrictEqual(sink.lines, []);
  });
});
