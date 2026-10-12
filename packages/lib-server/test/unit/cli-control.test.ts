import {deepStrictEqual, strictEqual, throws} from 'node:assert';
import {encode} from '@msgpack/msgpack';
import {fakeCli, type Request} from '../../src/testing/fake-cli.ts';
import {
  type CliControl,
  type CliSocket,
  openCliControl,
  type ServerLogLine,
} from '../../src/cli-control/client.ts';

const CHALLENGE = 'XDhuZUzkmmta9qWF';
const RESPONSE = 'tfZvthfXETBzL5SSTVHWciJHrJvZAk47yiIljTLiVms';

const SERVE = {
  commit: 'c1',
  quality: 'insider',
  connectionToken: 'conn-token',
  useLocalDownload: false,
};

const TEMPLATE_REASON =
  'cannot expand ${release} for commit abc123 in the download url template';

const TEMPLATE_ERROR = `WrappedError(WrappedError { message: "${TEMPLATE_REASON}", original: "https://example.invalid/server-\${release}.tar.gz" })`;

/** The reply to `request` when the CLI accepts the challenge. */
function accepting(request: Request): unknown[] {
  if (request.method === 'challenge_issue') {
    return [{id: request.id, result: {challenge: CHALLENGE}}];
  }
  return [{id: request.id, result: {}}];
}

/** The socket id a request names. */
function socketOf(request: Request): number | undefined {
  return (request.params as {socket_id?: number}).socket_id;
}

/** A script that accepts everything, but answers the `serve` of `socketId` with `answers` made from its request. */
function acceptingExcept(
  socketId: number,
  answers: (request: Request) => readonly unknown[],
): (request: Request) => readonly unknown[] {
  return request =>
    socketOf(request) === socketId ? answers(request) : accepting(request);
}

/** A script that accepts everything but never answers the `serve` of `socketId`. */
function silentFor(socketId: number) {
  return acceptingExcept(socketId, () => []);
}

/** A script that accepts everything but fails the `serve` of `socketId`. */
function failingFor(socketId: number) {
  return acceptingExcept(socketId, request => [
    {id: request.id, error: {code: -1, message: 'other'}},
  ]);
}

/** A `serverlog` notification. */
function logOf(line: string, level: number): unknown {
  return {id: null, method: 'serverlog', params: {line, level}};
}

/** The control connection over a fake CLI that answers with `script`. */
function connected(script: (request: Request) => readonly unknown[]) {
  const peer = fakeCli(script);
  return {peer, control: openCliControl(peer.stream)};
}

/** The error line of a serve that `control` ran against a CLI that fails it, or 'not failed'. */
async function errorLineOf(control: CliControl): Promise<string | undefined> {
  const failed = await control.serve(SERVE, () => undefined);
  return failed.kind === 'serveFailed' ? failed.errorLine : 'not failed';
}

/** A serve whose log lines are collected, against a CLI that sends nothing by itself. */
function loggedServe(): {
  peer: ReturnType<typeof fakeCli>;
  answer: ReturnType<CliControl['serve']>;
  seen: string[];
} {
  const seen: string[] = [];
  const {peer, control} = connected(() => []);
  const answer = control.serve(SERVE, line => {
    seen.push(line.text);
  });
  return {peer, answer, seen};
}

/** The kind of a serve outcome. */
async function kindOf(
  outcome: ReturnType<CliControl['serve']>,
): Promise<string> {
  return (await outcome).kind;
}

/** A connection whose connect `serve` replied, against the CLI `script`. */
async function served(script: (request: Request) => readonly unknown[]) {
  const connection = connected(script);
  await connection.control.serve(SERVE, () => undefined);
  return connection;
}

/** The error line of the `serve` that `openSocket` ran, or 'not failed'. */
async function socketErrorLineOf(
  control: CliControl,
): Promise<string | undefined> {
  const failed = await control.openSocket(() => undefined);
  return failed.kind === 'serveFailed' ? failed.errorLine : 'not failed';
}

/** A served connection where socket 1 was asked for twice and nothing answered yet. */
async function twoPending() {
  const connection = await served(silentFor(1));
  void connection.control.openSocket(() => undefined);
  void connection.control.openSocket(() => undefined);
  await settle();
  return connection;
}

