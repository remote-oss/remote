/**
 * @fileoverview check-known-reds: every entry of tools/known-reds.json still names an open issue, and its evidence is a
 * run of main.
 *
 *   node tools/check-known-reds.ts    print each entry whose issue is closed or whose evidence run is not main's,
 *                                     and exit 1 when there is one
 *
 * An entry leaves the list when its issue closes, so a fixed red can no longer pass a pull request's gate; and an
 * entry's evidence is a red on main, never the pull request that adds it. The repository's issues and runs are read
 * through GitHub's API, with GH_TOKEN when the environment holds one.
 */

import {isMainModule, REPOSITORY_ROOT} from './repository.ts';
import {type KnownRed, readKnownReds} from './known-reds.ts';

/** What the check asks GitHub: an issue's state, and the branch a run ran on. */
export interface Lookups {
  issueState(issue: number): Promise<string>;
  runBranch(runId: number): Promise<string>;
}

/** What is wrong with `entries`: each issue that is not open, and each evidence run that is not main's. */
export async function expiryProblems(
  entries: readonly KnownRed[],
  lookups: Lookups,
): Promise<string[]> {
  const problems: string[] = [];
  const states = new Map<number, string>();
  const branches = new Map<number, string>();
  for (const entry of entries) {
    if (!states.has(entry.card)) {
      states.set(entry.card, await lookups.issueState(entry.card));
    }
    if (!branches.has(entry.evidence)) {
      branches.set(entry.evidence, await lookups.runBranch(entry.evidence));
    }
    const state = states.get(entry.card);
    if (state !== 'open') {
      problems.push(
        `#${String(entry.card)} is ${String(state)}: remove its entry for ${entry.launch}: ${entry.file}: ${entry.title}`,
      );
    }
    const branch = branches.get(entry.evidence);
    if (branch !== 'main') {
      problems.push(
        `run ${String(entry.evidence)} ran on ${String(branch)}, not main: the evidence of ${entry.launch}: ${entry.file}: ${entry.title}`,
      );
    }
  }
  return problems;
}

/** The lookups of repository `repository` through GitHub's API, with `token` when there is one. */
export function gitHubLookups(
  repository: string,
  token: string | undefined,
  fetchUrl: typeof fetch = fetch,
): Lookups {
  async function read(route: string): Promise<Record<string, unknown>> {
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
        `check-known-reds: GitHub answered ${String(response.status)} for ${route}`,
      );
    }
    return (await response.json()) as Record<string, unknown>;
  }
  return {
    async issueState(issue) {
      return String((await read(`issues/${String(issue)}`)).state);
    },
    async runBranch(runId) {
      return String((await read(`actions/runs/${String(runId)}`)).head_branch);
    },
  };
}

if (isMainModule(import.meta.url)) {
  const problems = await expiryProblems(
    readKnownReds(REPOSITORY_ROOT),
    gitHubLookups(
      process.env.GITHUB_REPOSITORY ?? 'remote-oss/remote',
      process.env.GH_TOKEN,
    ),
  );
  for (const problem of problems) {
    console.error(`check-known-reds: ${problem}`);
  }
  process.exitCode = problems.length === 0 ? 0 : 1;
}
