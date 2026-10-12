import {deepStrictEqual} from 'node:assert';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {createServer, type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {downloadPortOf, type DownloadRequest} from '../../src/index.ts';

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
    allowedHosts: ['127.0.0.1'],
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
          {kind: 'failed', detail: 'HTTP 404'},
        );
      },
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
