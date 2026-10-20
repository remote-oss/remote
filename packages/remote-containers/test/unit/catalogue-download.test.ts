import {deepStrictEqual} from 'node:assert';
import {
  downloadTextOver,
  type HttpGet,
} from '../../src/authoring/catalogue-download.ts';

const NEVER = new AbortController().signal;

/** The message `downloadTextOver(httpGet)` of `address` rejects with, or the text it gives. */
async function outcomeOf(
  httpGet: HttpGet,
  cancellation: AbortSignal = NEVER,
): Promise<string> {
  return downloadTextOver(httpGet)(
    'https://example.org/index.json',
    cancellation,
  ).catch(
    (caught: unknown) =>
      `rejected: ${caught instanceof Error ? caught.message : String(caught)}`,
  );
}

describe('the download of the catalogue (card containers-77)', () => {
  it('F-0802 BR-1: an answer 200 gives its body', async () => {
    deepStrictEqual(
      await outcomeOf(() =>
        Promise.resolve({
          status: 200,
          text: () => Promise.resolve('{"collections":[]}'),
        }),
      ),
      '{"collections":[]}',
    );
  });

  it('F-0802 7.E3: any other answer is a failure naming the address and the status', async () => {
    deepStrictEqual(
      await outcomeOf(() =>
        Promise.resolve({
          status: 404,
          text: () => Promise.resolve(''),
        }),
      ),
      'rejected: https://example.org/index.json answered 404',
    );
  });

  it('F-0802 7.E3: a client that fails gives its own message', async () => {
    deepStrictEqual(
      await outcomeOf(() => Promise.reject(new Error('fetch failed'))),
      'rejected: fetch failed',
    );
  });

  it('F-0801 7.E10: the signal and the address reach the client', async () => {
    const controller = new AbortController();
    const seen: unknown[] = [];
    await outcomeOf((address, init) => {
      seen.push(address, init.signal === controller.signal);
      return Promise.reject(new Error('stop'));
    }, controller.signal);
    deepStrictEqual(seen, ['https://example.org/index.json', true]);
  });
});