/** Lets the pending reads and replies run. */
function settle(): Promise<void> {
  return new Promise(resolve => {
    setImmediate(resolve);
  });
}

describe('the CLI control client: the challenge', () => {
  it('V7a: the response to the challenge is the one the real CLI accepted', async () => {
    const {peer, control} = connected(accepting);
    await control.authenticate('tok123');
    deepStrictEqual(
      (peer.requests[1]?.params as {response: string}).response,
      RESPONSE,
    );
  });

  it('V7a: the first request issues the challenge for the token', async () => {
    const {peer, control} = connected(accepting);
    await control.authenticate('tok123');
    deepStrictEqual(
      [
        peer.requests[0]?.method,
        peer.requests[0]?.params,
        peer.requests[0]?.id,
      ],
      ['challenge_issue', {token: 'tok123'}, 1],
    );
  });

  it('V7a: an accepted challenge authenticates', async () => {
    const {control} = connected(accepting);
    deepStrictEqual(await control.authenticate('tok123'), {
      kind: 'authenticated',
    });
  });

  it('V7a: a refused token is a refused challenge with the CLI message', async () => {
    const {control} = connected(request => [
      {
        id: request.id,
        error: {code: -1, message: 'CodeError(AuthChallengeBadToken)'},
      },
    ]);
    deepStrictEqual(await control.authenticate('bad'), {
      kind: 'challengeRefused',
      message: 'CodeError(AuthChallengeBadToken)',
    });
  });

  it('V7a: a refused response is a refused challenge with the CLI message', async () => {
    const {control} = connected(request =>
      request.method === 'challenge_issue'
        ? accepting(request)
        : [
            {
              id: request.id,
              error: {code: -1, message: 'CodeError(AuthChallengeNotIssued)'},
            },
          ],
    );
    deepStrictEqual(await control.authenticate('tok123'), {
      kind: 'challengeRefused',
      message: 'CodeError(AuthChallengeNotIssued)',
    });
  });

  it('V7a: an issue reply without a challenge is a refused challenge', async () => {
    const {control} = connected(request => [{id: request.id, result: {}}]);
    deepStrictEqual(await control.authenticate('tok123'), {
      kind: 'challengeRefused',
      message: 'the challenge was not issued',
    });
  });

  it('V7a: an issue reply whose result is not a map is a refused challenge', async () => {
    const {control} = connected(request => [{id: request.id, result: null}]);
    deepStrictEqual(await control.authenticate('tok123'), {
      kind: 'challengeRefused',
      message: 'the challenge was not issued',
    });
  });

  it('V7a: a stream that closes before the issue reply closes the challenge', async () => {
    const {peer, control} = connected(() => []);
    const answer = control.authenticate('tok123');
    peer.end();
    deepStrictEqual(await answer, {kind: 'closed'});
  });

  it('V7a: a stream that closes before the verify reply closes the challenge', async () => {
    const {peer, control} = connected(request =>
      request.method === 'challenge_issue' ? accepting(request) : [],
    );
    const answer = control.authenticate('tok123');
    await settle();
    peer.end();
    deepStrictEqual(await answer, {kind: 'closed'});
  });
});

