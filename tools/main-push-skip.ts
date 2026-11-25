/**
 * @fileoverview main-push-skip: whether a push to main leaves out the VSCodium parts because the release train it merges
 * already passed every part on the same tree (athena's ruling-3147-throughput, item 5, #3147).
 *
 * The parts are left out only when all of these hold; any other push runs every part:
 * - the pushed commit's subject is a release train's merge, `train: release train <n>: … (#<pull request>)`;
 * - its tree is that pull request's head's tree, and its parent is in the head's history, so the merge with main that the
 *   gate run tested had that same tree;
 * - a ci.yml run of that head on `pull_request` passed on some attempt with a passing job for every part of the parts
 *   table, so its plan was every part.
 *
 * It reads that run with the job's own token (`actions: read` and `contents: read`), never a repository variable. A
 * lookup that fails runs every part and says why.
 *
 *     node tools/main-push-skip.ts [<commit>]    prints skip=true or skip=false for $GITHUB_OUTPUT, and the reason to
 *                                               stderr and to $GITHUB_STEP_SUMMARY; the commit is HEAD when none is given
 */

import {execFileSync} from 'node:child_process';
import {appendFileSync, readFileSync} from 'node:fs';
import {launchesOf} from './acceptance-launches.ts';
import {
  PARTS_TABLE,
  type PartsTable,
  partsOfTable,
  suiteFilesIn,
} from './acceptance-parts.ts';
import {gitHubReader} from './github-read.ts';
import {isMainModule, REPOSITORY_ROOT} from './repository.ts';

/** The pushed commit: its subject, its tree and its first parent. */
export interface PushedCommit {
  subject: string;
  tree: string;
  parent: string;
}

/** A pull request's head commit and its tree. */
export interface HeadCommit {
  commit: string;
  tree: string;
}

/** A ci.yml run of a head on `pull_request`, and how many attempts it has. */
export interface GateRun {
  id: number;
  attempts: number;
}

/** One attempt of a run: its conclusion and its jobs. */
export interface GateAttempt {
  conclusion: string | null;
  jobs: ReadonlyArray<{name: string; conclusion: string | null}>;
}

/** What the decision reads from git and from GitHub. */
export interface SkipLookups {
  head(pullRequest: number): Promise<HeadCommit>;
  /** Whether `commit` is in the history of `head`. */
  contains(head: string, commit: string): Promise<boolean>;
  gateRuns(head: string): Promise<GateRun[]>;
  attempt(runId: number, attempt: number): Promise<GateAttempt>;
}

/** Whether the parts are left out, and why, in one line. */
export interface SkipDecision {
  skip: boolean;
  reason: string;
}

