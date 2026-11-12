/**
 * @fileoverview check-known-reds: every entry of tools/known-reds.json still names an open issue, and its evidence is a
 * run of main.
 *
 *   node tools/check-known-reds.ts    print each entry whose issue is closed or a pull request, or whose evidence is not
 *                                     a push or scheduled run of this repository's main, and exit 1 when there is one
 *
 * An entry leaves the list when its issue closes, so a fixed red can no longer pass a pull request's gate; and an
 * entry's evidence is a red on main, never a pull request's run (a fork's branch may be named main too). The
 * repository's issues and runs are read through GitHub's API, with GH_TOKEN when the environment holds one.
 */

import {isMainModule, REPOSITORY_ROOT} from './repository.ts';
import {type KnownRed, readKnownReds} from './known-reds.ts';

/** What GitHub says of an issue number: its state, and whether it is a pull request. */
export interface IssueFacts {
  state: string;
  pullRequest: boolean;
}

/** What GitHub says of a run: the branch, the event and the repository it ran on. */
export interface RunFacts {
  branch: string;
  event: string;
  repository: string;
}

/** What the check asks GitHub. */
export interface Lookups {
  issue(issue: number): Promise<IssueFacts>;
  runFacts(runId: number): Promise<RunFacts>;
}

/** The events whose runs on main are main's own: a merge's push and the nightly. */
const MAIN_EVENTS = new Set(['push', 'schedule']);

/**
 * What is wrong with `entries`: each issue that is not open or is a pull request, and each evidence run that is not a
 * push or scheduled run of `repository`'s main.
 */
export async function expiryProblems(
  entries: readonly KnownRed[],
  lookups: Lookups,
  repository: string,
): Promise<string[]> {
  const problems: string[] = [];
  const issues = new Map<number, IssueFacts>();
  const runs = new Map<number, RunFacts>();
  for (const entry of entries) {
    const rowName = `${entry.launch}: ${entry.file}: ${entry.title}`;
    let issue = issues.get(entry.card);
    if (issue === undefined) {
      issue = await lookups.issue(entry.card);
      issues.set(entry.card, issue);
    }
    if (issue.pullRequest) {
      problems.push(
        `#${String(entry.card)} is a pull request, not an issue: the entry for ${rowName}`,
      );
    } else if (issue.state !== 'open') {
      problems.push(
        `#${String(entry.card)} is ${issue.state}: remove its entry for ${rowName}`,
      );
    }
    let evidence = runs.get(entry.evidence);
    if (evidence === undefined) {
      evidence = await lookups.runFacts(entry.evidence);
      runs.set(entry.evidence, evidence);
    }
    if (
      evidence.branch !== 'main' ||
      !MAIN_EVENTS.has(evidence.event) ||
      evidence.repository !== repository
    ) {
      problems.push(
        `run ${String(entry.evidence)} is a ${evidence.event} run of ${evidence.repository} on ${evidence.branch}, not a push or scheduled run of ${repository}'s main: the evidence of ${rowName}`,
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
    async issue(issue) {
      const answer = await read(`issues/${String(issue)}`);
      return {
        state: String(answer.state),
        pullRequest: answer.pull_request !== undefined,
      };
    },
    async runFacts(runId) {
      const answer = await read(`actions/runs/${String(runId)}`);
      const headRepository = answer.head_repository as
        {full_name?: unknown} | null | undefined;
      return {
        branch: String(answer.head_branch),
        event: String(answer.event),
        repository: String(headRepository?.full_name),
      };
    },
  };
}

if (isMainModule(import.meta.url)) {
  const repository = process.env.GITHUB_REPOSITORY ?? 'remote-oss/remote';
  const problems = await expiryProblems(
    readKnownReds(REPOSITORY_ROOT),
    gitHubLookups(repository, process.env.GH_TOKEN),
    repository,
  );
  for (const problem of problems) {
    console.error(`check-known-reds: ${problem}`);
  }
  process.exitCode = problems.length === 0 ? 0 : 1;
}
