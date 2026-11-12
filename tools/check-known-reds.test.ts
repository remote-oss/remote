/**
 * @fileoverview check-known-reds: an entry whose issue is closed, or whose evidence is not a run of main, is named.
 */

import {deepStrictEqual, rejects} from 'node:assert';
import {
  expiryProblems,
  gitHubLookups,
  type Lookups,
} from './check-known-reds.ts';
import type {KnownRed} from './known-reds.ts';

const ENTRY: KnownRed = {
  launch: 'ssh-core',
  file: 'ssh-core/terminal.test.ts',
  title: 'a row',
  card: 2001,
  owner: 'someone',
  evidence: 42000,
  added: '2026-11-12',
};

/** Lookups that answer from `states` and `branches`, and count what they were asked. */
function fakeLookups(
  states: Record<number, string>,
  branches: Record<number, string>,
  asked: string[],
): Lookups {
  return {
    issueState(issue) {
      asked.push(`issue ${String(issue)}`);
      return Promise.resolve(states[issue] ?? 'missing');
    },
    runBranch(runId) {
      asked.push(`run ${String(runId)}`);
      return Promise.resolve(branches[runId] ?? 'missing');
    },
  };
}

describe('check-known-reds: the list against its issues and runs', () => {
  it('open issues with evidence on main give no problem, and each issue and run is asked once', async () => {
    const asked: string[] = [];
    deepStrictEqual(
      [
        await expiryProblems(
          [ENTRY, {...ENTRY, title: 'another row'}],
          fakeLookups({2001: 'open'}, {42000: 'main'}, asked),
        ),
        asked,
      ],
      [[], ['issue 2001', 'run 42000']],
    );
  });

  it('a closed issue and evidence off main are each named', async () => {
    deepStrictEqual(
      await expiryProblems(
        [ENTRY],
        fakeLookups({2001: 'closed'}, {42000: 'train/green-gate'}, []),
      ),
      [
        '#2001 is closed: remove its entry for ssh-core: ssh-core/terminal.test.ts: a row',
        'run 42000 ran on train/green-gate, not main: the evidence of ssh-core: ssh-core/terminal.test.ts: a row',
      ],
    );
  });

  it("GitHub's lookups read the issue's state and the run's branch, with the token when there is one", async () => {
    const requests: Array<[string, string | undefined]> = [];
    const fetchUrl = ((
      url: string,
      init?: {headers?: Record<string, string>},
    ) => {
      requests.push([url, init?.headers?.Authorization]);
      const body = url.endsWith('/issues/7')
        ? {state: 'open'}
        : {head_branch: 'main'};
      return Promise.resolve(new Response(JSON.stringify(body)));
    }) as typeof fetch;
    const withToken = gitHubLookups('owner/repo', 'secret', fetchUrl);
    const without = gitHubLookups('owner/repo', undefined, fetchUrl);
    deepStrictEqual(
      [await withToken.issueState(7), await without.runBranch(9), requests],
      [
        'open',
        'main',
        [
          ['https://api.github.com/repos/owner/repo/issues/7', 'Bearer secret'],
          ['https://api.github.com/repos/owner/repo/actions/runs/9', undefined],
        ],
      ],
    );
  });

  it('an answer that is not 200 fails the lookup with its status and route', async () => {
    const fetchUrl = (() =>
      Promise.resolve(new Response('{}', {status: 404}))) as typeof fetch;
    await rejects(gitHubLookups('owner/repo', '', fetchUrl).issueState(7), {
      message: 'check-known-reds: GitHub answered 404 for issues/7',
    });
  });
});
