/**
 * @fileoverview The engine stand-in's rewrite of a container create, and its relay against a fake engine.
 */

import {deepStrictEqual, rejects} from 'node:assert';
import {spawn} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {
  createServer,
  type IncomingMessage,
  request,
  type Server,
  type ServerResponse,
} from 'node:http';
import {type AddressInfo, connect, type Socket} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {buffer} from 'node:stream/consumers';
import {
  distroPathOf,
  longPath,
  rewriteCreate,
  type StandIn,
  standInFromCommandLine,
  startStandIn,
} from './engine-stand-in.ts';

/** The long form a runner gives its short-named temporary folder. */
function longPathOf(source: string): string {
  return source.replace('RUNNER~1', 'runneradmin');
}

/** A container create with a drive-like bind source and mount source, beside sources that are never rewritten. */
function createBody(bindSource: string, mountSource: string): object {
  return {
    Image: 'alpine',
    HostConfig: {
      Binds: [
        `${bindSource}:/workspaces/run:ro`,
        '/home/runner/run:/workspaces/posix',
        'vscode:/vscode',
        'c:/vscode',
        7,
      ],
      Mounts: [
        {Type: 'bind', Source: mountSource, Target: '/workspaces/c202'},
        {Type: 'volume', Source: 'vscode', Target: '/vscode'},
        {Type: 'bind', Source: '/home/runner/run', Target: '/posix'},
        {Type: 'bind', Target: '/no-source'},
        null,
      ],
    },
  };
}

/** What the fake engine was asked. */
interface Asked {
  method: string;
  url: string;
  length: string | undefined;
  body: string;
}