describe('the CLI control client: serve', () => {
  it('V7a: serve sends the commit, the quality and the connection token', async () => {
    const {peer, control} = connected(accepting);
    await control.serve(SERVE, () => undefined);
    deepStrictEqual(peer.requests[0]?.params, {
      socket_id: 0,
      commit_id: 'c1',
      quality: 'insider',
      extensions: [],
      connection_token: 'conn-token',
      use_local_download: false,
      compress: false,
    });
  });

  it('V7a: serve names the method serve', async () => {
    const {peer, control} = connected(accepting);
    await control.serve(SERVE, () => undefined);
    strictEqual(peer.requests[0]?.method, 'serve');
  });

  it('V7a: serve asks for the local download when told to', async () => {
    const {peer, control} = connected(accepting);
    await control.serve({...SERVE, useLocalDownload: true}, () => undefined);
    strictEqual(
      (peer.requests[0]?.params as {use_local_download: boolean})
        .use_local_download,
      true,
    );
  });

  it('V7a: the log lines come in order before serve resolves', async () => {
    const seen: ServerLogLine[] = [];
    const {control} = connected(request => [
      logOf('one', 2),
      logOf('two', 0),
      logOf('three', 1),
      {id: request.id, result: {}},
    ]);
    await control.serve(SERVE, line => {
      seen.push(line);
    });
    deepStrictEqual(
      seen.map(line => line.text),
      ['one', 'two', 'three'],
    );
  });

  it('V7a: the log lines carry their level', async () => {
    const seen: ServerLogLine[] = [];
    const {control} = connected(request => [
      logOf('one', 2),
      {id: request.id, result: {}},
    ]);
    await control.serve(SERVE, line => {
      seen.push(line);
    });
    deepStrictEqual(seen, [{text: 'one', level: 2}]);
  });

  it('V7a: an empty reply is serving', async () => {
    const {control} = connected(accepting);
    strictEqual(await kindOf(control.serve(SERVE, () => undefined)), 'serving');
  });

  it('V7a, R1: the error reply is told with the level 4 line', async () => {
    const {control} = connected(request => [
      logOf('Checking …', 2),
      logOf(
        `Error installing server: ${TEMPLATE_REASON}: https://example.invalid/server-\${release}.tar.gz`,
        4,
      ),
      {id: request.id, error: {code: -1, message: TEMPLATE_ERROR}},
    ]);
    deepStrictEqual(await control.serve(SERVE, () => undefined), {
      kind: 'serveFailed',
      error: {kind: 'template', message: TEMPLATE_ERROR},
      message: TEMPLATE_ERROR,
      errorLine: `Error installing server: ${TEMPLATE_REASON}: https://example.invalid/server-\${release}.tar.gz`,
    });
  });

  it('V7a: the error line is the last of the level 4 lines', async () => {
    const {control} = connected(request => [
      logOf('first', 4),
      logOf('second', 4),
      logOf('later', 2),
      {id: request.id, error: {code: -1, message: 'other'}},
    ]);
    strictEqual(await errorLineOf(control), 'second');
  });

  it('V7a: a warning line is not the error line', async () => {
    const {control} = connected(request => [
      logOf('a warning', 3),
      {id: request.id, error: {code: -1, message: 'other'}},
    ]);
    strictEqual(await errorLineOf(control), undefined);
  });

  it('V7a: a line above the error level is not the error line', async () => {
    const {control} = connected(request => [
      logOf('beyond', 5),
      {id: request.id, error: {code: -1, message: 'other'}},
    ]);
    strictEqual(await errorLineOf(control), undefined);
  });

  it('V7a: an error reply with no level 4 line has no error line', async () => {
    const {control} = connected(request => [
      logOf('Checking …', 2),
      {id: request.id, error: {code: -1, message: 'other'}},
    ]);
    strictEqual(await errorLineOf(control), undefined);
  });

  it('V7a: a level 4 line of an earlier serve is not the error line of the next', async () => {
    const {control} = await served(request =>
      socketOf(request) === 0
        ? [logOf('old', 4), {id: request.id, result: {}}]
        : [{id: request.id, error: {code: -1, message: 'other'}}],
    );
    strictEqual(await socketErrorLineOf(control), undefined);
  });

  it('contracts: log lines after the reply reach no listener', async () => {
    const seen: ServerLogLine[] = [];
    const {peer, control} = connected(accepting);
    await control.serve(SERVE, line => {
      seen.push(line);
    });
    peer.send(logOf('late', 2));
    await settle();
    deepStrictEqual(seen, []);
  });

  it('contracts: a serverlog without a line is ignored', async () => {
    const seen: ServerLogLine[] = [];
    const {control} = connected(request => [
      {id: null, method: 'serverlog', params: {level: 2}},
      {id: request.id, result: {}},
    ]);
    await control.serve(SERVE, line => {
      seen.push(line);
    });
    deepStrictEqual(seen, []);
  });

  it('contracts: the stream that closes during serve closes the serve', async () => {
    const {peer, control} = connected(() => []);
    const answer = control.serve(SERVE, () => undefined);
    peer.end();
    deepStrictEqual(await answer, {kind: 'closed'});
  });

  it('contracts: a request after the stream ended is closed at once', async () => {
    const {peer, control} = connected(accepting);
    peer.end();
    await settle();
    deepStrictEqual(await control.serve(SERVE, () => undefined), {
      kind: 'closed',
    });
  });
});

