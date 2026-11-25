/**
 * @fileoverview github-read: a reader of one repository's routes in GitHub's API, with a token when there is one.
 */

/** Reads `route` of the repository as JSON; a failed answer throws, naming `tool`, the status and the route. */
export type GitHubRead = (route: string) => Promise<Record<string, unknown>>;

/** How a reader asks again: how many tries a route gets in all when GitHub answers with a server error, and the wait. */
export interface ReadTries {
  tries: number;
  /** Waits before try `next` (2, 3, …). */
  pause: (next: number) => Promise<void>;
}

/** One try, no wait: an answer that is not 200 fails at once. */
const ONE_TRY: ReadTries = {tries: 1, pause: () => Promise.resolve()};

/** The reader of `repository`'s routes, sending `token` when it is set, for the tool named `tool`. */
export function gitHubReader(
  tool: string,
  repository: string,
  token: string | undefined,
  fetchUrl: typeof fetch,
  retry: ReadTries = ONE_TRY,
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
      await retry.pause(attempt + 1);
    }
  };
}
