import {deepStrictEqual} from 'node:assert';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {createServer, type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  downloadPortOf,
  type DownloadRequest,
  type DownloadResult,
  type HttpGet,
} from '../../src/index.ts';

const fetchDownloadPort = downloadPortOf(fetch);

/** A server on this machine that answers by the path of the request. */
async function serving(
  handler: Parameters<typeof createServer>[1],
  body: (address: string, folder: string) => Promise<void>,
): Promise<void> {
  const server: Server = createServer(handler);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const folder = mkdtempSync(path.join(tmpdir(), 'node-download-'));
  try {
    await body(
      `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`,
      folder,
    );
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    rmSync(folder, {recursive: true, force: true});
  }
}

function requestFor(
  address: string,
  folder: string,
  parts: Partial<DownloadRequest> = {},
): DownloadRequest {
  return {
    address,
    destination: path.join(folder, 'part', 'archive'),
    cancellation: new AbortController().signal,
    redirect: {kind: 'hosts', hosts: ['127.0.0.1']},
    authorizationFor: () => undefined,
    onPercent: () => undefined,
    deadlineMilliseconds: 10_000,
    stallMilliseconds: 5_000,
    maximumBytes: 1_000_000,
    ...parts,
  };
}

describe('the download of a server archive over fetch (V4)', () => {
  it('V4: the body is written to the destination and the final address is reported', async () => {
    await serving(
      (ignored, response) => {
        response.writeHead(200, {'content-length': '5'});
        response.end('hello');
      },
      async (address, folder) => {
        const request = requestFor(`${address}/server.tar.gz`, folder);
        const outcome = await fetchDownloadPort.download(request);
        deepStrictEqual(
          [outcome, readFileSync(request.destination, 'utf8')],
          [
            {
              kind: 'downloaded',
              facts: {announcedLength: 5},
              finalAddress: `${address}/server.tar.gz`,
            },
            'hello',
          ],
        );
      },
    );
  });

  it('V4: a body with no announced length reports no length', async () => {
    await serving(
      (ignored, response) => {
        response.writeHead(200, {'transfer-encoding': 'chunked'});
        response.end('chunk');
      },
      async (address, folder) => {
        const outcome = await fetchDownloadPort.download(
          requestFor(address, folder),
        );
        deepStrictEqual(
          outcome.kind === 'downloaded' ? outcome.facts : outcome,
          {},
        );
      },
    );
  });

  it('V4: the share downloaded is reported while the body arrives', async () => {
    const percents: number[] = [];
    await serving(
      (ignored, response) => {
        response.writeHead(200, {'content-length': '4'});
        response.end('abcd');
      },
      async (address, folder) => {
        await fetchDownloadPort.download(
          requestFor(address, folder, {
            onPercent: percent => percents.push(percent),
          }),
        );
        deepStrictEqual(percents.at(-1), 100);
      },
    );
  });

  it('V4: a redirect through an allowed host is followed', async () => {
    await serving(
      (request, response) => {
        if (request.url === '/start') {
          response.writeHead(302, {location: '/final'});
          response.end();
        } else {
          response.writeHead(200, {'content-length': '2'});
          response.end('ok');
        }
      },
      async (address, folder) => {
        const outcome = await fetchDownloadPort.download(
          requestFor(`${address}/start`, folder),
        );
        deepStrictEqual(
          outcome.kind === 'downloaded' ? outcome.finalAddress : outcome,
          `${address}/final`,
        );
      },
    );
  });

  it('V4: a redirect to a host that is not allowed is refused with its name', async () => {
    await serving(
      (ignored, response) => {
        response.writeHead(302, {location: 'http://localhost:1/other'});
        response.end();
      },
      async (address, folder) => {
        deepStrictEqual(
          await fetchDownloadPort.download(requestFor(address, folder)),
          {kind: 'failed', detail: 'redirected to localhost'},
        );
      },
    );
  });

  /** The port over a function that answers each address by the table: a redirect target, or the body `ok`. */
  function portAnswering(redirects: Record<string, string>) {
    const requested: string[] = [];
    const port = downloadPortOf(address => {
      requested.push(address);
      const location = redirects[address];
      return Promise.resolve(
        location === undefined
          ? new Response('ok', {status: 200, headers: {'content-length': '2'}})
          : new Response(null, {status: 302, headers: {location}}),
      );
    });
    return {port, requested};
  }

  it('server-22: the rule any follows a redirect to a foreign https host', async () => {
    const {port, requested} = portAnswering({
      'https://source.example.invalid/a': 'https://cdn.foreign.invalid/b',
    });
    await serving(
      () => undefined,
      async (ignored, folder) => {
        const outcome = await port.download(
          requestFor('https://source.example.invalid/a', folder, {
            redirect: {kind: 'any'},
          }),
        );
        deepStrictEqual(
          [outcome.kind, requested],
          [
            'downloaded',
            [
              'https://source.example.invalid/a',
              'https://cdn.foreign.invalid/b',
            ],
          ],
        );
      },
    );
  });

  it('server-22: a hop from https to http is refused with its host, also under any', async () => {
    const {port} = portAnswering({
      'https://source.example.invalid/a': 'http://cdn.foreign.invalid/b',
    });
    await serving(
      () => undefined,
      async (ignored, folder) => {
        deepStrictEqual(
          await port.download(
            requestFor('https://source.example.invalid/a', folder, {
              redirect: {kind: 'any'},
            }),
          ),
          {
            kind: 'failed',
            detail: 'redirected to cdn.foreign.invalid over http',
          },
        );
      },
    );
  });

  /** The outcome kind and the last address asked, for a download from an http source that redirects to `target`. */
  async function fromHttpSource(
    target: string,
  ): Promise<[string, string | undefined]> {
    const {port, requested} = portAnswering({
      'http://source.example.invalid/a': target,
    });
    let result: [string, string | undefined] = ['', undefined];
    await serving(
      () => undefined,
      async (ignored, folder) => {
        const outcome = await port.download(
          requestFor('http://source.example.invalid/a', folder, {
            redirect: {
              kind: 'hosts',
              hosts: ['source.example.invalid', 'cdn.example.invalid'],
            },
          }),
        );
        result = [outcome.kind, requested.at(-1)];
      },
    );
    return result;
  }

  it('server-22: an http source that redirects to another http host in the list is followed', async () => {
    deepStrictEqual(await fromHttpSource('http://cdn.example.invalid/b'), [
      'downloaded',
      'http://cdn.example.invalid/b',
    ]);
  });

  it('server-22: an http source that redirects to an https host the rule allows is followed', async () => {
    deepStrictEqual(await fromHttpSource('https://cdn.example.invalid/b'), [
      'downloaded',
      'https://cdn.example.invalid/b',
    ]);
  });

  it('V4: more than ten redirects fail', async () => {
    await serving(
      (ignored, response) => {
        response.writeHead(302, {location: '/again'});
        response.end();
      },
      async (address, folder) => {
        deepStrictEqual(
          await fetchDownloadPort.download(requestFor(address, folder)),
          {kind: 'failed', detail: 'too many redirects'},
        );
      },
    );
  });

  it('V4: an answer that is not a success fails with its status', async () => {
    await serving(
      (ignored, response) => {
        response.writeHead(404);
        response.end();
      },
      async (address, folder) => {
        deepStrictEqual(
          await fetchDownloadPort.download(requestFor(address, folder)),
          {
            kind: 'failed',
            detail: 'HTTP 404',
            cause: 'httpStatus',
            status: 404,
          },
        );
      },
    );
  });

  it("F-2405.7.E5: a destination the client can't write fails with the cause clientFile and the file system's text", async () => {
    await serving(
      (ignored, response) => {
        response.end('archive');
      },
      async (address, folder) => {
        const blocker = path.join(folder, 'blocker');
        writeFileSync(blocker, '');
        const result = await fetchDownloadPort.download(
          requestFor(address, folder, {
            destination: path.join(blocker, 'part', 'archive'),
          }),
        );
        deepStrictEqual(
          result.kind === 'failed'
            ? [result.cause, result.detail.includes(blocker)]
            : result.kind,
          ['clientFile', true],
        );
      },
    );
  });

  it('F-2405.7.E3: a request that fails on the network has no cause of its own', async () => {
    const result = await fetchDownloadPort.download(
      requestFor(
        'http://127.0.0.1:1/archive',
        mkdtempSync(path.join(tmpdir(), 'download-')),
      ),
    );
    deepStrictEqual(
      result.kind === 'failed' ? result.cause : result.kind,
      undefined,
    );
  });

  it('V4: a body longer than the bound fails as too large', async () => {
    await serving(
      (ignored, response) => {
        response.writeHead(200, {'transfer-encoding': 'chunked'});
        response.end('x'.repeat(100));
      },
      async (address, folder) => {
        deepStrictEqual(
          await fetchDownloadPort.download(
            requestFor(address, folder, {maximumBytes: 10}),
          ),
          {kind: 'failed', detail: 'tooLarge', cause: 'tooLarge'},
        );
      },
    );
  });

  it('V4: a body that stops arriving fails as stalled', async () => {
    await serving(
      (ignored, response) => {
        response.writeHead(200, {'transfer-encoding': 'chunked'});
        response.write('start');
      },
      async (address, folder) => {
        deepStrictEqual(
          await fetchDownloadPort.download(
            requestFor(address, folder, {stallMilliseconds: 50}),
          ),
          {kind: 'failed', detail: 'stalled', cause: 'stalled'},
        );
      },
    );
  });

  it('V4: a cancellation ends the download as cancelled', async () => {
    await serving(
      (ignored, response) => {
        response.writeHead(200, {'transfer-encoding': 'chunked'});
        response.write('start');
      },
      async (address, folder) => {
        const controller = new AbortController();
        const pending = fetchDownloadPort.download(
          requestFor(address, folder, {cancellation: controller.signal}),
        );
        setTimeout(() => {
          controller.abort();
        }, 30);
        deepStrictEqual(await pending, {kind: 'cancelled'});
      },
    );
  });

  it('V4: a response with no address of its own reports the address asked for', async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'node-download-'));
    try {
      const request = requestFor('http://127.0.0.1:1/asked', folder);
      const outcome = await downloadPortOf(() =>
        Promise.resolve(new Response('body')),
      ).download(request);
      deepStrictEqual(
        outcome.kind === 'downloaded' ? outcome.finalAddress : outcome,
        'http://127.0.0.1:1/asked',
      );
    } finally {
      rmSync(folder, {recursive: true, force: true});
    }
  });

  it('V4: after a redirect, a response with no address of its own reports the last address, not the first', async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'node-download-'));
    try {
      const outcome = await downloadPortOf(address =>
        Promise.resolve(
          address.endsWith('/first')
            ? new Response(null, {status: 302, headers: {location: '/last'}})
            : new Response('body'),
        ),
      ).download(requestFor('http://127.0.0.1:1/first', folder));
      deepStrictEqual(
        outcome.kind === 'downloaded' ? outcome.finalAddress : outcome,
        'http://127.0.0.1:1/last',
      );
    } finally {
      rmSync(folder, {recursive: true, force: true});
    }
  });

  for (const header of ['abc', '12abc', '-5', '1.5', '']) {
    it(`V4: a content-length of ${JSON.stringify(header)} announces nothing, so the bound still applies`, async () => {
      const folder = mkdtempSync(path.join(tmpdir(), 'node-download-'));
      try {
        const outcome = await downloadPortOf(() =>
          Promise.resolve(
            new Response('x'.repeat(5000), {
              headers: {'content-length': header},
            }),
          ),
        ).download(
          requestFor('http://127.0.0.1:1/asked', folder, {maximumBytes: 1000}),
        );
        deepStrictEqual(
          outcome.kind === 'failed' ? outcome.cause : outcome,
          'tooLarge',
        );
      } finally {
        rmSync(folder, {recursive: true, force: true});
      }
    });
  }

  it('V4: a content-length that is a plain number is announced and bounds the body', async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'node-download-'));
    try {
      const outcome = await downloadPortOf(() =>
        Promise.resolve(
          new Response('hello', {headers: {'content-length': '5'}}),
        ),
      ).download(requestFor('http://127.0.0.1:1/asked', folder));
      deepStrictEqual(outcome.kind === 'downloaded' ? outcome.facts : outcome, {
        announcedLength: 5,
      });
    } finally {
      rmSync(folder, {recursive: true, force: true});
    }
  });

  it('V4: an HTTP function that rejects with something that is not an error fails with its text', async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'node-download-'));
    try {
      const outcome = await downloadPortOf(() =>
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a function that breaks its contract, on purpose
        Promise.reject('offline'),
      ).download(requestFor('http://127.0.0.1:1/asked', folder));
      deepStrictEqual(outcome, {kind: 'failed', detail: 'offline'});
    } finally {
      rmSync(folder, {recursive: true, force: true});
    }
  });

  it('V4: an address nothing answers at fails with the text of the failure', async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'node-download-'));
    try {
      const outcome = await fetchDownloadPort.download(
        requestFor('http://127.0.0.1:1/none', folder),
      );
      deepStrictEqual(outcome.kind, 'failed');
    } finally {
      rmSync(folder, {recursive: true, force: true});
    }
  });
});

