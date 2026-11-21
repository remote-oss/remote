import {deepStrictEqual} from 'node:assert';
import {createHash} from 'node:crypto';
import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {createServer, type Server} from 'node:http';
import {
  createServer as createNetServer,
  type AddressInfo,
  type Socket,
} from 'node:net';
import {
  dispatchAt,
  evaluateAt,
  excerptOf,
  NoAnswerError,
  unavailableWhenNoAnswer,
} from '../tests/acceptance/windows/page-protocol.ts';
import {REPOSITORY_ROOT} from './repository.ts';

/** A text frame of a server to its client: unmasked, with the length forms of a short and a medium payload. */
function textFrame(text: string): Buffer {
  const payload = Buffer.from(text);
  const head =
    payload.length < 126
      ? Buffer.from([0x81, payload.length])
      : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 255]);
  return Buffer.concat([head, payload]);
}

/** A protocol server of the test: what each client socket does as each of its requests arrives is `onRequest`'s. */
async function protocolServer(
  onRequest: (socket: Socket, frame: Buffer) => void,
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
    socket.on('data', frame => {
      onRequest(socket, frame);
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

/**
 * What `evaluateAt` does against a server that behaves as the handlers say, one per request in order (the last one
 * repeated): its value, or the text of its failure.
 */
async function readAgainst(
  onRequests: Array<(socket: Socket) => void> | ((socket: Socket) => void),
  milliseconds?: number,
  expression = 'document.title',
  diagnosticsExpression?: string,
): Promise<unknown> {
  const handlers = Array.isArray(onRequests) ? onRequests : [onRequests];
  let request = 0;
  const server = await protocolServer(socket => {
    const handler = handlers[Math.min(request, handlers.length - 1)];
    request += 1;
    if (handler === undefined) {
      throw new Error('readAgainst: no handler for the request');
    }
    handler(socket);
  });
  try {
    return await evaluateAt(
      server.address,
      'window w1',
      expression,
      milliseconds,
      diagnosticsExpression,
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

/** The request of the client's masked text frame, as the protocol server sees it. */
function requestOf(frame: Buffer): {id: number; method: string} {
  const short = (frame[1] ?? 0) & 127;
  const lengthBytes = short === 126 ? 2 : 0;
  const length = short === 126 ? frame.readUInt16BE(2) : short;
  const mask = frame.subarray(2 + lengthBytes, 6 + lengthBytes);
  const payload = Buffer.from(
    frame.subarray(6 + lengthBytes, 6 + lengthBytes + length),
  );
  for (const [index, byte] of payload.entries()) {
    payload[index] = byte ^ (mask[index % 4] ?? 0);
  }
  return JSON.parse(payload.toString()) as {id: number; method: string};
}

/** The key events of a press of `a`, as the harness sends them. */
const PRESS = [
  {method: 'Input.dispatchKeyEvent', params: {type: 'keyDown', key: 'a'}},
  {method: 'Input.dispatchKeyEvent', params: {type: 'keyUp', key: 'a'}},
];

/** What `dispatchAt` does with `PRESS` against a server that behaves as `onRequest` says: the requests it made, or its failure. */
async function pressAgainst(
  onRequest: (socket: Socket, request: {id: number; method: string}) => void,
  milliseconds?: number,
): Promise<unknown> {
  const requests: Array<[number, string]> = [];
  const server = await protocolServer((socket, frame) => {
    if (((frame[0] ?? 0) & 15) !== 1) {
      // The client's close frame, in answer to the server's, is no request.
      return;
    }
    const request = requestOf(frame);
    requests.push([request.id, request.method]);
    onRequest(socket, request);
  });
  try {
    return await dispatchAt(
      server.address,
      'window w1',
      PRESS,
      milliseconds,
    ).then(
      () => requests,
      (caught: unknown) => ({
        failure: String(caught),
        noAnswer: caught instanceof NoAnswerError,
        requests,
      }),
    );
  } finally {
    await server.stop();
  }
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

  it('#2858: a read that gives no answer asks the page once more, briefly, for its diagnostics, and a left trace joins the failure', async () => {
    deepStrictEqual(
      await readAgainst(
        [
          () => undefined,
          socket => socket.write(textFrame(answerOf('the trace'))),
        ],
        150,
        'document.title',
        'window.remoteOssTrace',
      ),
      {
        failure:
          'Error: window w1: no answer within 0.2 s to "document.title"\nwindow w1 left: the trace',
        noAnswer: true,
      },
    );
  });

  it('#2858: a diagnostics read that does not answer either keeps the failure as it was', async () => {
    deepStrictEqual(
      await readAgainst(
        [() => undefined, () => undefined],
        150,
        'document.title',
        'window.remoteOssTrace',
      ),
      {
        failure: 'Error: window w1: no answer within 0.2 s to "document.title"',
        noAnswer: true,
      },
    );
  });

  it('#2858: an answer within the bound makes no diagnostics read, and a page that leaves no trace leaves none in the failure', async () => {
    const requests = [];
    deepStrictEqual(
      [
        await (async () => {
          const server = await protocolServer(socket => {
            requests.push('main');
            socket.write(textFrame(answerOf(7)));
          });
          try {
            const value = await evaluateAt(
              server.address,
              'window w1',
              'document.title',
              undefined,
              'window.remoteOssTrace',
            );
            return [value, requests.length];
          } finally {
            await server.stop();
          }
        })(),
        await readAgainst(
          [() => undefined, socket => socket.write(textFrame(answerOf(null)))],
          150,
          'document.title',
          'window.remoteOssTrace',
        ),
      ],
      [
        [7, 1],
        {
          failure:
            'Error: window w1: no answer within 0.2 s to "document.title"',
          noAnswer: true,
        },
      ],
    );
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

describe('the long bound of the reads that walk a list in the page (card #2858)', () => {
  it('#2858: every function of the renderer helpers whose in-page code loops with while and awaits passes the long bound, and the three that do are the walkers', () => {
    const source = readFileSync(
      path.join(
        REPOSITORY_ROOT,
        'tests',
        'acceptance',
        'windows',
        'renderer.ts',
      ),
      'utf8',
    );
    const walkers = source
      .split(/\n(?=(?:export )?(?:async )?function )/u)
      .flatMap(block => {
        const name = /^(?:export )?(?:async )?function (\w+)/u.exec(block)?.[1];
        const page = (block.match(/`[^`]*`/gu) ?? []).join('\n');
        return name !== undefined &&
          page.includes('while (') &&
          page.includes('await ')
          ? [[name, block.includes('LONG_READ_MILLISECONDS')] as const]
          : [];
      });
    deepStrictEqual(walkers, [
      ['viewRows', true],
      ['portsRows', true],
      ['allQuickPickRows', true],
    ]);
  });
});

describe('the protocol connection of the page inputs (card #2908)', () => {
  it('#2908: each command is sent after the answer to the one before, and the answers end the press', async () => {
    deepStrictEqual(
      await pressAgainst((socket, request) => {
        socket.write(textFrame(answerOf({}, request.id)));
      }),
      [
        [1, 'Input.dispatchKeyEvent'],
        [2, 'Input.dispatchKeyEvent'],
      ],
    );
  });

  it('#2908: a page that gives no answer to the first command fails the press within its bound, naming the page and the command', async () => {
    deepStrictEqual(await pressAgainst(() => undefined, 150), {
      failure:
        'Error: window w1: no answer within 0.2 s to Input.dispatchKeyEvent {"type":"keyDown","key":"a"}',
      noAnswer: true,
      requests: [[1, 'Input.dispatchKeyEvent']],
    });
  });

  it('#2908: a frame of another id is not the answer, so a page that only sends one gives no answer', async () => {
    deepStrictEqual(
      await pressAgainst((socket, request) => {
        socket.write(textFrame(answerOf({}, request.id + 40)));
      }, 150),
      {
        failure:
          'Error: window w1: no answer within 0.2 s to Input.dispatchKeyEvent {"type":"keyDown","key":"a"}',
        noAnswer: true,
        requests: [[1, 'Input.dispatchKeyEvent']],
      },
    );
  });

  it('#2908: a page that answers the first command and not the second fails at the second, which the failure names', async () => {
    deepStrictEqual(
      await pressAgainst((socket, request) => {
        if (request.id === 1) {
          socket.write(textFrame(answerOf({}, 1)));
        }
      }, 150),
      {
        failure:
          'Error: window w1: no answer within 0.2 s to Input.dispatchKeyEvent {"type":"keyUp","key":"a"}',
        noAnswer: true,
        requests: [
          [1, 'Input.dispatchKeyEvent'],
          [2, 'Input.dispatchKeyEvent'],
        ],
      },
    );
  });

  it('#2908: a socket that closes before an answer fails the press and names the page and the command', async () => {
    const outcome = (await pressAgainst(socket => {
      socket.destroy();
    })) as {failure: string; noAnswer: boolean};
    deepStrictEqual(
      [
        /^Error: window w1: the protocol connection (closed|failed) before the answer to Input\.dispatchKeyEvent \{"type":"keyDown","key":"a"\}$/u.test(
          outcome.failure,
        ),
        outcome.noAnswer,
      ],
      [true, false],
    );
  });

  it('#2908: a socket that the page closes with a close frame fails the press as closed, naming the page and the command', async () => {
    const outcome = (await pressAgainst(socket => {
      socket.end(Buffer.from([0x88, 0x00]));
    })) as {failure: string};
    deepStrictEqual(
      outcome.failure,
      'Error: window w1: the protocol connection closed before the answer to Input.dispatchKeyEvent {"type":"keyDown","key":"a"}',
    );
  });

  /** A port that accepts the connection and never completes the upgrade, as a browser process that stopped answering does. */
  async function silentPort(): Promise<{
    address: string;
    stop(): Promise<void>;
  }> {
    const sockets = new Set<Socket>();
    let stopped = false;
    const server = createNetServer(socket => {
      // A connection that arrives after the stop, from a client still connecting, is ended at once.
      if (stopped) {
        socket.destroy();
        return;
      }
      sockets.add(socket);
      socket.on('error', () => undefined);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const {port} = server.address() as AddressInfo;
    return {
      address: `ws://127.0.0.1:${String(port)}`,
      stop: () =>
        new Promise<void>(resolve => {
          stopped = true;
          server.close(() => {
            resolve();
          });
          for (const socket of sockets) {
            socket.destroy();
          }
        }),
    };
  }

  it('#2908: a port that accepts and never completes the upgrade fails the read and the press within the bound, naming the page', async () => {
    const port = await silentPort();
    try {
      const failures = await Promise.all([
        evaluateAt(port.address, 'window w1', 'document.title', 150).then(
          () => 'answered',
          (caught: unknown) => [
            String(caught),
            caught instanceof NoAnswerError,
          ],
        ),
        dispatchAt(port.address, 'window w1', PRESS, 150).then(
          () => 'answered',
          (caught: unknown) => [
            String(caught),
            caught instanceof NoAnswerError,
          ],
        ),
      ]);
      deepStrictEqual(failures, [
        ['Error: window w1: no protocol connection within 0.2 s', true],
        ['Error: window w1: no protocol connection within 0.2 s', true],
      ]);
    } finally {
      await port.stop();
    }
  });

  it('#2908: no window of the harness opens a protocol socket or reads the debugging port’s list outside its two modules', () => {
    const folder = path.join(REPOSITORY_ROOT, 'tests', 'acceptance', 'windows');
    const outside = readdirSync(folder)
      .filter(
        name =>
          name.endsWith('.ts') &&
          !['page-protocol.ts', 'page-list.ts'].includes(name),
      )
      .filter(name => {
        const source = readFileSync(path.join(folder, name), 'utf8');
        return (
          source.includes('new WebSocket(') || source.includes('/json/list')
        );
      });
    deepStrictEqual(outside, []);
  });
});