describe('the CLI control client: the framing', () => {
  it('V7a: a reply and a notification in one chunk are both handled in order', async () => {
    const {peer, answer, seen} = loggedServe();
    peer.deliver(
      new Uint8Array([
        ...encode(logOf('before', 2)),
        ...encode({id: 1, result: {}}),
      ]),
    );
    deepStrictEqual([await kindOf(answer), seen], ['serving', ['before']]);
  });

  it('V7a: a message split across three chunks is handled once complete', async () => {
    const {peer, control} = connected(() => []);
    const answer = control.serve(SERVE, () => undefined);
    const bytes = encode({id: 1, result: {}});
    peer.deliver(bytes.slice(0, 2));
    await settle();
    peer.deliver(bytes.slice(2, 4));
    await settle();
    peer.deliver(bytes.slice(4));
    strictEqual(await kindOf(answer), 'serving');
  });

  it('V7a: a message that is not a map is ignored and the next reply is handled', async () => {
    const {peer, control} = connected(() => []);
    const answer = control.serve(SERVE, () => undefined);
    peer.send('text', [1, 2], {id: 1, result: {}});
    strictEqual(await kindOf(answer), 'serving');
  });

  it('contracts: a reply to an unknown id is ignored', async () => {
    const {peer, control} = connected(() => []);
    const answer = control.serve(SERVE, () => undefined);
    peer.send({id: 99, result: {}}, {id: 1, result: {}});
    strictEqual(await kindOf(answer), 'serving');
  });

  it('contracts: a map with an id and neither result nor error is ignored', async () => {
    const {peer, control} = connected(() => []);
    const answer = control.serve(SERVE, () => undefined);
    peer.send({id: 1}, {id: 1, result: {}});
    strictEqual(await kindOf(answer), 'serving');
  });

  it('contracts: a map with neither an id nor a method is ignored', async () => {
    const {peer, control} = connected(() => []);
    const answer = control.serve(SERVE, () => undefined);
    peer.send({other: 1}, {id: 1, result: {}});
    strictEqual(await kindOf(answer), 'serving');
  });

  it('contracts: a notification without an id is handled', async () => {
    const {peer, answer, seen} = loggedServe();
    peer.send(
      {method: 'serverlog', params: {line: 'no id', level: 2}},
      {id: 1, result: {}},
    );
    await answer;
    deepStrictEqual(seen, ['no id']);
  });

  it('contracts: a notification whose params are not a map is ignored', async () => {
    const {peer, control} = connected(() => []);
    const answer = control.serve(SERVE, () => undefined);
    peer.send(
      {id: null, method: 'serverlog', params: null},
      {id: 1, result: {}},
    );
    strictEqual(await kindOf(answer), 'serving');
  });

  it('contracts: an error reply without a message is ignored', async () => {
    const {peer, control} = connected(() => []);
    const answer = control.serve(SERVE, () => undefined);
    peer.send({id: 1, error: {code: -1}}, {id: 1, result: {}});
    strictEqual(await kindOf(answer), 'serving');
  });

  it('contracts: bytes that are not msgpack end the connection', async () => {
    const {peer, control} = connected(() => []);
    const answer = control.serve(SERVE, () => undefined);
    peer.deliver(new Uint8Array([0xc1]));
    deepStrictEqual(await answer, {kind: 'closed'});
  });
});

