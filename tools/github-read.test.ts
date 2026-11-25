/**
 * @fileoverview github-read: a server error is asked again as many tries as the reader is given, and any other failed
 * answer fails at once.
 */

import {deepStrictEqual} from 'node:assert';
import {gitHubReader} from './github-read.ts';

/** A fetch that answers `statuses` in turn, the last one for good, and counts its requests. */
function answering(...statuses: number[]): {
  fetchUrl: typeof fetch;
  requests: () => number;
} {
  let count = 0;
  const fetchUrl = (() => {
    const status = statuses[Math.min(count, statuses.length - 1)] ?? 200;
    count += 1;
    return Promise.resolve(
      new Response(status === 200 ? '{"found":true}' : '{}', {status}),
    );
  }) as typeof fetch;
  return {fetchUrl, requests: () => count};
}

/** Reads `route` and gives its answer or its error's message. */
async function outcomeOf(
  read: (route: string) => Promise<Record<string, unknown>>,
  route: string,
): Promise<unknown> {
  return read(route).catch((error: unknown) =>
    error instanceof Error ? error.message : String(error),
  );
}

describe('github-read: one repository’s routes in GitHub’s API (#3149)', () => {
  it('#3149: a server error is asked again after a pause, up to the tries given, and the last one names how many', async () => {
    const pauses: number[] = [];
    const retry = {
      tries: 3,
      pause: (next: number) => {
        pauses.push(next);
        return Promise.resolve();
      },
    };
    const recovers = answering(502, 503, 200);
    const fails = answering(502);
    deepStrictEqual(
      [
        await outcomeOf(
          gitHubReader('tool', 'owner/repo', 't', recovers.fetchUrl, retry),
          'runs/1',
        ),
        recovers.requests(),
        await outcomeOf(
          gitHubReader('tool', 'owner/repo', 't', fails.fetchUrl, retry),
          'runs/2',
        ),
        fails.requests(),
        pauses,
      ],
      [
        {found: true},
        3,
        'tool: GitHub answered 502 for runs/2 (3 tries)',
        3,
        [2, 3, 2, 3],
      ],
    );
  });

  it('#3149: an answer below 500 fails at once, and a reader given no tries asks once', async () => {
    const missing = answering(404);
    const once = answering(502);
    deepStrictEqual(
      [
        await outcomeOf(
          gitHubReader('tool', 'owner/repo', undefined, missing.fetchUrl, {
            tries: 3,
            pause: () => Promise.resolve(),
          }),
          'issues/7',
        ),
        missing.requests(),
        await outcomeOf(
          gitHubReader('tool', 'owner/repo', undefined, once.fetchUrl),
          'runs/3',
        ),
        once.requests(),
      ],
      [
        'tool: GitHub answered 404 for issues/7',
        1,
        'tool: GitHub answered 502 for runs/3',
        1,
      ],
    );
  });
});
