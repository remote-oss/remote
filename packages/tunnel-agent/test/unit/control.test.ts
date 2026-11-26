import {deepStrictEqual} from 'node:assert';
import {duplexPair, type Duplex} from 'node:stream';
import {encode} from '@msgpack/msgpack';
import {encodeFrame, framesOf, type Frame} from '../../src/control/codec.ts';
import type {ServeRequest} from '../../src/control/ports.ts';
import {
  INVALID_PARAMETERS,
  METHOD_NOT_FOUND,
  PROTOCOL_VERSION,
  REFUSED,
  serveControl,
} from '../../src/control/session.ts';

/** The frames `chunks` give, read to their end. */
async function allFrames(chunks: Uint8Array[]): Promise<Frame[]> {
  const read: Frame[] = [];
  async function* source(): AsyncGenerator<Uint8Array> {
    for (const chunk of chunks) {
      await Promise.resolve();
      yield chunk;
    }
  }
  for await (const frame of framesOf(source())) {
    read.push(frame);
  }
  return read;
}

/** The message `work` rejects with. */
async function rejection(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
    return 'no error';
  } catch (error) {
    return (error as Error).message;
  }
}

describe("the control protocol's frames", () => {
  it('reads back each kind of message as it was written: a request, a notification, an answer and an error', async () => {
    const messages: Frame[] = [
      {id: 1, method: 'ping', params: {}},
      {method: 'version', params: {version: '1.0.0', protocol_version: 6}},
      {id: 1, result: {}},
      {id: 2, error: {code: -32601, message: 'no'}},
      {method: 'servermsg', params: {i: 3, body: new Uint8Array([0, 255])}},
    ];
    deepStrictEqual(await allFrames(messages.map(encodeFrame)), messages);
  });

  it('leaves out absent fields', async () => {
    deepStrictEqual(
      await allFrames([encodeFrame({method: 'ping', id: undefined})]),
      [{method: 'ping'}],
    );
  });

  it('waits for a frame cut across reads, one byte at a time', async () => {
    const bytes = Buffer.concat([
      encodeFrame({id: 7, method: 'serve', params: {socket_id: 1}}),
      encodeFrame({id: 8, method: 'ping'}),
    ]);
    deepStrictEqual(
      await allFrames([...bytes].map(byte => new Uint8Array([byte]))),
      [
        {id: 7, method: 'serve', params: {socket_id: 1}},
        {id: 8, method: 'ping'},
      ],
    );
  });

  it('throws at a value that is not a map, at bytes, and at bytes that are not MessagePack', async () => {
    deepStrictEqual(
      [
        await rejection(() => allFrames([encode([1, 2])])),
        await rejection(() => allFrames([encode(new Uint8Array([1]))])),
        await rejection(() => allFrames([encode(null)])),
        (await rejection(() => allFrames([new Uint8Array([0xc1])]))).length > 0,
      ],
      [
        'A frame of the control protocol is not a map.',
        'A frame of the control protocol is not a map.',
        'A frame of the control protocol is not a map.',
        true,
      ],
    );
  });
});

/** A fake editor server: each `serve` gets one end of a new pair, and the row holds the other. */
class FakeEditors {
  readonly requests: ServeRequest[] = [];
  readonly servers: Duplex[] = [];
  /** The agent's side of each connection, which the session closes. */
  readonly agentSides: Duplex[] = [];
  refusal: string | undefined;
  logLine: [string, number] | undefined;

  /** Opens a connection, or refuses with `refusal`. */
  serve(
    request: ServeRequest,
    onLogLine: (line: string, level: number) => void,
  ): Promise<Duplex> {
    this.requests.push(request);
    if (this.refusal !== undefined) {
      return Promise.reject(new Error(this.refusal));
    }
    if (this.logLine !== undefined) {
      onLogLine(...this.logLine);
    }
    const [agentSide, serverSide] = duplexPair();
    this.servers.push(serverSide);
    this.agentSides.push(agentSide);
    return Promise.resolve(agentSide);
  }
}

/** A fake tunnel whose ports change as asked, or refuse with `refusal`. */
class FakeTunnel {
  readonly changes: string[] = [];
  refusal: string | undefined;

