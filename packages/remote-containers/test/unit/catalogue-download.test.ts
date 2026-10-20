import {deepStrictEqual} from 'node:assert';
import {createServer, type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {downloadText} from '../../src/authoring/catalogue-download.ts';

const NEVER = new AbortController().signal;

/** A server whose paths answer: `/ok` text, `/moved` a redirect to `/ok`, `/loop` a redirect to itself, `/gone` 404. */
async function served(): Promise<{server: Server; base: string}> {
  const server = createServer((request, response) => {
    switch (request.url) {
      case '/ok':
        response.writeHead(200).end('{"collections":[]}');
        return;
      case '/moved':
        response.writeHead(302, {Location: '/ok'}).end();
        return;
      case '/loop':
        response.writeHead(302, {Location: '/loop'}).end();
        return;
      case '/hang':
        return;
      default:
        response.writeHead(404).end();
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const {port} = server.address() as AddressInfo;
  return {server, base: `http://127.0.0.1:${String(port)}`};
}

/** The message `downloadText` of `address` rejects with, or the text it gives. */
async function outcomeOf(
  address: string,
  cancellation: AbortSignal = NEVER,
): Promise<string> {
  return downloadText(address, cancellation).catch(
    (caught: unknown) =>
      `rejected: ${caught instanceof Error ? caught.message : String(caught)}`,
  );
}

describe('the download of the catalogue (card containers-77)', () => {
  let host: {server: Server; base: string};
  before(async () => {
    host = await served();
  });
  after(() => {
    host.server.closeAllConnections();
    host.server.close();
  });

  it('F-0802 BR-1: a 200 gives its body', async () => {
    deepStrictEqual(await outcomeOf(`${host.base}/ok`), '{"collections":[]}');
  });

  it('F-0802 BR-1: a redirect is followed', async () => {
    deepStrictEqual(
      await outcomeOf(`${host.base}/moved`),
      '{"collections":[]}',
    );
  });

  it('F-0802 7.E3: a redirect that never ends is given up on', async () => {
    deepStrictEqual(
      (await outcomeOf(`${host.base}/loop`)).startsWith(
        'rejected: too many redirects from',
      ),
      true,
    );
  });

  it('F-0802 7.E3: any other status is a failure naming the address and the status', async () => {
    deepStrictEqual(
      await outcomeOf(`${host.base}/gone`),
      `rejected: ${host.base}/gone answered 404`,
    );
  });

  it('F-0802 7.E3: a refused connection is a failure with its own message', async () => {
    const closed = await served();
    closed.server.close();
    deepStrictEqual(
      (await outcomeOf(`${closed.base}/ok`)).startsWith('rejected: '),
      true,
    );
  });

  it('F-0802 7.E3: an https address is dialled with https, and a refused connection is a failure', async () => {
    const closed = await served();
    closed.server.close();
    deepStrictEqual(
      (await outcomeOf(closed.base.replace('http:', 'https:'))).startsWith(
        'rejected: ',
      ),
      true,
    );
  });

  it('F-0801 7.E10: an abort ends a download that is waiting', async () => {
    const controller = new AbortController();
    const waiting = outcomeOf(`${host.base}/hang`, controller.signal);
    controller.abort();
    deepStrictEqual((await waiting).startsWith('rejected: '), true);
  });
});