const TRAIN_SUBJECT = /^train: release train \d+: .*\(#(\d+)\)$/u;

/** The job name of a part in a pull request's run, as acceptance-launches.yml names it under the acceptance-pr job. */
function partJob(part: string): string {
  return `acceptance-pr / acceptance (vscodium, ${part})`;
}

/** The parts with no passing job among `jobs`. */
function partsMissing(
  jobs: GateAttempt['jobs'],
  parts: readonly string[],
): string[] {
  const passed = new Set(
    jobs.filter(each => each.conclusion === 'success').map(each => each.name),
  );
  return parts.filter(part => !passed.has(partJob(part)));
}

/** The parts missing from `missing`, named up to three, for a reason. */
function missingText(missing: readonly string[]): string {
  const named = missing.slice(0, 3).join(', ');
  return missing.length > 3
    ? `${named} and ${String(missing.length - 3)} more`
    : named;
}

/** Whether `pushed` may leave out the VSCodium parts, given every part's name and the lookups. */
export async function skipDecision(
  pushed: PushedCommit,
  parts: readonly string[],
  lookups: SkipLookups,
): Promise<SkipDecision> {
  const number = TRAIN_SUBJECT.exec(pushed.subject)?.[1];
  if (number === undefined) {
    return {skip: false, reason: 'the push is not a release train’s merge'};
  }
  const pullRequest = `#${number}`;
  if (parts.length === 0) {
    return {skip: false, reason: 'the parts table gives no part'};
  }
  try {
    const head = await lookups.head(Number(number));
    if (head.tree !== pushed.tree) {
      return {
        skip: false,
        reason: `the pushed tree ${pushed.tree} is not the tree ${head.tree} of ${pullRequest}’s head ${head.commit}`,
      };
    }
    if (!(await lookups.contains(head.commit, pushed.parent))) {
      return {
        skip: false,
        reason: `the pushed commit’s parent ${pushed.parent} is not in the history of ${pullRequest}’s head ${head.commit}`,
      };
    }
    const seen: string[] = [];
    for (const gateRun of await lookups.gateRuns(head.commit)) {
      for (let attempt = gateRun.attempts; attempt >= 1; attempt -= 1) {
        const facts = await lookups.attempt(gateRun.id, attempt);
        const missing = partsMissing(facts.jobs, parts);
        if (facts.conclusion === 'success' && missing.length === 0) {
          return {
            skip: true,
            reason: `release train ${pullRequest}’s head ${head.commit} has the pushed tree ${pushed.tree}, and its gate run ${String(gateRun.id)} passed every one of the ${String(parts.length)} parts on attempt ${String(attempt)}`,
          };
        }
        seen.push(
          missing.length === 0
            ? `${String(gateRun.id)} attempt ${String(attempt)}: ${String(facts.conclusion)}`
            : `${String(gateRun.id)} attempt ${String(attempt)}: ${String(facts.conclusion)}, no passing job for ${missingText(missing)}`,
        );
      }
    }
    return {
      skip: false,
      reason: `no gate run of ${pullRequest}’s head ${head.commit} passed every part${seen.length === 0 ? ': there is none' : ` (${seen.join('; ')})`}`,
    };
  } catch (error) {
    return {
      skip: false,
      reason: `a lookup for ${pullRequest} failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** What git in `root` prints for `words`, trimmed. */
function gitIn(root: string, ...words: string[]): string {
  return execFileSync('git', words, {cwd: root, encoding: 'utf8'}).trim();
}

/** The lookups of this repository: git in `root` for the head, GitHub's API with `token` for the rest. */
export function repositoryLookups(
  root: string,
  repository: string,
  token: string | undefined,
  fetchUrl: typeof fetch = fetch,
): SkipLookups {
  const read = gitHubReader('main-push-skip', repository, token, fetchUrl);
  return {
    head(pullRequest) {
      gitIn(
        root,
        'fetch',
        '--quiet',
        '--no-tags',
        '--depth=1',
        'origin',
        `refs/pull/${String(pullRequest)}/head`,
      );
      return Promise.resolve({
        commit: gitIn(root, 'rev-parse', 'FETCH_HEAD'),
        tree: gitIn(root, 'rev-parse', 'FETCH_HEAD^{tree}'),
      });
    },
    async contains(head, commit) {
      const answer = await read(`compare/${commit}...${head}`);
      return answer.status === 'ahead' || answer.status === 'identical';
    },
    async gateRuns(head) {
      const answer = await read(
        `actions/workflows/ci.yml/runs?event=pull_request&head_sha=${head}&per_page=100`,
      );
      const runs = (answer.workflow_runs ?? []) as Array<{
        id: number;
        run_attempt: number;
        head_repository?: {full_name?: string} | null;
      }>;
      return runs
        .filter(each => each.head_repository?.full_name === repository)
        .map(each => ({id: each.id, attempts: each.run_attempt}));
    },
    async attempt(runId, attempt) {
      const route = `actions/runs/${String(runId)}/attempts/${String(attempt)}`;
      const facts = await read(route);
      const jobs: Array<{name: string; conclusion: string | null}> = [];
      for (let page = 1; ; page += 1) {
        const answer = await read(
          `${route}/jobs?per_page=100&page=${String(page)}`,
        );
        const found = (answer.jobs ?? []) as typeof jobs;
        jobs.push(
          ...found.map(each => ({
            name: each.name,
            conclusion: each.conclusion,
          })),
        );
        if (found.length === 0 || jobs.length >= Number(answer.total_count)) {
          break;
        }
      }
      return {conclusion: facts.conclusion as string | null, jobs};
    },
  };
}

/** The pushed commit `commit` as git in `root` gives it. */
export function pushedCommit(root: string, commit: string): PushedCommit {
  return {
    subject: gitIn(root, 'log', '-1', '--format=%s', commit),
    tree: gitIn(root, 'rev-parse', `${commit}^{tree}`),
    parent: gitIn(root, 'rev-parse', `${commit}^1`),
  };
}

if (isMainModule(import.meta.url)) {
  const commit = process.argv[2] ?? 'HEAD';
  const table = JSON.parse(readFileSync(PARTS_TABLE, 'utf8')) as PartsTable;
  const parts = partsOfTable(
    launchesOf(REPOSITORY_ROOT),
    table,
    suiteFilesIn(REPOSITORY_ROOT),
  ).map(part => part.name);
  let decision: SkipDecision;
  try {
    decision = await skipDecision(
      pushedCommit(REPOSITORY_ROOT, commit),
      parts,
      repositoryLookups(
        REPOSITORY_ROOT,
        process.env.GITHUB_REPOSITORY ?? 'remote-oss/remote',
        process.env.GH_TOKEN,
      ),
    );
  } catch (error) {
    decision = {
      skip: false,
      reason: `the pushed commit could not be read: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const line = `**VSCodium parts after this push:** ${decision.skip ? 'left out' : 'every part'}: ${decision.reason}.`;
  console.error(line);
  if (process.env.GITHUB_STEP_SUMMARY !== undefined) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
  }
  console.log(`skip=${String(decision.skip)}`);
}
