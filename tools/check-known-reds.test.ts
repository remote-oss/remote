/**
 * @fileoverview check-known-reds: an entry whose issue is closed or a pull request, or whose evidence is not a push or
 * scheduled run of this repository's main, is named.
 */

import {deepStrictEqual, rejects} from 'node:assert';
import {
  expiryProblems,
  gitHubLookups,
  type IssueFacts,
  type Lookups,
  type RunFacts,
} from './check-known-reds.ts';
import type {KnownRed} from './known-reds.ts';

const REPOSITORY = 'owner/repo';
const ENTRY: KnownRed = {
  launch: 'ssh-core',
  file: 'ssh-core/terminal.test.ts',
  title: 'a row',
  card: 2001,
  owner: 'someone',
  evidence: 42000,
  added: '2026-11-12',
};
const OPEN: IssueFacts = {state: 'open', pullRequest: false};
const NIGHTLY: RunFacts = {
  branch: 'main',
  event: 'schedule',
  repository: REPOSITORY,
};
const ENTRY_ROW = 'ssh-core: ssh-core/terminal.test.ts: a row';

/** Lookups that answer `issue` and `runFacts` for every number, and record what they were asked. */
function fakeLookups(
  issue: IssueFacts,
  runFacts: RunFacts,
  asked: string[] = [],
): Lookups {
  return {
    issue(number) {
      asked.push(`issue ${String(number)}`);
      return Promise.resolve(issue);
    },
    runFacts(runId) {
      asked.push(`run ${String(runId)}`);
      return Promise.resolve(runFacts);
    },
  };
}

describe('check-known-reds: the list against its issues and runs', () => {
  it('open issues with a nightly or a push of main as evidence give no problem, and each issue and run is asked once', async () => {
    const asked: string[] = [];
    deepStrictEqual(
      [
        await expiryProblems(
          [ENTRY, {...ENTRY, title: 'another row'}],
          fakeLookups(OPEN, NIGHTLY, asked),
          REPOSITORY,
        ),
        await expiryProblems(
          [ENTRY],
          fakeLookups(OPEN, {...NIGHTLY, event: 'push'}),
          REPOSITORY,
        ),
        asked,
      ],
      [[], [], ['issue 2001', 'run 42000']],
    );
  });

  it('a closed issue and a pull request in place of an issue are each named', async () => {
    deepStrictEqual(
      [
        await expiryProblems(
          [ENTRY],
          fakeLookups({state: 'closed', pullRequest: false}, NIGHTLY),
          REPOSITORY,
        ),
        await expiryProblems(
          [ENTRY],
          fakeLookups({state: 'open', pullRequest: true}, NIGHTLY),
          REPOSITORY,
        ),
      ],
      [
        [`#2001 is closed: remove its entry for ${ENTRY_ROW}`],
        [`#2001 is a pull request, not an issue: the entry for ${ENTRY_ROW}`],
      ],
    );
  });

  it("evidence off main, from a pull request's run, or from a fork's branch named main is named", async () => {
    deepStrictEqual(
      [
        ...(await expiryProblems(
          [ENTRY],
          fakeLookups(OPEN, {...NIGHTLY, branch: 'train/green-gate'}),
          REPOSITORY,
        )),
        ...(await expiryProblems(
          [ENTRY],
          fakeLookups(OPEN, {...NIGHTLY, event: 'pull_request'}),
          REPOSITORY,
        )),
        ...(await expiryProblems(
          [ENTRY],
          fakeLookups(OPEN, {
            branch: 'main',
            event: 'pull_request',
            repository: 'someone/fork',
          }),
          REPOSITORY,
        )),
      ],
      [
        `run 42000 is a schedule run of owner/repo on train/green-gate, not a push or scheduled run of owner/repo's main: the evidence of ${ENTRY_ROW}`,
        `run 42000 is a pull_request run of owner/repo on main, not a push or scheduled run of owner/repo's main: the evidence of ${ENTRY_ROW}`,
        `run 42000 is a pull_request run of someone/fork on main, not a push or scheduled run of owner/repo's main: the evidence of ${ENTRY_ROW}`,
      ],
    );
  });

  it("GitHub's lookups read the issue's state and kind and the run's branch, event and repository, with the token when there is one", async () => {
    const requests: Array<[string, string | undefined]> = [];
    const fetchUrl = ((
      url: string,
      init?: {headers?: Record<string, string>},
    ) => {
      requests.push([url, init?.headers?.Authorization]);
      const body = url.endsWith('/issues/7')
        ? {state: 'open'}
        : url.endsWith('/issues/8')
          ? {state: 'open', pull_request: {url: 'x'}}
          : {
              head_branch: 'main',
              event: 'schedule',
              head_repository: {full_name: 'owner/repo'},
            };
      return Promise.resolve(new Response(JSON.stringify(body)));
    }) as typeof fetch;
    const withToken = gitHubLookups('owner/repo', 'secret', fetchUrl);
    const without = gitHubLookups('owner/repo', undefined, fetchUrl);
    deepStrictEqual(
      [
        await withToken.issue(7),
        await withToken.issue(8),
        await without.runFacts(9),
        requests,
      ],
      [
        {state: 'open', pullRequest: false},
        {state: 'open', pullRequest: true},
        {branch: 'main', event: 'schedule', repository: 'owner/repo'},
        [
          ['https://api.github.com/repos/owner/repo/issues/7', 'Bearer secret'],
          ['https://api.github.com/repos/owner/repo/issues/8', 'Bearer secret'],
          ['https://api.github.com/repos/owner/repo/actions/runs/9', undefined],
        ],
      ],
    );
  });

  it('an answer that is not 200 fails the lookup with its status and route', async () => {
    const fetchUrl = (() =>
      Promise.resolve(new Response('{}', {status: 404}))) as typeof fetch;
    await rejects(gitHubLookups('owner/repo', '', fetchUrl).issue(7), {
      message: 'check-known-reds: GitHub answered 404 for issues/7',
    });
  });
});
