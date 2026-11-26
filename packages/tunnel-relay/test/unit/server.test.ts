import {deepStrictEqual} from 'node:assert';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {Readable} from 'node:stream';
import {problem} from '../../src/problem.ts';
import {API_VERSION, type RouteContext} from '../../src/routes.ts';
import {answerRequest, relayServer, write} from '../../src/server.ts';
import {Store} from '../../src/store.ts';
import {Tokens} from '../../src/auth/tokens.ts';
import {Legs} from '../../src/legs/legs.ts';
import {TEST_CONFIG} from './settings.ts';

/** A request as the server reads it: its method, address, headers and body text. */
function incoming(
  method: string,
  url: string | undefined,
  body = '',
  headers: Record<string, string | string[]> = {},
  remoteAddress: string | null = '10.0.0.1',
): IncomingMessage {
  const request = Readable.from(body === '' ? [] : [Buffer.from(body)]);
  return Object.assign(request, {
    method,
    url,
    headers,
    socket: {remoteAddress: remoteAddress ?? undefined},
  }) as unknown as IncomingMessage;
}

/** Does nothing; the place of a callback not yet set. */
function ignore(): void {
  // Nothing to do.
}

/** A response that records what is written to it. */
function recorder(): {
  response: ServerResponse;
  written: {status?: number; headers: Record<string, string>; body?: string};
  ended: Promise<void>;
} {
  const written: {
    status?: number;
    headers: Record<string, string>;
    body?: string;
  } = {
    headers: {},
  };
  let finish: () => void = ignore;
  const ended = new Promise<void>(resolve => {
    finish = resolve;
  });
  const response = {
    set statusCode(value: number) {
      written.status = value;
    },
    setHeader(name: string, value: string) {
      written.headers[name] = value;
    },
    end(body?: string) {
      if (body !== undefined) {
        written.body = body;
      }
      finish();
    },
  } as unknown as ServerResponse;
  return {response, written, ended};
}