/** A redirect answer to `location`. */
function redirectTo(location: string): Response {
  return new Response(null, {status: 302, headers: {location}});
}

/** The authorization the rows give: Basic for the hosts of `ownHosts`, one value per host. */
function authorizationOfHosts(
  ownHosts: readonly string[],
): DownloadRequest['authorizationFor'] {
  return address => {
    const {hostname} = new URL(address);
    return ownHosts.includes(hostname) ? `Basic for-${hostname}` : undefined;
  };
}

const SOURCE = 'https://source.example.invalid/a';
const FOREIGN = 'https://cdn.foreign.invalid/b';

/**
 * Downloads `SOURCE` over a fake HTTP function that answers each address with `answers`, and gives the outcome and
 * what the function was asked, as the address and the headers (`none` when the request carried no `headers` key).
 */
async function downloadAsked(
  answers: Record<string, Response>,
  parts: Partial<DownloadRequest> = {},
): Promise<{
  outcome: DownloadResult;
  asked: Array<{address: string; headers: unknown}>;
}> {
  const asked: Array<{address: string; headers: unknown}> = [];
  function httpGet(
    address: string,
    init: Parameters<HttpGet>[1],
  ): Promise<Response> {
    asked.push({address, headers: 'headers' in init ? init.headers : 'none'});
    const answer = answers[address];
    return answer === undefined
      ? Promise.reject(new Error(`no answer for ${address}`))
      : Promise.resolve(answer);
  }
  const folder = mkdtempSync(path.join(tmpdir(), 'node-download-'));
  try {
    const outcome = await downloadPortOf(httpGet).download(
      requestFor(SOURCE, folder, {redirect: {kind: 'any'}, ...parts}),
    );
    return {outcome, asked};
  } finally {
    rmSync(folder, {recursive: true, force: true});
  }
}

