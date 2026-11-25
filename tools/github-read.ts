/**
 * @fileoverview github-read: a reader of one repository's routes in GitHub's API, with a token when there is one.
 */

/** Reads `route` of the repository as JSON; a failed answer throws, naming `tool`, the status and the route. */
export type GitHubRead = (route: string) => Promise<Record<string, unknown>>;

/** The reader of `repository`'s routes, sending `token` when it is set, for the tool named `tool`. */
export function gitHubReader(
  tool: string,
  repository: string,
  token: string | undefined,
  fetchUrl: typeof fetch,
): GitHubRead {
  return async route => {
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
    if (!response.ok) {
      throw new Error(
        `${tool}: GitHub answered ${String(response.status)} for ${route}`,
      );
    }
    return (await response.json()) as Record<string, unknown>;
  };
}