describe('the HTTPS service of the relay', () => {
  let store: Store;
  let context: RouteContext & {legs: Legs};
  let reported: unknown[];

  beforeEach(() => {
    store = new Store(':memory:');
    reported = [];
    context = {
      store,
      config: TEST_CONFIG,
      authenticate: () =>
        Promise.resolve({kind: 'account', id: 7, login: 'owner'}),
      tokens: new Tokens(Buffer.alloc(32, 1), () => 0),
      report: error => {
        reported.push(error);
      },
      legs: new Legs(
        () => Promise.resolve({kind: 'account', id: 7, login: 'owner'}),
        error => {
          reported.push(error);
        },
      ),
    };
  });

  afterEach(() => {
    store.close();
  });

  it('hands the routes the method, path, query, headers and JSON body of a request', async () => {
    const answer = await answerRequest(
      incoming(
        'PUT',
        `/tunnels/one?api-version=${API_VERSION}`,
        JSON.stringify({name: 'web'}),
        {'if-none-match': ['*', 'x'], authorization: 'github token'},
      ),
      context,
    );
    deepStrictEqual(
      [answer.status, store.tunnelById('one')?.name],
      [200, 'web'],
    );
  });

  it('hands the routes the address of the request’s socket, and an empty one when the socket has none', async () => {
    const addresses: string[] = [];
    const spying: RouteContext = {
      ...context,
      authenticate: (...given) => {
        addresses.push(given[1]);
        return Promise.resolve({kind: 'account', id: 1, login: 'octo'});
      },
    };
    for (const remoteAddress of ['203.0.113.9', null]) {
      await answerRequest(
        incoming(
          'GET',
          `/tunnels?api-version=${API_VERSION}`,
          '',
          {},
          remoteAddress,
        ),
        spying,
      );
    }
    deepStrictEqual(addresses, ['203.0.113.9', '']);
  });

  it('writes the headers an answer carries, besides the request id', () => {
    const {response, written} = recorder();
    write(response, {
      ...problem(429, 'Slow down.'),
      headers: {'Retry-After': '30'},
    });
    deepStrictEqual(
      [written.status, written.headers['Retry-After']],
      [429, '30'],
    );
  });

  it('reads a request with no body, and one with no method or address as a GET of /', async () => {
    deepStrictEqual(
      [
        (
          await answerRequest(
            incoming('GET', `/tunnels?api-version=${API_VERSION}`),
            context,
          )
        ).status,
        (
          await answerRequest(
            incoming(undefined as unknown as string, undefined),
            context,
          )
        ).status,
      ],
      [200, 400],
    );
  });

  it('answers 400 for a body that is not JSON, and 500 when the routes throw', async () => {
    const thrown: RouteContext = {
      ...context,
      authenticate: () => Promise.reject(new Error('down')),
    };
    deepStrictEqual(
      [
        await answerRequest(
          incoming('PUT', `/tunnels/one?api-version=${API_VERSION}`, '{'),
          context,
        ),
        await answerRequest(
          incoming('GET', `/tunnels?api-version=${API_VERSION}`),
          thrown,
        ),
      ],
      [
        {
          status: 400,
          body: {title: 'Bad Request', detail: 'The body is not JSON.'},
        },
        {
          status: 500,
          body: {title: 'Error', detail: 'The relay failed.'},
        },
      ],
    );
  });

  it('reports the error behind a 500 out of band, and the answer names nothing of it', async () => {
    const answer = await answerRequest(
      incoming('GET', `/tunnels?api-version=${API_VERSION}`),
      {...context, authenticate: () => Promise.reject(new Error('down'))},
    );
    deepStrictEqual(
      [JSON.stringify(answer.body).includes('down'), String(reported[0])],
      [false, 'Error: down'],
    );
  });

  it('answers 400 to a request target that is no URL, and never rejects', async () => {
    deepStrictEqual(await answerRequest(incoming('GET', 'http://'), context), {
      status: 400,
      body: {title: 'Bad Request', detail: 'The request target is not valid.'},
    });
  });

  it('answers 413 to a body over a mebibyte, and stores nothing of it', async () => {
    const answer = await answerRequest(
      incoming(
        'PUT',
        `/tunnels/one?api-version=${API_VERSION}`,
        JSON.stringify({name: 'web', description: 'x'.repeat(1024 * 1024)}),
      ),
      context,
    );
    deepStrictEqual(
      [answer, store.tunnelById('one')],
      [
        {
          status: 413,
          body: {title: 'Payload Too Large', detail: 'The body is too large.'},
        },
        undefined,
      ],
    );
  });

  it('reads no body before the caller has signed in: a refused caller gets 401 whatever the body', async () => {
    const refused: RouteContext = {
      ...context,
      authenticate: () =>
        Promise.resolve({
          status: 401,
          body: {title: 'Unauthorized', detail: 'Sign in.'},
        }),
    };
    deepStrictEqual(
      [
        await answerRequest(
          incoming('PUT', `/tunnels/one?api-version=${API_VERSION}`, '{'),
          refused,
        ),
        await answerRequest(
          incoming(
            'PUT',
            `/tunnels/one?api-version=${API_VERSION}`,
            'x'.repeat(1024 * 1024 + 1),
          ),
          refused,
        ),
      ].map(answer => answer.status),
      [401, 401],
    );
  });

  it('writes an answer as JSON with a request id, and one with no body with none', () => {
    const json = recorder();
    write(json.response, {status: 404, body: {detail: 'x'}});
    const empty = recorder();
    write(empty.response, {status: 200});
    deepStrictEqual(
      [
        /^[0-9a-f]{16}$/.test(json.written.headers['VsSaaS-Request-Id'] ?? ''),
        json.written.status,
        json.written.headers['Content-Type'],
        json.written.body,
        empty.written.status,
        empty.written.headers['Content-Type'],
        empty.written.body,
      ],
      [
        true,
        404,
        'application/json',
        '{"detail":"x"}',
        200,
        undefined,
        undefined,
      ],
    );
  });

  it('answers each request it is given through the routes', async () => {
    const server = relayServer(context, '', '');
    const {response, written, ended} = recorder();
    server.emit('request', incoming('GET', '/tunnels'), response);
    await ended;
    deepStrictEqual(
      [written.status, JSON.parse(written.body ?? '') as unknown],
      [
        400,
        {
          title: 'Bad Request',
          detail: `The api-version must be ${API_VERSION}.`,
        },
      ],
    );
  });

  it('hands each upgrade to the legs, one with no address as an upgrade of /', async () => {
    const server = relayServer(context, '', '');
    const written = new Promise<string>(resolve => {
      server.emit(
        'upgrade',
        incoming('GET', undefined),
        {
          on: () => undefined,
          end(text: string) {
            resolve(text);
          },
        },
        Buffer.alloc(0),
      );
    });
    deepStrictEqual((await written).split('\r\n')[0], 'HTTP/1.1 404 Refused');
  });

  it('reports an upgrade the legs fail on and destroys its socket, so the relay goes on', async () => {
    const failing = new Error('the legs broke');
    context.legs.upgrade = () => Promise.reject(failing);
    const server = relayServer(context, '', '');
    const destroyed = new Promise<boolean>(resolve => {
      server.emit(
        'upgrade',
        incoming('GET', '/relay/host/one'),
        {
          destroy() {
            resolve(true);
          },
        },
        Buffer.alloc(0),
      );
    });
    deepStrictEqual([await destroyed, reported], [true, [failing]]);
  });
});