describe('the download with credentials (card server-23)', () => {
  it('server-23: the header is built for every hop from that hop’s own host, and a hop with no entry carries none', async () => {
    const {asked} = await downloadAsked(
      {[SOURCE]: redirectTo(FOREIGN), [FOREIGN]: new Response('hello')},
      {authorizationFor: authorizationOfHosts(['source.example.invalid'])},
    );
    deepStrictEqual(asked, [
      {
        address: SOURCE,
        headers: {Authorization: 'Basic for-source.example.invalid'},
      },
      {address: FOREIGN, headers: 'none'},
    ]);
  });

  it('server-23: a redirect to a host with its own entry carries that host’s header, not the first one’s', async () => {
    const {asked} = await downloadAsked(
      {[SOURCE]: redirectTo(FOREIGN), [FOREIGN]: new Response('hello')},
      {
        authorizationFor: authorizationOfHosts([
          'source.example.invalid',
          'cdn.foreign.invalid',
        ]),
      },
    );
    deepStrictEqual(
      asked.map(each => each.headers),
      [
        {Authorization: 'Basic for-source.example.invalid'},
        {Authorization: 'Basic for-cdn.foreign.invalid'},
      ],
    );
  });

  it('server-23: a request whose address gets no authorization has no headers key', async () => {
    const {asked} = await downloadAsked({[SOURCE]: new Response('hello')});
    deepStrictEqual(asked, [{address: SOURCE, headers: 'none'}]);
  });

  for (const status of [401, 403]) {
    it(`server-23: a final ${String(status)} fails at once as unauthorized, with the status and the host, after one request per hop`, async () => {
      const {outcome, asked} = await downloadAsked({
        [SOURCE]: redirectTo(FOREIGN),
        [FOREIGN]: new Response(null, {status}),
      });
      deepStrictEqual(
        [outcome, asked.length],
        [
          {
            kind: 'failed',
            detail: `Server returned ${String(status)}: the source at cdn.foreign.invalid asks for credentials. Add a "machine cdn.foreign.invalid" entry with a login and a password to your netrc file, or put the token in the address template of the server download setting (?token=...)`,
            cause: 'unauthorized',
            status,
          },
          2,
        ],
      );
    });
  }

  it('server-23: a 404 stays an httpStatus failure', async () => {
    const {outcome} = await downloadAsked({
      [SOURCE]: new Response(null, {status: 404}),
    });
    deepStrictEqual(outcome, {
      kind: 'failed',
      detail: 'HTTP 404',
      cause: 'httpStatus',
      status: 404,
    });
  });
});
