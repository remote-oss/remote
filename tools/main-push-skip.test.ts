/**
 * @fileoverview main-push-skip: the parts are left out only for a release train's merge whose tree a gate run passed
 * with every part; every other push, and every failed lookup, runs them.
 */

import {execFileSync} from 'node:child_process';
import {deepStrictEqual} from 'node:assert';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  type GateAttempt,
  type PushedCommit,
  pushedCommit,
  repositoryLookups,
  skipDecision,
  type SkipLookups,
} from './main-push-skip.ts';

const PARTS = ['ssh 1/2', 'ssh 2/2', 'containers 1/1'];
const HEAD = 'a'.repeat(40);
const TREE = 'b'.repeat(40);
const PARENT = 'c'.repeat(40);
const PUSHED: PushedCommit = {
  subject:
    'train: release train 90: #3083, #3075 and #3152, one gate run (#3167)',
  tree: TREE,
  parent: PARENT,
};

/** An attempt that concluded `conclusion` with a passing job for each of `parts`. */
function attemptOf(
  conclusion: string | null,
  parts: readonly string[],
): GateAttempt {
  return {
    conclusion,
    jobs: [
      {name: 'checks', conclusion: 'success'},
      ...parts.map(part => ({
        name: `acceptance-pr / acceptance (vscodium, ${part})`,
        conclusion: 'success',
      })),
    ],
  };
}

/** Lookups whose head has `tree`, whose history holds the parent when `contains`, with one run of `attempts`. */
function lookupsOf(
  attempts: readonly GateAttempt[],
  tree = TREE,
  contains = true,
): SkipLookups & {asked: string[]} {
  const asked: string[] = [];
  return {
    asked,
    head(pullRequest) {
      asked.push(`head ${String(pullRequest)}`);
      return Promise.resolve({commit: HEAD, tree});
    },
    contains(head, commit) {
      asked.push(`contains ${head.slice(0, 1)} ${commit.slice(0, 1)}`);
      return Promise.resolve(contains);
    },
    gateRuns(head) {
      asked.push(`runs ${head.slice(0, 1)}`);
      return Promise.resolve(
        attempts.length === 0 ? [] : [{id: 77, attempts: attempts.length}],
      );
    },
    attempt(runId, attempt) {
      asked.push(`attempt ${String(runId)} ${String(attempt)}`);
      const found = attempts[attempt - 1];
      return found === undefined
        ? Promise.reject(new Error(`no attempt ${String(attempt)}`))
        : Promise.resolve(found);
    },
  };
}

/** What git in `cwd` prints for `words`, trimmed. */
function gitOutput(cwd: string, ...words: string[]): string {
  return execFileSync('git', words, {cwd, encoding: 'utf8'}).trim();
}

