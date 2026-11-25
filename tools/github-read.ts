/**
 * @fileoverview github-read: a reader of one repository's routes in GitHub's API, with a token when there is one.
 */

import {setTimeout as delay} from 'node:timers/promises';

/** Reads `route` of the repository as JSON; a failed answer throws, naming `tool`, the status and the route. */
export type GitHubRead = (route: string) => Promise<Record<string, unknown>>;

/** How a reader asks again when GitHub answers with a server error. */
export interface ReadTries {
  /** How many tries a route gets in all. */
  tries: number;
  /** The wait before the second try; each later try waits that much longer than the one before. */
  pauseMilliseconds: number;
}

/** The reader of `repository`'s routes, sending `token` when it is set, for the tool named `tool`. */
export function gitHubReader(
  tool: string,
  repository: string,
  token: string | undefined,
  fetchUrl: typeof fetch,
  retry: ReadTries = {tries: 1, pauseMilliseconds: 0},
): GitHubRead {
  return async route => {
    for (let attempt = 1; ; attempt += 1) {
      const response = await fetchUrl(
        `https://api.github.com/repos/${repository}/${route}`,
        {
          headers: {
            Accept: 'application/vnd.github+json',
            ...(token === undefined || token === ''
              ? {}
              : {Authorization: `Bearer ${token}`}),
          },
        },
      );
      if (response.ok) {
        return (await response.json()) as Record<string, unknown>;
      }
      if (response.status < 500 || attempt >= retry.tries) {
        throw new Error(
          `${tool}: GitHub answered ${String(response.status)} for ${route}${attempt > 1 ? ` (${String(attempt)} tries)` : ''}`,
        );
      }
      await delay(attempt * retry.pauseMilliseconds);
    }
  };
}
