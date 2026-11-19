import {deepStrictEqual} from 'node:assert';
import {createHash} from 'node:crypto';
import {createServer, type Server} from 'node:http';
import type {AddressInfo, Socket} from 'node:net';
import {
  evaluateAt,
  excerptOf,
  NoAnswerError,
  unavailableWhenNoAnswer,
} from '../tests/acceptance/windows/page-protocol.ts';

/** A text frame of a server to its client: unmasked, with the length forms of a short and a medium payload. */
function textFrame(text: string): Buffer {
  const payload = Buffer.from(text);
  const head =
    payload.length < 126
      ? Buffer.from([0x81, payload.length])
      : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 255]);
  return Buffer.concat([head, payload]);
}

/** A protocol server of the test: what each client socket does once its request arrives is `onRequest`'s. */
async function protocolServer(
  onRequest: (socket: Socket) => void,
): Promise<{address: string; stop(): Promise<void>}> {
  const sockets = new Set<Socket>();
  const server: Server = createServer();
  server.on('upgrade', (request, socket: Socket) => {
    sockets.add(socket);
    socket.on('error', () => undefined);
    socket.on('close', () => sockets.delete(socket));
    const accept = createHash('sha1')
      .update(
        `${String(request.headers['sec-websocket-key'])}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`,
      )
      .digest('base64');
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    socket.once('data', () => {
      onRequest(socket);
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const {port} = server.address() as AddressInfo;
  return {
    address: `ws://127.0.0.1:${String(port)}`,
    stop: () =>
      new Promise<void>(resolve => {
        for (const socket of sockets) {
          socket.destroy();
        }
        server.close(() => {
          resolve();
        });
      }),
  };
}

/** What `evaluateAt` does against a server that behaves as `onRequest` says: its value, or the text of its failure. */
async function readAgainst(
  onRequest: (socket: Socket) => void,
  milliseconds?: number,
  expression = 'document.title',
): Promise<unknown> {
  const server = await protocolServer(onRequest);
  try {
    return await evaluateAt(
      server.address,
      'window w1',
      expression,
      milliseconds,
    ).catch((caught: unknown) => ({
      failure: String(caught),
      noAnswer: caught instanceof NoAnswerError,
    }));
  } finally {
    await server.stop();
  }
}

/** The protocol's answer to the request number `request`, holding `value`. */
function answerOf(value: unknown, request = 1): string {
  return JSON.stringify({id: request, result: {result: {value}}});
}

describe('the protocol connection of the page reads (card #2858)', () => {
  it('#2858: an answer within the bound gives its value, and a message of another id is not the answer', async () => {
    deepStrictEqual(
      [
        await readAgainst(socket => {
          socket.write(textFrame(answerOf(42)));
        }),
        await readAgainst(socket => {
          socket.write(textFrame(answerOf('stray', 2)));
          socket.write(textFrame('not json'));
          socket.write(textFrame(answerOf('own')));
        }),
      ],
      [42, 'own'],
    );
  });

  it('#2858: a page that gives no answer fails the read within its bound, naming the page and the read', async () => {
    deepStrictEqual(await readAgainst(() => undefined, 150), {
      failure: 'Error: window w1: no answer within 0.2 s to "document.title"',
      noAnswer: true,
    });
  });

  it('#2858: a socket that closes before the answer fails the read and names the page and the read', async () => {
    const outcome = (await readAgainst(socket => {
      socket.destroy();
    })) as {failure: string; noAnswer: boolean};
    deepStrictEqual(
      [
        /^Error: window w1: the protocol connection (closed|failed) before the answer to "document\.title"$/u.test(
          outcome.failure,
        ),
        outcome.noAnswer,
      ],
      [true, false],
    );
  });

  it('#2858: an answer that carries an exception is the read’s failure with its text', async () => {
    deepStrictEqual(
      await readAgainst(socket => {
        socket.write(
          textFrame(
            JSON.stringify({
              id: 1,
              result: {
                exceptionDetails: {
                  text: 'Uncaught',
                  exception: {description: 'TypeError: x is null'},
                },
              },
            }),
          ),
        );
      }),
      {failure: 'Error: window w1: TypeError: x is null', noAnswer: false},
    );
  });

  it('#2858: the read is named by the first 120 characters of its expression on one line', () => {
    deepStrictEqual(
      [
        excerptOf('(() => {\n   return   1;\n })()'),
        excerptOf(`x${'y'.repeat(200)}`).length,
      ],
      ['"(() => { return 1; })()"', 122],
    );
  });

  it('#2858: a read that did not answer in time is unavailable for a row that asks for that, and any other failure or value stands', async () => {
    deepStrictEqual(
      [
        await unavailableWhenNoAnswer(
          Promise.reject(new NoAnswerError('slow')),
        ),
        await unavailableWhenNoAnswer(Promise.resolve({rows: 1})),
        await unavailableWhenNoAnswer(Promise.reject(new Error('closed'))).then(
          () => 'resolved',
          (caught: unknown) => String(caught),
        ),
      ],
      ['unavailable', {rows: 1}, 'Error: closed'],
    );
  });
});
