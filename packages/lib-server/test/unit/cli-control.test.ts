import {deepStrictEqual, strictEqual} from 'node:assert';
import {encode} from '@msgpack/msgpack';
import {fakeCli, type Request} from '../../src/testing/fake-cli.ts';
import {
  type CliControl,
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

const TEMPLATE_ERROR =
  'WrappedError(WrappedError { message: "cannot expand ${release} in the server template", original: "" })';

/** The reply to `request` when the CLI accepts the challenge. */
function accepting(request: Request): unknown[] {
  if (request.method === 'challenge_issue') {
    return [{id: request.id, result: {challenge: CHALLENGE}}];
  }
  return [{id: request.id, result: {}}];
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
    deepStrictEqual(await control.serve(SERVE, () => undefined), {
      kind: 'serving',
    });
  });

  it('V7a, R1: the error reply is told with the level 4 line', async () => {
    const {control} = connected(request => [
      logOf('Checking …', 2),
      logOf(
        'Error installing server: cannot expand ${release} in the server template',
        4,
      ),
      {id: request.id, error: {code: -1, message: TEMPLATE_ERROR}},
    ]);
    deepStrictEqual(await control.serve(SERVE, () => undefined), {
      kind: 'serveFailed',
      error: {kind: 'template', message: TEMPLATE_ERROR},
      message: TEMPLATE_ERROR,
      errorLine:
        'Error installing server: cannot expand ${release} in the server template',
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
    let calls = 0;
    const {control} = connected(request => {
      calls += 1;
      return calls === 1
        ? [logOf('old', 4), {id: request.id, result: {}}]
        : [{id: request.id, error: {code: -1, message: 'other'}}];
    });
    await control.serve(SERVE, () => undefined);
    strictEqual(await errorLineOf(control), undefined);
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
    deepStrictEqual([await answer, seen], [{kind: 'serving'}, ['before']]);
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
    deepStrictEqual(await answer, {kind: 'serving'});
  });

  it('V7a: a message that is not a map is ignored and the next reply is handled', async () => {
    const {peer, control} = connected(() => []);
    const answer = control.serve(SERVE, () => undefined);
    peer.send('text', [1, 2], {id: 1, result: {}});
    deepStrictEqual(await answer, {kind: 'serving'});
  });

  it('contracts: a reply to an unknown id is ignored', async () => {
    const {peer, control} = connected(() => []);
    const answer = control.serve(SERVE, () => undefined);
    peer.send({id: 99, result: {}}, {id: 1, result: {}});
    deepStrictEqual(await answer, {kind: 'serving'});
  });

  it('contracts: a map with an id and neither result nor error is ignored', async () => {
    const {peer, control} = connected(() => []);
    const answer = control.serve(SERVE, () => undefined);
    peer.send({id: 1}, {id: 1, result: {}});
    deepStrictEqual(await answer, {kind: 'serving'});
  });

  it('contracts: a map with neither an id nor a method is ignored', async () => {
    const {peer, control} = connected(() => []);
    const answer = control.serve(SERVE, () => undefined);
    peer.send({other: 1}, {id: 1, result: {}});
    deepStrictEqual(await answer, {kind: 'serving'});
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
    deepStrictEqual(await answer, {kind: 'serving'});
  });

  it('contracts: an error reply without a message is ignored', async () => {
    const {peer, control} = connected(() => []);
    const answer = control.serve(SERVE, () => undefined);
    peer.send({id: 1, error: {code: -1}}, {id: 1, result: {}});
    deepStrictEqual(await answer, {kind: 'serving'});
  });

  it('contracts: bytes that are not msgpack end the connection', async () => {
    const {peer, control} = connected(() => []);
    const answer = control.serve(SERVE, () => undefined);
    peer.deliver(new Uint8Array([0xc1]));
    deepStrictEqual(await answer, {kind: 'closed'});
  });
});

describe('the CLI control client: the server sockets', () => {
  /** A control connection with two sockets open. */
  function twoSockets(): {
    peer: ReturnType<typeof fakeCli>;
    control: CliControl;
    received: Array<[number, Uint8Array]>;
    closed: number[];
    sockets: Array<ReturnType<CliControl['openSocket']>>;
  } {
    const {peer, control} = connected(() => []);
    const received: Array<[number, Uint8Array]> = [];
    const closed: number[] = [];
    const sockets = [control.openSocket(), control.openSocket()];
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

  it('§4a: two sockets get the ids 0 and 1', () => {
    deepStrictEqual(
      twoSockets().sockets.map(socket => socket.socketId),
      [0, 1],
    );
  });

  it('§4a: a socket sends its bytes as a servermsg', () => {
    const {peer, sockets} = twoSockets();
    sockets[0]?.send(new Uint8Array([1, 2, 3]));
    deepStrictEqual(peer.requests[0], {
      method: 'servermsg',
      params: {i: 0, body: new Uint8Array([1, 2, 3])},
    });
  });

  it('§4a: a servermsg for the second socket reaches only the second socket', async () => {
    const {peer, received} = twoSockets();
    peer.send({
      id: null,
      method: 'servermsg',
      params: {i: 1, body: new Uint8Array([9])},
    });
    await settle();
    deepStrictEqual(received, [[1, new Uint8Array([9])]]);
  });

  it('§4a: a servermsg for an unknown socket is ignored', async () => {
    const {peer, received} = twoSockets();
    peer.send({
      id: null,
      method: 'servermsg',
      params: {i: 7, body: new Uint8Array([9])},
    });
    await settle();
    deepStrictEqual(received, []);
  });

  it('§4a: a servermsg whose body is not bytes is ignored', async () => {
    const {peer, received} = twoSockets();
    peer.send({id: null, method: 'servermsg', params: {i: 0, body: 'text'}});
    await settle();
    deepStrictEqual(received, []);
  });

  it('§4a: a serverclose ends only its socket, once', async () => {
    const {peer, closed} = twoSockets();
    peer.send(
      {id: null, method: 'serverclose', params: {i: 0}},
      {id: null, method: 'serverclose', params: {i: 0}},
    );
    await settle();
    deepStrictEqual(closed, [0]);
  });

  it('§4a: a serverclose for an unknown socket is ignored', async () => {
    const {peer, closed} = twoSockets();
    peer.send({id: null, method: 'serverclose', params: {i: 5}});
    await settle();
    deepStrictEqual(closed, []);
  });

  it('§4a: a notification of another method is ignored', async () => {
    const {peer, closed, received} = twoSockets();
    peer.send({id: null, method: 'other', params: {i: 0}});
    await settle();
    deepStrictEqual([closed, received], [[], []]);
  });

  it('§4a: a socket sends nothing once the connection ended', async () => {
    const {peer, sockets} = twoSockets();
    peer.end();
    await settle();
    sockets[0]?.send(new Uint8Array([1]));
    deepStrictEqual(peer.requests, []);
  });

  it('§4a: a socket opened after the connection ended is closed at once', async () => {
    const {peer, control} = connected(() => []);
    peer.end();
    await settle();
    let closed = 0;
    control.openSocket().onClose(() => {
      closed += 1;
    });
    strictEqual(closed, 1);
  });

  it('contracts: the stream closing ends every socket once', async () => {
    const {peer, closed} = twoSockets();
    peer.end();
    await settle();
    deepStrictEqual(closed, [0, 1]);
  });

  it('contracts: closing the control ends every socket once', async () => {
    const {control, closed} = twoSockets();
    control.close();
    await settle();
    deepStrictEqual(closed, [0, 1]);
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
