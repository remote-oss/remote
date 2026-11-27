import {deepStrictEqual, match} from 'node:assert';
import {
  existsSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {createServer as createHttpServer} from 'node:http';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {HttpGet} from 'lib-server';
import {
  clientSearchOf,
  drawLinkNumber,
  freeLoopbackPort,
  type MachinePlaces,
  newTemporaryToken,
  nodeMachineOf,
  serverStatusOver,
} from '../../src/node-machine.ts';
import {PROFILE} from './server-steps.fixture.ts';

const PLACES: MachinePlaces = {
  extensionFolder: '/extensions/remote-oss.remote-ssh',
  storageFolder: '/storage/remote-oss.remote-ssh',
  runtime: '/editor/code',
  profile: PROFILE,
  httpGet: () => Promise.reject(new Error('no request in a unit test')),
};

const FACTS = {
  platform: 'linux',
  environment: {PATH: '/usr/bin', XDG_RUNTIME_DIR: '/run/user/1000'},
  homeFolder: '/home/alex',
  temporaryFolder: '/tmp',
  workingDirectory: '/work',
};

/** Whether a listener can bind `port` on the loopback. */
function bindable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = createServer();
    server.once('error', () => {
      resolve(false);
    });
    server.listen(port, '127.0.0.1', () => {
      server.close(() => {
        resolve(true);
      });
    });
  });
}

/** The editor's `fetch` as the machine's `httpGet`: here, Node's own. */
function editorFetch(...request: Parameters<HttpGet>): ReturnType<HttpGet> {
  return fetch(...request);
}