describe('the CLI control client: the server sockets', () => {
  /** A control connection that served, with sockets 0, 1 and 2 open and listening. */
  async function threeSockets(
    script: (request: Request) => readonly unknown[] = accepting,
  ) {
    const {peer, control} = connected(script);
    const first = await control.serve(SERVE, () => undefined);
    const sockets: CliSocket[] = first.kind === 'serving' ? [first.socket] : [];
    for (let count = 0; count < 2; count += 1) {
      const opened = await control.openSocket(() => undefined);
      if (opened.kind === 'serving') {
        sockets.push(opened.socket);
      }
    }
    const received: Array<[number, Uint8Array]> = [];
    const closed: number[] = [];
    for (const socket of sockets) {
      socket.onData(chunk => {
        received.push([socket.socketId, chunk]);
      });
      socket.onClose(() => {
        closed.push(socket.socketId);
      });
    }
    return {peer, control, received, closed, sockets};
  }

  /** The `serve` requests the peer received, as their socket ids. */
  function serveIds(peer: ReturnType<typeof fakeCli>): unknown[] {
    return peer.requests
      .filter(request => request.method === 'serve')
      .map(request => (request.params as {socket_id: number}).socket_id);
  }

  /** The `servermsg` frames the peer received. */
  function frames(peer: ReturnType<typeof fakeCli>): Request[] {
    return peer.requests.filter(request => request.method === 'servermsg');
  }

  it('§4a: the socket of the connect serve is socket 0', async () => {
    const {peer, control} = connected(accepting);
    const first = await control.serve(SERVE, () => undefined);
    deepStrictEqual(
      [
        first.kind === 'serving' ? first.socket.socketId : -1,
        peer.requests.length,
      ],
      [0, 1],
    );
  });

  it('cli attach_server_bridge: two more sockets send three serve requests with socket ids 0, 1 and 2', async () => {
    const {peer} = await threeSockets();
    deepStrictEqual(serveIds(peer), [0, 1, 2]);
  });

  it('cli attach_server_bridge: the later serve params equal the first apart from the socket id', async () => {
    const {peer} = await threeSockets();
    const [first, ...later] = peer.requests
      .filter(request => request.method === 'serve')
      .map(request => request.params as Record<string, unknown>);
    deepStrictEqual(
      later.map(params => ({...params, socket_id: 0})),
      [first, first],
    );
  });

  it('cli attach_server_bridge: a socket asked for is pending while its serve is unanswered', async () => {
    const {control} = connected(silentFor(1));
    await control.serve(SERVE, () => undefined);
    let settled = false;
    void control
      .openSocket(() => undefined)
      .then(() => {
        settled = true;
      });
    await settle();
    strictEqual(settled, false);
  });

  it('cli attach_server_bridge: a socket asked for is resolved when its serve replies', async () => {
    const {peer, control} = await served(silentFor(1));
    const opened = control.openSocket(() => undefined);
    await settle();
    peer.send({id: 2, result: {}});
    strictEqual((await opened).kind, 'serving');
  });

  it('cli attach_server_bridge: frames on every socket leave none rejected by the program', async () => {
    const {peer, sockets} = await threeSockets();
    for (const socket of sockets) {
      socket.send(new Uint8Array([1]));
    }
    deepStrictEqual(peer.rejected, []);
  });

  it('cli attach_server_bridge: the program rejects a frame for a socket no serve attached', () => {
    const {peer} = connected(accepting);
    peer.stream.send(
      encode({method: 'servermsg', params: {i: 5, body: new Uint8Array()}}),
    );
    deepStrictEqual(peer.rejected, [5]);
  });

  it('cli attach_server_bridge: the program rejects a frame for a socket whose serve failed', async () => {
    const {peer, control} = connected(request => [
      {id: request.id, error: {code: -1, message: 'other'}},
    ]);
    await control.serve(SERVE, () => undefined);
    peer.stream.send(
      encode({method: 'servermsg', params: {i: 0, body: new Uint8Array()}}),
    );
    deepStrictEqual(peer.rejected, [0]);
  });

  it('V7a: a socket whose serve fails gives the error line', async () => {
    const {control} = connected(request =>
      (request.params as {socket_id?: number}).socket_id === 1
        ? [
            logOf(`Error installing server: ${TEMPLATE_REASON}`, 4),
            {id: request.id, error: {code: -1, message: TEMPLATE_ERROR}},
          ]
        : accepting(request),
    );
    await control.serve(SERVE, () => undefined);
    deepStrictEqual(await control.openSocket(() => undefined), {
      kind: 'serveFailed',
      error: {kind: 'template', message: TEMPLATE_ERROR},
      message: TEMPLATE_ERROR,
      errorLine: `Error installing server: ${TEMPLATE_REASON}`,
    });
  });

  it('V7a: a socket whose serve fails with no install log has no error line', async () => {
    const {control} = await served(failingFor(1));
    strictEqual(await socketErrorLineOf(control), undefined);
  });

  it('V7a: a socket whose serve fails leaves socket 0 open', async () => {
    const {control, closed} = await threeSockets(request =>
      (request.params as {socket_id?: number}).socket_id === 3
        ? [{id: request.id, error: {code: -1, message: 'other'}}]
        : accepting(request),
    );
    await control.openSocket(() => undefined);
    deepStrictEqual(closed, []);
  });

  it('V7a: the id of a socket whose serve failed is not reused', async () => {
    const {peer, control} = connected(failingFor(1));
    await control.serve(SERVE, () => undefined);
    await control.openSocket(() => undefined);
    await control.openSocket(() => undefined);
    deepStrictEqual(serveIds(peer), [0, 1, 2]);
  });

  it('V7a: a socket opened with a listener gives it the lines of its serve', async () => {
    const seen: string[] = [];
    const {control} = connected(request =>
      (request.params as {socket_id?: number}).socket_id === 1
        ? [logOf('one', 2), logOf('two', 0), {id: request.id, result: {}}]
        : accepting(request),
    );
    await control.serve(SERVE, () => undefined);
    await control.openSocket(line => {
      seen.push(line.text);
    });
    deepStrictEqual(seen, ['one', 'two']);
  });

  it('contracts: a socket asked for before serve throws', () => {
    const {control} = connected(accepting);
    throws(() => control.openSocket(() => undefined), {
      message: 'serve has not succeeded',
    });
  });

  it('contracts: a socket asked for after a failed serve throws', async () => {
    const {control} = await served(failingFor(0));
    throws(() => control.openSocket(() => undefined), {
      message: 'serve has not succeeded',
    });
  });

  it('contracts: a socket asked for while serve is unanswered throws', () => {
    const {control} = connected(() => []);
    void control.serve(SERVE, () => undefined);
    throws(() => control.openSocket(() => undefined), {
      message: 'serve has not succeeded',
    });
  });

  it('contracts: serve called twice throws', async () => {
    const {control} = await served(accepting);
    throws(() => control.serve(SERVE, () => undefined), {
      message: 'serve was already called',
    });
  });

  it('contracts: serve called twice throws also after a failed serve', async () => {
    const {control} = await served(failingFor(0));
    throws(() => control.serve(SERVE, () => undefined), {
      message: 'serve was already called',
    });
  });

  it('cli serverlog: two sockets asked for at once send the second serve after the first reply', async () => {
    const {peer} = await twoPending();
    deepStrictEqual(serveIds(peer), [0, 1]);
  });

  it('cli serverlog: the second serve is sent once the first has replied', async () => {
    const {peer} = await twoPending();
    peer.send({id: 2, result: {}});
    await settle();
    deepStrictEqual(serveIds(peer), [0, 1, 2]);
  });

  it('cli serverlog: a second serve waits for the first even when the first failed', async () => {
    const {peer} = await twoPending();
    peer.send({id: 2, error: {code: -1, message: 'other'}});
    await settle();
    deepStrictEqual(serveIds(peer), [0, 1, 2]);
  });

  it('cli serverlog: a serve whose send throws does not stop the next serve', async () => {
    const peer = fakeCli(accepting);
    let failing = false;
    const control = openCliControl({
      ...peer.stream,
      send: chunk => {
        if (failing) {
          throw new Error('the stream is gone');
        }
        return peer.stream.send(chunk);
      },
    });
    await control.serve(SERVE, () => undefined);
    failing = true;
    await control.openSocket(() => undefined).catch(() => undefined);
    failing = false;
    strictEqual((await control.openSocket(() => undefined)).kind, 'serving');
  });

  it('§4a: a socket sends its bytes as a servermsg', async () => {
    const {peer, sockets} = await threeSockets();
    sockets[0]?.send(new Uint8Array([1, 2, 3]));
    deepStrictEqual(frames(peer), [
      {method: 'servermsg', params: {i: 0, body: new Uint8Array([1, 2, 3])}},
    ]);
  });

  it('§4a: a servermsg for the second socket reaches only the second socket', async () => {
    const {peer, received} = await threeSockets();
    peer.send({
      id: null,
      method: 'servermsg',
      params: {i: 1, body: new Uint8Array([9])},
    });
    await settle();
    deepStrictEqual(received, [[1, new Uint8Array([9])]]);
  });

  it('§4a: a servermsg for an unknown socket is ignored', async () => {
    const {peer, received} = await threeSockets();
    peer.send({
      id: null,
      method: 'servermsg',
      params: {i: 7, body: new Uint8Array([9])},
    });
    await settle();
    deepStrictEqual(received, []);
  });

  it('§4a: a servermsg whose body is not bytes is ignored', async () => {
    const {peer, received} = await threeSockets();
    peer.send({id: null, method: 'servermsg', params: {i: 0, body: 'text'}});
    await settle();
    deepStrictEqual(received, []);
  });

  it('§4a: a serverclose ends only its socket, once', async () => {
    const {peer, closed} = await threeSockets();
    peer.send(
      {id: null, method: 'serverclose', params: {i: 0}},
      {id: null, method: 'serverclose', params: {i: 0}},
    );
    await settle();
    deepStrictEqual(closed, [0]);
  });

  it('§4a: a serverclose for an unknown socket is ignored', async () => {
    const {peer, closed} = await threeSockets();
    peer.send({id: null, method: 'serverclose', params: {i: 5}});
    await settle();
    deepStrictEqual(closed, []);
  });

  it('§4a: a notification of another method is ignored', async () => {
    const {peer, closed, received} = await threeSockets();
    peer.send({id: null, method: 'other', params: {i: 0}});
    await settle();
    deepStrictEqual([closed, received], [[], []]);
  });

  it('§4a: a send after serverclose sends no servermsg', async () => {
    const {peer, sockets} = await threeSockets();
    peer.send({id: null, method: 'serverclose', params: {i: 0}});
    await settle();
    sockets[0]?.send(new Uint8Array([1]));
    deepStrictEqual(frames(peer), []);
  });

  it('§4a: a send after the connection ended sends no servermsg', async () => {
    const {peer, sockets} = await threeSockets();
    peer.end();
    await settle();
    sockets[1]?.send(new Uint8Array([1]));
    deepStrictEqual(frames(peer), []);
  });

  it('§4a: a listener added after the socket closed is told at once', async () => {
    const {peer, sockets} = await threeSockets();
    peer.send({id: null, method: 'serverclose', params: {i: 1}});
    await settle();
    let told = 0;
    sockets[1]?.onClose(() => {
      told += 1;
    });
    strictEqual(told, 1);
  });

  it('contracts: the stream closing during a socket serve closes it', async () => {
    const {peer, control} = await served(silentFor(1));
    const opened = control.openSocket(() => undefined);
    await settle();
    peer.end();
    deepStrictEqual(await opened, {kind: 'closed'});
  });

  it('contracts: the stream closing ends every open socket once', async () => {
    const {peer, closed} = await threeSockets();
    peer.end();
    await settle();
    deepStrictEqual(closed, [0, 1, 2]);
  });

  it('contracts: closing the control ends every open socket once', async () => {
    const {control, closed} = await threeSockets();
    control.close();
    control.close();
    await settle();
    deepStrictEqual(closed, [0, 1, 2]);
  });

  it('contracts: closing the control twice closes the stream once', () => {
    const {peer, control} = connected(() => []);
    control.close();
    control.close();
    strictEqual(peer.closes(), 1);
  });

  it('contracts: closing the control after the stream ended does not close the stream', async () => {
    const {peer, control} = connected(() => []);
    peer.end();
    await settle();
    control.close();
    strictEqual(peer.closes(), 0);
  });

  it('contracts: closing the control settles a pending serve as closed', async () => {
    const {control} = connected(() => []);
    const answer = control.serve(SERVE, () => undefined);
    control.close();
    deepStrictEqual(await answer, {kind: 'closed'});
  });
});