/** A fake engine on 127.0.0.1 that records each request and answers with `answer`. */
async function fakeEngine(
  answer: (asked: Asked, response: ServerResponse) => void,
): Promise<{server: Server; port: number; asked: Asked[]}> {
  const asked: Asked[] = [];
  const server = createServer((incoming: IncomingMessage, response) => {
    void buffer(incoming).then(body => {
      const record = {
        method: String(incoming.method),
        url: String(incoming.url),
        length: incoming.headers['content-length'],
        body: body.toString('utf8'),
      };
      asked.push(record);
      answer(record, response);
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return {server, port: (server.address() as AddressInfo).port, asked};
}

/** The status and body of a request through the stand-in at `address`. */
function through(
  address: string,
  method: string,
  url: string,
  body?: string,
): Promise<{status: number; body: string}> {
  return new Promise((resolve, reject) => {
    const sent = request(
      new URL(url, address.replace('tcp:', 'http:')),
      {method},
      answer => {
        void buffer(answer).then(text => {
          resolve({
            status: Number(answer.statusCode),
            body: text.toString('utf8'),
          });
        }, reject);
      },
    );
    sent.on('error', reject);
    sent.end(body);
  });
}

function closed(server: Server): Promise<void> {
  return new Promise(resolve => {
    server.closeAllConnections();
    server.close(() => {
      resolve();
    });
  });
}

describe('the engine stand-in in front of a WSL engine (card #2511)', () => {
  const lines: string[] = [];
  let engine: Awaited<ReturnType<typeof fakeEngine>>;
  let standIn: StandIn;

  beforeEach(async () => {
    lines.length = 0;
    engine = await fakeEngine((asked, response) => {
      response.writeHead(201, {'content-type': 'application/json'});
      response.end(`{"answered":"${asked.url}"}`);
    });
    standIn = await startStandIn(
      {host: '127.0.0.1', port: engine.port},
      {report: line => lines.push(line), longPathOf},
    );
  });

  afterEach(async () => {
    await standIn.close();
    await closed(engine.server);
  });

  it('#2511: a drive path becomes the distro path of its long form, with either slash; any other path is not one', () => {
    deepStrictEqual(
      [
        distroPathOf('C:\\Users\\RUNNER~1\\Temp\\run', longPathOf),
        distroPathOf('d:/work/run', longPathOf),
        distroPathOf('/home/runner/run', longPathOf),
        distroPathOf('run\\folder', longPathOf),
        distroPathOf('\\\\wsl.localhost\\Ubuntu\\run', longPathOf),
      ],
      [
        '/mnt/c/Users/runneradmin/Temp/run',
        '/mnt/d/work/run',
        undefined,
        undefined,
        undefined,
      ],
    );
  });

  it('#2511: a path that exists is read in its long form here, and one that does not stays as given', () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'stand-in-'));
    try {
      deepStrictEqual(
        [longPath(folder), longPath(path.join(folder, 'missing'))],
        [folder, path.join(folder, 'missing')],
      );
    } finally {
      rmSync(folder, {recursive: true});
    }
  });

  it('#2511: Binds and bind Mounts on a drive are rewritten with their options kept; POSIX sources, volumes and a one-letter volume name are not', () => {
    const reading = rewriteCreate(
      Buffer.from(
        JSON.stringify(
          createBody(
            'C:\\Users\\RUNNER~1\\Temp\\run',
            'c:\\Users\\RUNNER~1\\Temp\\c202',
          ),
        ),
      ),
      longPathOf,
    );
    deepStrictEqual(
      reading.kind === 'read'
        ? {
            parsed: JSON.parse(reading.body.toString('utf8')) as unknown,
            rewrites: reading.rewrites,
          }
        : reading,
      {
        parsed: createBody(
          '/mnt/c/Users/runneradmin/Temp/run',
          '/mnt/c/Users/runneradmin/Temp/c202',
        ),
        rewrites: [
          'HostConfig.Binds[0] C:\\Users\\RUNNER~1\\Temp\\run -> /mnt/c/Users/runneradmin/Temp/run',
          'HostConfig.Mounts[0].Source c:\\Users\\RUNNER~1\\Temp\\c202 -> /mnt/c/Users/runneradmin/Temp/c202',
        ],
      },
    );
  });

  it('#2511: a body with nothing to rewrite is kept byte for byte, and one that is not JSON is unparsed, never rewritten', () => {
    const untouched = Buffer.from(
      '{ "Image" : "alpine",\n "HostConfig": {"Binds": ["/a:/b"]} }',
    );
    const reading = rewriteCreate(untouched, longPathOf);
    const unparsed = rewriteCreate(
      Buffer.from('{"HostConfig": {"Binds": ["C:\\\\x:/w"'),
      longPathOf,
    );
    deepStrictEqual(
      [
        reading.kind === 'read' && reading.body === untouched,
        rewriteCreate(Buffer.from('null'), longPathOf).kind,
        unparsed.kind,
      ],
      [true, 'read', 'unparsed'],
    );
  });

  it('#2511: a create through the stand-in reaches the engine rewritten, with its new length, and each rewrite is logged', async () => {
    const sent = JSON.stringify({
      HostConfig: {Binds: ['C:\\Users\\RUNNER~1\\x:/w']},
    });
    const answer = await through(
      standIn.address,
      'POST',
      '/v1.47/containers/create?name=c202',
      sent,
    );
    const expected = JSON.stringify({
      HostConfig: {Binds: ['/mnt/c/Users/runneradmin/x:/w']},
    });
    deepStrictEqual(
      {answer, asked: engine.asked, lines},
      {
        answer: {
          status: 201,
          body: '{"answered":"/v1.47/containers/create?name=c202"}',
        },
        asked: [
          {
            method: 'POST',
            url: '/v1.47/containers/create?name=c202',
            length: String(Buffer.byteLength(expected)),
            body: expected,
          },
        ],
        lines: [
          'engine-stand-in: POST /v1.47/containers/create?name=c202: HostConfig.Binds[0] C:\\Users\\RUNNER~1\\x -> /mnt/c/Users/runneradmin/x',
        ],
      },
    );
  });

  it('#2511: a create whose body is not JSON reaches the engine unchanged, and the log says so', async () => {
    await through(standIn.address, 'POST', '/containers/create', 'not json');
    deepStrictEqual(
      {
        body: engine.asked[0]?.body,
        said: lines.map(line => line.split(' (')[0]),
      },
      {
        body: 'not json',
        said: [
          'engine-stand-in: POST /containers/create: the body is not JSON',
        ],
      },
    );
  });

  it('#2511: any other request, a POST with a body among them, passes through unchanged', async () => {
    const version = await through(standIn.address, 'GET', '/v1.47/version');
    const start = await through(
      standIn.address,
      'POST',
      '/containers/abc/start',
      'C:\\x:/w',
    );
    deepStrictEqual(
      {
        version,
        start,
        asked: engine.asked.map(asked => [asked.method, asked.url, asked.body]),
        lines,
      },
      {
        version: {status: 201, body: '{"answered":"/v1.47/version"}'},
        start: {status: 201, body: '{"answered":"/containers/abc/start"}'},
        asked: [
          ['GET', '/v1.47/version', ''],
          ['POST', '/containers/abc/start', 'C:\\x:/w'],
        ],
        lines: [],
      },
    );
  });

  it('#2511: response headers reach the client as soon as the engine sends them, before any of the body, as a container wait needs', async () => {
    await closed(engine.server);
    const held: ServerResponse[] = [];
    engine = await fakeEngine((asked, response) => {
      response.writeHead(200, {'content-type': 'application/json'});
      response.flushHeaders();
      held.push(response);
    });
    const waiting = await startStandIn(
      {host: '127.0.0.1', port: engine.port},
      {report: line => lines.push(line), longPathOf},
    );
    try {
      const headed = await new Promise<IncomingMessage>((resolve, reject) => {
        const sent = request(
          new URL(
            '/containers/abc/wait',
            waiting.address.replace('tcp:', 'http:'),
          ),
          {method: 'POST'},
          resolve,
        );
        sent.on('error', reject);
        sent.end();
      });
      const bodyHeld = held.length;
      held[0]?.end('{"StatusCode":0}');
      deepStrictEqual(
        {
          status: headed.statusCode,
          bodyHeld,
          body: (await buffer(headed)).toString('utf8'),
        },
        {status: 200, bodyHeld: 1, body: '{"StatusCode":0}'},
      );
    } finally {
      await waiting.close();
    }
  });

  it('#2511: an engine that is not there answers 502 with the reason, and the log says so', async () => {
    const port = engine.port;
    await closed(engine.server);
    engine = await fakeEngine(() => undefined);
    const absent = await startStandIn(
      {host: '127.0.0.1', port},
      {report: line => lines.push(line), longPathOf},
    );
    try {
      const answer = await through(absent.address, 'GET', '/_ping');
      deepStrictEqual(
        {
          status: answer.status,
          reason: answer.body.startsWith(
            'engine-stand-in: connect ECONNREFUSED',
          ),
          logged: lines.length,
        },
        {status: 502, reason: true, logged: 1},
      );
    } finally {
      await absent.close();
    }
  });

  it('#2511: an engine that resets the connection after its headers ends the client’s response', async () => {
    await closed(engine.server);
    engine = await fakeEngine((asked, response) => {
      response.writeHead(200);
      response.flushHeaders();
      setTimeout(() => response.socket?.resetAndDestroy(), 50);
    });
    const reset = await startStandIn(
      {host: '127.0.0.1', port: engine.port},
      {report: line => lines.push(line), longPathOf},
    );
    try {
      await rejects(through(reset.address, 'GET', '/events'));
    } finally {
      await reset.close();
    }
  });

  it('#2511: a client that leaves in the middle of a create sends nothing to the engine', async () => {
    const {port} = new URL(standIn.address);
    const client = connect(Number(port), '127.0.0.1');
    await new Promise<void>(resolve => client.once('connect', resolve));
    client.write(
      'POST /containers/create HTTP/1.1\r\nHost: engine\r\nContent-Length: 100\r\n\r\n{"Hos',
    );
    await new Promise(resolve => setTimeout(resolve, 50));
    client.destroy();
    await new Promise(resolve => setTimeout(resolve, 50));
    deepStrictEqual(engine.asked, []);
  });
});

describe('the engine stand-in’s upgraded streams (card #2511)', () => {
  /** A fake engine that upgrades every request, echoes what it gets, and says goodbye once the client half-closes. */
  async function echoEngine(): Promise<{
    server: Server;
    port: number;
    heads: string[];
  }> {
    const heads: string[] = [];
    const server = createServer();
    server.on(
      'upgrade',
      (incoming: IncomingMessage, socket: Socket, head: Buffer) => {
        heads.push(
          `${String(incoming.method)} ${String(incoming.url)} ${String(incoming.headers.upgrade)} ${head.toString('utf8')}`,
        );
        socket.write(
          'HTTP/1.1 101 UPGRADED\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n',
        );
        socket.on('data', (chunk: Buffer) => socket.write(chunk));
        socket.on('end', () => socket.end('bye'));
      },
    );
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    return {server, port: (server.address() as AddressInfo).port, heads};
  }

  /** Upgrades a request through `address` and gives the raw stream. */
  function upgraded(address: string, body: string): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const sent = request(
        new URL('/exec/abc/start', address.replace('tcp:', 'http:')),
        {
          method: 'POST',
          headers: {
            Connection: 'Upgrade',
            Upgrade: 'tcp',
            'Content-Length': String(body.length),
          },
        },
      );
      sent.on('upgrade', (answer, socket: Socket) => {
        resolve(socket);
      });
      sent.on('error', reject);
      sent.end(body);
    });
  }

  it('#2511: an upgraded exec stream passes both ways, its request body reaches the engine, and a half-close still gets the engine’s last words', async () => {
    const engine = await echoEngine();
    const standIn = await startStandIn(
      {host: '127.0.0.1', port: engine.port},
      {report: () => undefined, longPathOf},
    );
    try {
      const stream = await upgraded(standIn.address, '{"Detach":false}');
      stream.write('ping');
      const echoed = await new Promise<string>(resolve =>
        stream.once('data', (chunk: Buffer) => {
          resolve(chunk.toString('utf8'));
        }),
      );
      stream.end();
      const last = (await buffer(stream)).toString('utf8');
      deepStrictEqual(
        {heads: engine.heads, echoed, last},
        {
          heads: ['POST /exec/abc/start tcp {"Detach":false}'],
          echoed: 'ping',
          last: 'bye',
        },
      );
    } finally {
      await standIn.close();
      await closed(engine.server);
    }
  });

  it('#2511: an upgrade to an engine that is not there ends the client’s stream', async () => {
    const engine = await echoEngine();
    const port = engine.port;
    await closed(engine.server);
    const standIn = await startStandIn(
      {host: '127.0.0.1', port},
      {report: () => undefined, longPathOf},
    );
    try {
      await rejects(upgraded(standIn.address, ''));
    } finally {
      await standIn.close();
    }
  });

  it('#2511: a client that resets an upgraded stream closes the engine’s side, and closing the stand-in ends what is left', async () => {
    const engine = await echoEngine();
    const engineClosed: Array<Promise<void>> = [];
    engine.server.on('upgrade', (incoming, socket: Socket) => {
      engineClosed.push(
        new Promise(resolve =>
          socket.once('close', () => {
            resolve();
          }),
        ),
      );
    });
    const standIn = await startStandIn(
      {host: '127.0.0.1', port: engine.port},
      {report: () => undefined, longPathOf},
    );
    try {
      const reset = await upgraded(standIn.address, '');
      reset.resetAndDestroy();
      await engineClosed[0];
      const left = await upgraded(standIn.address, '');
      const ended = new Promise<void>(resolve =>
        left.once('close', () => {
          resolve();
        }),
      );
      await standIn.close();
      await ended;
      deepStrictEqual(engineClosed.length, 2);
    } finally {
      await closed(engine.server);
    }
  });
});