describe('the status a server on this machine answers (card #2995, ruling-2995-shared-reuse)', () => {
  /** A loopback HTTP server that answers every request with `status`, recording the paths it was asked for. */
  async function answering(status: number) {
    const paths: string[] = [];
    const server = createHttpServer((request, reply) => {
      paths.push(request.url ?? '');
      reply.writeHead(status);
      reply.end();
    });
    await new Promise<void>(resolve => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const {port} = server.address() as {port: number};
    return {server, port, paths};
  }

  it("F-2407 6.4 step 2: the request carries the token in its query, and the status is the server's", async () => {
    const statuses: Array<number | undefined> = [];
    const asked: string[] = [];
    for (const status of [404, 403]) {
      const {server, port, paths} = await answering(status);
      try {
        statuses.push(
          await serverStatusOver(editorFetch)(
            {host: '127.0.0.1', port},
            'a b/c',
            new AbortController().signal,
          ),
        );
        asked.push(...paths);
      } finally {
        server.close();
      }
    }
    deepStrictEqual(
      [statuses, asked],
      [
        [404, 403],
        ['/?tkn=a%20b%2Fc', '/?tkn=a%20b%2Fc'],
      ],
    );
  });

  it('F-2407 6.4 step 3: nothing listening is no status', async () => {
    const {server, port} = await answering(200);
    server.close();
    await new Promise(resolve => setImmediate(resolve));
    deepStrictEqual(
      await serverStatusOver(editorFetch)(
        {host: '127.0.0.1', port},
        'token',
        new AbortController().signal,
      ),
      undefined,
    );
  });

  /** A loopback port that takes connections and never answers. */
  async function silent() {
    const sockets = createServer(() => undefined);
    await new Promise<void>(resolve => {
      sockets.listen(0, '127.0.0.1', resolve);
    });
    const {port} = sockets.address() as {port: number};
    return {sockets, port};
  }

  it('F-2407 6.4 step 3, ruling-2995-shared-reuse: a server that does not answer within the bound is no status', async () => {
    const {sockets, port} = await silent();
    try {
      deepStrictEqual(
        await serverStatusOver(editorFetch, 50)(
          {host: '127.0.0.1', port},
          'token',
          new AbortController().signal,
        ),
        undefined,
      );
    } finally {
      sockets.close();
    }
  });

  it('F-2407 6.4 step 3: a check the connect cancels is no status', async () => {
    const {sockets, port} = await silent();
    const cancellation = new AbortController();
    try {
      const pending = serverStatusOver(editorFetch)(
        {host: '127.0.0.1', port},
        'token',
        cancellation.signal,
      );
      cancellation.abort();
      deepStrictEqual(await pending, undefined);
    } finally {
      sockets.close();
    }
  });
});

describe('the machine a connect runs on', () => {
  it('F-2101: the client search reads PATH and ProgramFiles', () => {
    deepStrictEqual(
      clientSearchOf({PATH: '/usr/bin', ProgramFiles: 'C:\\Program Files'}),
      {searchPath: '/usr/bin', programFilesFolder: 'C:\\Program Files'},
    );
  });

  it("F-2101: Windows' Path is read when PATH is absent", () => {
    deepStrictEqual(
      clientSearchOf({Path: 'C:\\Windows'}).searchPath,
      'C:\\Windows',
    );
  });

  it('F-2101: no search path is the empty one', () => {
    deepStrictEqual(clientSearchOf({}), {
      searchPath: '',
      programFilesFolder: '',
    });
  });

  it("contracts §S9: the helper's SOCKS port is free on the loopback once released", async () => {
    deepStrictEqual(await bindable(await freeLoopbackPort()), true);
  });

  it('F-2311 R2: an agent link number is an integer in 1..999999999', () => {
    const draws = Array.from({length: 200}, () => drawLinkNumber());
    deepStrictEqual(
      draws.every(
        draw => Number.isInteger(draw) && draw >= 1 && draw <= 999_999_999,
      ),
      true,
    );
  });

  it("F-2311 R2: the machine's draw is the link number's", () => {
    deepStrictEqual(
      nodeMachineOf(PLACES, FACTS).drawLinkNumber,
      drawLinkNumber,
    );
  });

  it('contracts: two temporary tokens differ', () => {
    deepStrictEqual(newTemporaryToken() === newTemporaryToken(), false);
  });

  it('contracts: a temporary token names this process', () => {
    match(
      newTemporaryToken(),
      new RegExp(`^${String(process.pid)}-[0-9a-f]{12}$`),
    );
  });

  it("ruled on #253 Q8: the helper and askpass are the extension's bundles, run by the editor", () => {
    deepStrictEqual(nodeMachineOf(PLACES, FACTS).bundles, {
      helperScript:
        '/extensions/remote-oss.remote-ssh/dist/connection-helper.js',
      askpassProgram: '/extensions/remote-oss.remote-ssh/dist/askpass.js',
      runtime: '/editor/code',
    });
  });

  it("contracts §9: the registry is in the profile's storage, the endpoints in the user's runtime folder", () => {
    deepStrictEqual(nodeMachineOf(PLACES, FACTS).folders, {
      registry: '/storage/remote-oss.remote-ssh/registry',
      runtime: '/run/user/1000',
      clientTemporary: '/tmp',
    });
  });

  it('ruled on #253 Q10: the helper client waits 2 s for a hello, 10 s for a start, 100 ms between tries', () => {
    const {helpers} = nodeMachineOf(PLACES, FACTS);
    deepStrictEqual(
      [
        helpers.helloLimitMilliseconds,
        helpers.startLimitMilliseconds,
        helpers.retryMilliseconds,
        helpers.runtime,
      ],
      [2000, 10000, 100, '/editor/code'],
    );
  });

  it('connect-14: the platform, home and client search come from the facts', () => {
    const machine = nodeMachineOf(PLACES, {...FACTS, platform: 'darwin'});
    deepStrictEqual(
      [machine.platform, machine.homeFolder, machine.clientSearch.searchPath],
      ['macOS', '/home/alex', '/usr/bin'],
    );
  });

  it("F-2408 BR-8 (card #2844): the extension's end removes the file of a client lock still held", () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'node-machine-'));
    try {
      const lockFile = path.join(folder, 'held.lock');
      writeFileSync(lockFile, '');
      const {clientLocks} = nodeMachineOf(PLACES, FACTS);
      clientLocks.hold(lockFile, statSync(lockFile).mtimeMs);
      clientLocks.releaseAll();
      deepStrictEqual(existsSync(lockFile), false);
    } finally {
      rmSync(folder, {recursive: true, force: true});
    }
  });

  it('connect-14: the scheduler and the clock wait on real time', async () => {
    const machine = nodeMachineOf(PLACES, FACTS);
    const fired = await new Promise<boolean>(resolve => {
      machine.scheduler.setTimer(1, () => {
        resolve(true);
      });
    });
    await machine.clock.wait(1);
    deepStrictEqual([fired, machine.clock.now() > 0], [true, true]);
  });
});