describe('main-push-skip: whether a push to main leaves out the VSCodium parts (#3149)', () => {
  it('#3149: a train merge whose tree a gate run passed with every part leaves them out, naming the run, its attempt, the pull request, the head and the tree', async () => {
    const lookups = lookupsOf([attemptOf('success', PARTS)]);
    deepStrictEqual(
      [await skipDecision(PUSHED, PARTS, lookups), lookups.asked],
      [
        {
          skip: true,
          reason: `release train #3167’s head ${HEAD} has the pushed tree ${TREE}, and its gate run 77 passed every one of the 3 parts on attempt 1`,
        },
        ['head 3167', 'contains a c', 'runs a', 'attempt 77 1'],
      ],
    );
  });

  it('#3149: a gate that passed on an earlier attempt counts, though a later attempt failed', async () => {
    const lookups = lookupsOf([
      attemptOf('success', PARTS),
      attemptOf('failure', PARTS),
    ]);
    deepStrictEqual(
      [
        (await skipDecision(PUSHED, PARTS, lookups)).skip,
        lookups.asked.slice(3),
      ],
      [true, ['attempt 77 2', 'attempt 77 1']],
    );
  });

  it('#3149: a narrowed plan runs every part, naming the parts it had no passing job for', async () => {
    deepStrictEqual(
      await skipDecision(
        PUSHED,
        [...PARTS, 'explorer 1/2', 'explorer 2/2'],
        lookupsOf([attemptOf('success', ['ssh 1/2'])]),
      ),
      {
        skip: false,
        reason: `no gate run of #3167’s head ${HEAD} passed every part (77 attempt 1: success, no passing job for ssh 2/2, containers 1/1, explorer 1/2 and 1 more)`,
      },
    );
  });

  it('#3149: a red or cancelled gate, or none at all, runs every part', async () => {
    deepStrictEqual(
      [
        await skipDecision(
          PUSHED,
          PARTS,
          lookupsOf([attemptOf('failure', PARTS)]),
        ),
        await skipDecision(
          PUSHED,
          PARTS,
          lookupsOf([attemptOf('cancelled', PARTS)]),
        ),
        await skipDecision(PUSHED, PARTS, lookupsOf([attemptOf(null, PARTS)])),
        await skipDecision(PUSHED, PARTS, lookupsOf([])),
      ],
      [
        {
          skip: false,
          reason: `no gate run of #3167’s head ${HEAD} passed every part (77 attempt 1: failure)`,
        },
        {
          skip: false,
          reason: `no gate run of #3167’s head ${HEAD} passed every part (77 attempt 1: cancelled)`,
        },
        {
          skip: false,
          reason: `no gate run of #3167’s head ${HEAD} passed every part (77 attempt 1: null)`,
        },
        {
          skip: false,
          reason: `no gate run of #3167’s head ${HEAD} passed every part: there is none`,
        },
      ],
    );
  });

  it('#3149: a tree that is not the head’s, or a parent outside the head’s history, runs every part before any run is read', async () => {
    const otherTree = lookupsOf([attemptOf('success', PARTS)], 'd'.repeat(40));
    const outside = lookupsOf([attemptOf('success', PARTS)], TREE, false);
    deepStrictEqual(
      [
        await skipDecision(PUSHED, PARTS, otherTree),
        otherTree.asked,
        await skipDecision(PUSHED, PARTS, outside),
        outside.asked,
      ],
      [
        {
          skip: false,
          reason: `the pushed tree ${TREE} is not the tree ${'d'.repeat(40)} of #3167’s head ${HEAD}`,
        },
        ['head 3167'],
        {
          skip: false,
          reason: `the pushed commit’s parent ${PARENT} is not in the history of #3167’s head ${HEAD}`,
        },
        ['head 3167', 'contains a c'],
      ],
    );
  });

  it('#3149: a push that is no train’s merge, or a table with no part, runs every part and looks nothing up', async () => {
    const lookups = lookupsOf([attemptOf('success', PARTS)]);
    deepStrictEqual(
      [
        await skipDecision(
          {...PUSHED, subject: 'tests: a row (#3132)'},
          PARTS,
          lookups,
        ),
        await skipDecision(
          {...PUSHED, subject: 'train: release train 90: #3083'},
          PARTS,
          lookups,
        ),
        await skipDecision(PUSHED, [], lookups),
        lookups.asked,
      ],
      [
        {skip: false, reason: 'the push is not a release train’s merge'},
        {skip: false, reason: 'the push is not a release train’s merge'},
        {skip: false, reason: 'the parts table gives no part'},
        [],
      ],
    );
  });

  it('#3149: a lookup that fails runs every part, with the failure as the reason', async () => {
    const lookups = lookupsOf([attemptOf('success', PARTS)]);
    lookups.gateRuns = () => Promise.reject(new Error('GitHub answered 502'));
    deepStrictEqual(await skipDecision(PUSHED, PARTS, lookups), {
      skip: false,
      reason: 'a lookup for #3167 failed: GitHub answered 502',
    });
  });

  it('#3149: the API lookups read the compare status, this repository’s runs of the head, and every page of an attempt’s jobs', async () => {
    const routes: string[] = [];
    const answers: Record<string, unknown> = {
      'compare/p1...h1': {status: 'ahead'},
      'compare/p2...h1': {status: 'identical'},
      'compare/p3...h1': {status: 'diverged'},
      'actions/workflows/ci.yml/runs?event=pull_request&head_sha=h1&per_page=100':
        {
          workflow_runs: [
            {id: 5, run_attempt: 2, head_repository: {full_name: 'owner/repo'}},
            {id: 6, run_attempt: 1, head_repository: {full_name: 'fork/repo'}},
            {id: 8, run_attempt: 1, head_repository: null},
          ],
        },
      'actions/runs/5/attempts/2': {conclusion: 'success'},
      'actions/runs/5/attempts/2/jobs?per_page=20&page=1': {
        total_count: 3,
        jobs: [
          {name: 'one', conclusion: 'success', id: 1},
          {name: 'two', conclusion: 'skipped', id: 2},
        ],
      },
      'actions/runs/5/attempts/2/jobs?per_page=20&page=2': {
        total_count: 3,
        jobs: [{name: 'three', conclusion: null, id: 3}],
      },
    };
    const fetchUrl = ((address: string, init?: RequestInit) => {
      const route = address.replace(
        'https://api.github.com/repos/owner/repo/',
        '',
      );
      routes.push(
        `${route} ${String((init?.headers as Record<string, string>).Authorization)}`,
      );
      const answer = answers[route];
      return Promise.resolve(
        answer === undefined
          ? new Response('{}', {status: 404})
          : new Response(JSON.stringify(answer), {status: 200}),
      );
    }) as typeof fetch;
    const lookups = repositoryLookups('.', 'owner/repo', 'secret', fetchUrl, {
      tries: 1,
      pauseMilliseconds: 0,
    });
    deepStrictEqual(
      [
        await lookups.contains('h1', 'p1'),
        await lookups.contains('h1', 'p2'),
        await lookups.contains('h1', 'p3'),
        await lookups.gateRuns('h1'),
        await lookups.attempt(5, 2),
        await lookups
          .attempt(9, 1)
          .catch((error: unknown) =>
            error instanceof Error ? error.message : String(error),
          ),
        routes.length,
        routes[0],
      ],
      [
        true,
        true,
        false,
        [{id: 5, attempts: 2}],
        {
          conclusion: 'success',
          jobs: [
            {name: 'one', conclusion: 'success'},
            {name: 'two', conclusion: 'skipped'},
            {name: 'three', conclusion: null},
          ],
        },
        'main-push-skip: GitHub answered 404 for actions/runs/9/attempts/1',
        8,
        'compare/p1...h1 Bearer secret',
      ],
    );
  });

  it('#3149: git gives the pushed commit’s subject, tree and parent, and a pull request’s head from its refs/pull ref (a real repository)', async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'main-push-skip-'));
    try {
      const origin = path.join(folder, 'origin');
      const clone = path.join(folder, 'clone');
      execFileSync('git', ['init', '--quiet', '-b', 'main', origin]);
      const commits: Array<[string, string]> = [
        ['one.txt', 'first'],
        ['two.txt', 'train: release train 1: #1, one gate run (#2)'],
      ];
      for (const [file, subject] of commits) {
        writeFileSync(path.join(origin, file), subject);
        gitOutput(origin, 'add', file);
        gitOutput(
          origin,
          '-c',
          'user.name=row',
          '-c',
          'user.email=row@example.com',
          '-c',
          'commit.gpgsign=false',
          'commit',
          '--quiet',
          '-m',
          subject,
        );
      }
      gitOutput(origin, 'update-ref', 'refs/pull/2/head', 'HEAD');
      execFileSync('git', [
        'clone',
        '--quiet',
        '--depth=2',
        `file://${origin}`,
        clone,
      ]);
      deepStrictEqual(
        [
          pushedCommit(clone, 'HEAD'),
          await repositoryLookups(clone, 'owner/repo', undefined).head(2),
        ],
        [
          {
            subject: 'train: release train 1: #1, one gate run (#2)',
            tree: gitOutput(origin, 'rev-parse', 'HEAD^{tree}'),
            parent: gitOutput(origin, 'rev-parse', 'HEAD^1'),
          },
          {
            commit: gitOutput(origin, 'rev-parse', 'HEAD'),
            tree: gitOutput(origin, 'rev-parse', 'HEAD^{tree}'),
          },
        ],
      );
    } finally {
      rmSync(folder, {recursive: true, force: true});
    }
  });
});