describe('the engine stand-in’s command line (card #2511)', () => {
  it('#2511: it writes its address to the file it is given and forwards to the engine it is given', async () => {
    const engine = await fakeEngine((asked, response) => response.end('OK'));
    const folder = mkdtempSync(path.join(tmpdir(), 'stand-in-'));
    const addressFile = path.join(folder, 'address');
    const child = spawn(
      process.execPath,
      [
        path.join(import.meta.dirname, 'engine-stand-in.ts'),
        '--engine',
        `tcp://127.0.0.1:${String(engine.port)}`,
        '--address-file',
        addressFile,
      ],
      {stdio: ['ignore', 'pipe', 'inherit']},
    );
    try {
      const said = new Promise<string>(resolve =>
        child.stdout.once('data', (chunk: Buffer) => {
          resolve(chunk.toString('utf8'));
        }),
      );
      const first = await said;
      const address = existsSync(addressFile)
        ? readFileSync(addressFile, 'utf8')
        : '';
      const answer = await through(address, 'GET', '/_ping');
      deepStrictEqual(
        {first, answer},
        {
          first: `engine-stand-in: ${address} in front of tcp://127.0.0.1:${String(engine.port)}\n`,
          answer: {status: 200, body: 'OK'},
        },
      );
    } finally {
      child.kill();
      rmSync(folder, {recursive: true});
      await closed(engine.server);
    }
  });

  it('#2511: started from its arguments here, it logs its rewrites and where it stands to the sink it is given', async () => {
    const engine = await fakeEngine((asked, response) => response.end('OK'));
    const folder = mkdtempSync(path.join(tmpdir(), 'stand-in-'));
    const addressFile = path.join(folder, 'address');
    const said: string[] = [];
    const standIn = await standInFromCommandLine(
      [
        '--engine',
        `tcp://127.0.0.1:${String(engine.port)}`,
        '--address-file',
        addressFile,
      ],
      line => said.push(line),
    );
    try {
      await through(
        standIn.address,
        'POST',
        '/containers/create',
        JSON.stringify({
          HostConfig: {Binds: ['/no-such-folder:/w', 'Z:\\no-such-folder:/z']},
        }),
      );
      deepStrictEqual(
        {
          address: readFileSync(addressFile, 'utf8'),
          said,
          sent: engine.asked[0]?.body,
        },
        {
          address: standIn.address,
          said: [
            `engine-stand-in: ${standIn.address} in front of tcp://127.0.0.1:${String(engine.port)}`,
            'engine-stand-in: POST /containers/create: HostConfig.Binds[1] Z:\\no-such-folder -> /mnt/z/no-such-folder',
          ],
          sent: JSON.stringify({
            HostConfig: {
              Binds: ['/no-such-folder:/w', '/mnt/z/no-such-folder:/z'],
            },
          }),
        },
      );
    } finally {
      await standIn.close();
      rmSync(folder, {recursive: true});
      await closed(engine.server);
    }
  });
});