  /** Adds `port`, or refuses. */
  addPrivate(port: number): Promise<void> {
    return this.change(`add ${String(port)}`);
  }

  /** Removes `port`, or refuses. */
  remove(port: number): Promise<void> {
    return this.change(`remove ${String(port)}`);
  }

  /** Records `change`, or refuses. */
  private change(change: string): Promise<void> {
    if (this.refusal !== undefined) {
      return Promise.reject(new Error(this.refusal));
    }
    this.changes.push(change);
    return Promise.resolve();
  }
}

describe('a control session', () => {
  let editors: FakeEditors;
  let tunnel: FakeTunnel;
  let logged: string[];
  let client: Duplex;
  let agent: Duplex;
  let frames: AsyncIterator<Frame>;
  let session: Promise<void>;

  beforeEach(() => {
    editors = new FakeEditors();
    tunnel = new FakeTunnel();
    logged = [];
    [agent, client] = duplexPair();
    session = serveControl(agent, {
      version: '1.2.3',
      editors,
      tunnel,
      logLine: line => logged.push(line),
    });
    frames = framesOf(client)[Symbol.asyncIterator]();
  });

  afterEach(async () => {
    client.destroy();
    agent.destroy();
    await session;
  });

  /** The next frame the agent sends. */
  async function next(): Promise<Frame> {
    const read = await frames.next();
    if (read.done === true) {
      throw new Error('the agent sent nothing more');
    }
    return read.value;
  }

  /** Sends `frame` as the client. */
  function send(frame: Frame): void {
    client.write(encodeFrame(frame));
  }

  /** The answer to request `id` with `method` and `params`, after the first `version`. */
  async function answerTo(
    requestId: number,
    method: string,
    params: Frame = {},
  ): Promise<Frame> {
    send({id: requestId, method, params});
    return next();
  }

  /** The server's side of the connection the session opened `index`th. */
  function serverAt(index: number): Duplex {
    const server = editors.servers[index];
    if (server === undefined) {
      throw new Error(`the session opened no connection ${String(index)}`);
    }
    return server;
  }

  /** The bytes `stream` gives next. */
  function nextData(stream: Duplex): Promise<Buffer> {
    return new Promise(resolve => {
      stream.once('data', resolve);
    });
  }

  describe('its start and its plain methods', () => {
    it('sends version first, with the agent version and protocol 6', async () => {
      deepStrictEqual(await next(), {
        method: 'version',
        params: {version: '1.2.3', protocol_version: PROTOCOL_VERSION},
      });
    });

    it('answers ping and version, and a ping sent as a notification gets no answer', async () => {
      await next();
      send({method: 'ping'});
      deepStrictEqual(
        [await answerTo(1, 'ping'), await answerTo(2, 'version')],
        [
          {id: 1, result: {}},
          {id: 2, result: {version: '1.2.3', protocol_version: 6}},
        ],
      );
    });

    it('answers every other method with an error, and goes on answering ping after it', async () => {
      const unsupported = [
        'update',
        'makehttpreq',
        'challenge_issue',
        'fs_stat',
        'spawn',
        'acquire_cli',
        'sys_kill',
        'get_env',
        'gethostname',
        'prune',
        'callserverhttp',
        'net_connect',
      ];
      await next();
      send({method: 'update'});
      const answers: Frame[] = [];
      for (const [index, method] of unsupported.entries()) {
        answers.push(await answerTo(index, method));
      }
      deepStrictEqual(
        [answers, await answerTo(99, 'ping')],
        [
          unsupported.map((method, index) => ({
            id: index,
            error: {
              code: METHOD_NOT_FOUND,
              message: `${method} is not supported by this host`,
            },
          })),
          {id: 99, result: {}},
        ],
      );
    });

    it('ignores an answer the client sends, and takes params that are not a map as none', async () => {
      await next();
      send({id: 5, result: {}});
      send({id: 6, error: {code: 1, message: 'x'}});
      deepStrictEqual(
        await answerTo(7, 'forward', 'not a map' as unknown as Frame),
        {
          id: 7,
          error: {code: INVALID_PARAMETERS, message: 'forward needs a port'},
        },
      );
    });
  });

  describe('serve', () => {
    it('opens a server connection with what the client asked for, answers once it is ready, and bridges bytes both ways', async () => {
      editors.logLine = ['starting', 2];
      await next();
      send({
        id: 1,
        method: 'serve',
        params: {
          socket_id: 4,
          commit_id: 'abc',
          quality: 'stable',
          extensions: ['one.two', 7],
          connection_token: 'secret',
          use_local_download: false,
          compress: false,
          server_source: {quality: 'stable', dataFolderName: '.server'},
        },
      });
      const serverLog = await next();
      const answer = await next();
      const server = serverAt(0);
      const toServer = nextData(server);
      send({method: 'servermsg', params: {i: 4, body: new Uint8Array([1, 2])}});
      const received = await toServer;
      server.write(Buffer.from([9, 8]));
      const fromServer = await next();
      const fromServerBytes = [
        ...(fromServer.params as {body: Uint8Array}).body,
      ];
      deepStrictEqual(
        [editors.requests, serverLog, answer, [...received], fromServerBytes],
        [
          [
            {
              socketId: 4,
              commitId: 'abc',
              quality: 'stable',
              extensions: ['one.two'],
              connectionToken: 'secret',
              serverSource: {quality: 'stable', dataFolderName: '.server'},
            },
          ],
          {method: 'serverlog', params: {line: 'starting', level: 2}},
          {id: 1, result: {}},
          [1, 2],
          [9, 8],
        ],
      );
    });

    it('takes a serve with no commit, token, extensions or source', async () => {
      await next();
      await answerTo(1, 'serve', {socket_id: 1, quality: 'insider'});
      deepStrictEqual(editors.requests, [
        {
          socketId: 1,
          commitId: undefined,
          quality: 'insider',
          extensions: [],
          connectionToken: undefined,
          serverSource: undefined,
        },
      ]);
    });

    it("tells the client when the server's connection closes, and drops it", async () => {
      await next();
      await answerTo(1, 'serve', {socket_id: 2, quality: 'stable'});
      editors.servers[0]?.end();
      const closed = await next();
      deepStrictEqual(
        [
          closed,
          await answerTo(2, 'servermsg', {i: 2, body: new Uint8Array([1])}),
          logged,
        ],
        [
          {method: 'serverclose', params: {i: 2}},
          {id: 2, result: {}},
          ['a message for server connection 2, which is not open'],
        ],
      );
    });

    it('keeps two connections apart, and a second serve with the same socket replaces the first without losing it to its close', async () => {
      await next();
      await answerTo(1, 'serve', {socket_id: 1, quality: 'stable'});
      await answerTo(2, 'serve', {socket_id: 2, quality: 'stable'});
      await answerTo(3, 'serve', {socket_id: 1, quality: 'stable'});
      const toSecond = nextData(serverAt(1));
      send({method: 'servermsg', params: {i: 2, body: new Uint8Array([2])}});
      const secondBytes = await toSecond;
      serverAt(0).end();
      const firstClosed = await next();
      const toReplacing = nextData(serverAt(2));
      send({method: 'servermsg', params: {i: 1, body: new Uint8Array([3])}});
      deepStrictEqual(
        [[...secondBytes], firstClosed, [...(await toReplacing)]],
        [[2], {method: 'serverclose', params: {i: 1}}, [3]],
      );
    });

    it('refuses a local download, compression, missing parameters and a server that cannot start', async () => {
      await next();
      const answers = [
        await answerTo(1, 'serve', {
          socket_id: 1,
          quality: 'stable',
          use_local_download: true,
        }),
        await answerTo(2, 'serve', {
          socket_id: 1,
          quality: 'stable',
          compress: true,
        }),
        await answerTo(3, 'serve', {quality: 'stable'}),
        await answerTo(4, 'serve', {socket_id: 1}),
      ];
      editors.refusal = 'the server download failed';
      answers.push(
        await answerTo(5, 'serve', {socket_id: 1, quality: 'stable'}),
      );
      deepStrictEqual(
        answers.map(each => each.error),
        [
          {
            code: REFUSED,
            message: 'use_local_download is not supported by this host',
          },
          {code: REFUSED, message: 'compress is not supported by this host'},
          {
            code: INVALID_PARAMETERS,
            message: 'serve needs a socket_id and a quality',
          },
          {
            code: INVALID_PARAMETERS,
            message: 'serve needs a socket_id and a quality',
          },
          {code: REFUSED, message: 'the server download failed'},
        ],
      );
    });

    it('refuses a servermsg without its socket or its bytes', async () => {
      await next();
      deepStrictEqual(
        [
          (await answerTo(1, 'servermsg', {i: 1})).error,
          (await answerTo(2, 'servermsg', {body: new Uint8Array([1])})).error,
        ],
        [
          {
            code: INVALID_PARAMETERS,
            message: 'servermsg needs an i and a body',
          },
          {
            code: INVALID_PARAMETERS,
            message: 'servermsg needs an i and a body',
          },
        ],
      );
    });

    it("logs a server connection's error without its bytes", async () => {
      await next();
      await answerTo(1, 'serve', {socket_id: 3, quality: 'stable'});
      editors.agentSides[0]?.destroy(new Error('reset'));
      await next();
      deepStrictEqual(logged, ['the server connection 3 failed: reset']);
    });
  });

  describe('forward and unforward', () => {
    it('adds a private port with no address, removes it, and refuses a public one or no port', async () => {
      await next();
      const answers = [
        await answerTo(1, 'forward', {port: 8080}),
        await answerTo(2, 'forward', {port: 8081, public: false}),
        await answerTo(3, 'unforward', {port: 8080}),
        await answerTo(4, 'forward', {port: 9000, public: true}),
        await answerTo(5, 'forward', {port: 0}),
        await answerTo(6, 'forward', {port: 70000}),
        await answerTo(7, 'unforward', {port: 1.5}),
      ];
      deepStrictEqual(
        [answers, tunnel.changes],
        [
          [
            {id: 1, result: {uri: ''}},
            {id: 2, result: {uri: ''}},
            {id: 3, result: {}},
            {
              id: 4,
              error: {
                code: REFUSED,
                message: 'a public port is not supported by this host',
              },
            },
            {
              id: 5,
              error: {
                code: INVALID_PARAMETERS,
                message: 'forward needs a port',
              },
            },
            {
              id: 6,
              error: {
                code: INVALID_PARAMETERS,
                message: 'forward needs a port',
              },
            },
            {
              id: 7,
              error: {
                code: INVALID_PARAMETERS,
                message: 'unforward needs a port',
              },
            },
          ],
          ['add 8080', 'add 8081', 'remove 8080'],
        ],
      );
    });

    it("answers the relay's refusal with its reason", async () => {
      await next();
      tunnel.refusal = 'This tunnel already has 10 ports.';
      deepStrictEqual(
        [
          await answerTo(1, 'forward', {port: 8080}),
          await answerTo(2, 'unforward', {port: 8080}),
        ],
        [
          {
            id: 1,
            error: {
              code: REFUSED,
              message: 'This tunnel already has 10 ports.',
            },
          },
          {
            id: 2,
            error: {
              code: REFUSED,
              message: 'This tunnel already has 10 ports.',
            },
          },
        ],
      );
    });
  });

  describe('its end', () => {
    it('ends at a frame that is not a message, with one line and nothing of the frame, and closes its server connections', async () => {
      await next();
      await answerTo(1, 'serve', {socket_id: 1, quality: 'stable'});
      send({id: 'one', method: 'ping'});
      await session;
      deepStrictEqual(
        [logged, agent.destroyed, editors.agentSides[0]?.destroyed],
        [
          [
            'the control session ended: A frame of the control protocol is not a message.',
          ],
          true,
          true,
        ],
      );
    });

    it('ends at a frame that is neither a request nor an answer', async () => {
      await next();
      send({id: 1});
      await session;
      deepStrictEqual(logged, [
        'the control session ended: A frame of the control protocol is not a message.',
      ]);
    });

    it('closes its server connections when the client goes, with nothing logged', async () => {
      await next();
      await answerTo(1, 'serve', {socket_id: 1, quality: 'stable'});
      client.end();
      await session;
      deepStrictEqual([editors.agentSides[0]?.destroyed, logged], [true, []]);
    });
  });
});
