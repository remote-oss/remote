import {deepStrictEqual} from 'node:assert';
import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {
  ciGateProblems,
  dispatchFallbackOf,
  dispatchGroupProblems,
  poolJobProblems,
  postMergeProblems,
  SAME_REPOSITORY_GUARD,
} from './check-ci-gate.ts';
import {REPOSITORY_ROOT} from './repository.ts';

function workflow(gateNeeds: string): string {
  return `jobs:\n  build:\n    runs-on: x\n  test:\n    runs-on: x\n  ci-gate:\n    needs: ${gateNeeds}\n`;
}

describe('check-ci-gate', () => {
  it('passes when the gate needs every other job', () => {
    deepStrictEqual(ciGateProblems(workflow('[build, test]')), []);
  });

  it('names a job the gate does not need', () => {
    deepStrictEqual(ciGateProblems(workflow('build')), [
      ".github/workflows/ci.yml: ci-gate doesn't need test, so test can fail and the gate still pass",
    ]);
  });

  it('names a need that is no job', () => {
    deepStrictEqual(ciGateProblems(workflow('[build, test, gone]')), [
      '.github/workflows/ci.yml: ci-gate needs gone, which is no job',
    ]);
  });

  it('names a missing gate, and a gate without needs', () => {
    deepStrictEqual(
      [
        ciGateProblems('jobs:\n  build:\n    runs-on: x\n'),
        ciGateProblems(
          'jobs:\n  build:\n    runs-on: x\n  ci-gate:\n    runs-on: x\n',
        ),
      ],
      [
        ['.github/workflows/ci.yml: no ci-gate job'],
        [
          ".github/workflows/ci.yml: ci-gate doesn't need build, so build can fail and the gate still pass",
        ],
      ],
    );
  });

  it("holds for the repository's own ci.yml", () => {
    deepStrictEqual(
      ciGateProblems(
        readFileSync(
          path.join(REPOSITORY_ROOT, '.github/workflows/ci.yml'),
          'utf8',
        ),
      ),
      [],
    );
  });

  /** A workflow with one job `pool` whose runs-on is `runsOn`, and the `extra` lines of its body. */
  function poolWorkflow(runsOn: string, extra = ''): string {
    return `jobs:\n  pool:\n    runs-on: ${JSON.stringify(runsOn)}\n${extra}`;
  }
  const labels = `fromJSON(format('["{0}","X64","ephemeral"]', vars.CI_POOL_RUNS_ON))`;
  const guarded = `\${{ vars.CI_POOL_RUNS_ON && ${SAME_REPOSITORY_GUARD} && ${labels} || 'ubuntu-24.04' }}`;

  it('#2219: a pool job with the guard, X64 and ephemeral and no secret passes, as does a job off the pool', () => {
    deepStrictEqual(
      [
        poolJobProblems('w.yml', poolWorkflow(guarded)),
        poolJobProblems(
          'w.yml',
          poolWorkflow(
            'ubuntu-24.04',
            '    env:\n      TOKEN: ${{ secrets.A }}\n',
          ),
        ),
      ],
      [[], []],
    );
  });

  it('#2219: a pool job without the same-repository guard is named', () => {
    deepStrictEqual(
      poolJobProblems(
        'w.yml',
        poolWorkflow(
          `\${{ vars.CI_POOL_RUNS_ON && ${labels} || 'ubuntu-24.04' }}`,
        ),
      ),
      [
        'w.yml: pool can run on the pool, and its runs-on lacks the same-repository guard',
      ],
    );
  });

  it('#2219: a pool job on the checks variable without X64 and ephemeral is named', () => {
    deepStrictEqual(
      poolJobProblems(
        'w.yml',
        poolWorkflow(
          `\${{ vars.CI_CHECKS_RUNS_ON && ${SAME_REPOSITORY_GUARD} && fromJSON(format('["{0}"]', vars.CI_CHECKS_RUNS_ON)) || 'ubuntu-24.04' }}`,
        ),
      ),
      ['w.yml: pool can run on the pool without asking for X64 and ephemeral'],
    );
  });

  it('#2219: a pool job that reads a secret is named', () => {
    deepStrictEqual(
      poolJobProblems(
        'w.yml',
        poolWorkflow(
          guarded,
          '    steps:\n      - run: echo ${{ secrets.A }}\n',
        ),
      ),
      ['w.yml: pool can run on the pool and reads a secret'],
    );
  });

  it('#2219: every workflow of the repository holds, and its ci.yml without the guard names every pool job', () => {
    const folder = path.join(REPOSITORY_ROOT, '.github/workflows');
    const ciText = readFileSync(path.join(folder, 'ci.yml'), 'utf8');
    deepStrictEqual(
      [
        readdirSync(folder)
          .filter(file => file.endsWith('.yml'))
          .flatMap(file =>
            poolJobProblems(
              file,
              readFileSync(path.join(folder, file), 'utf8'),
            ),
          ),
        poolJobProblems(
          'ci.yml',
          ciText.split(SAME_REPOSITORY_GUARD).join('true'),
        ).map(problem => problem.split(' ')[1]),
      ],
      [
        [],
        [
          'changes',
          'vscodium-plan',
          'checks',
          'unit',
          'quality',
          'acceptance-slice-1',
          'acceptance-server',
          'acceptance-host-variants',
          'acceptance-real-server',
          'acceptance-vscodium',
        ],
      ],
    );
  });

  it('tooling-159: the post-merge run holds when its jobs read no variable, and a variable in either if:, or a missing job, is named', () => {
    function jobs(plan: string, vscodium: string): string {
      return `jobs:\n  vscodium-plan:\n    if: "${plan}"\n  acceptance-vscodium:\n    if: "${vscodium}"\n  acceptance-vscodium-containers:\n    if: "${vscodium}"\n`;
    }
    deepStrictEqual(
      [
        postMergeProblems(jobs("github.event_name == 'push'", '!cancelled()')),
        postMergeProblems(
          jobs(
            "github.event_name == 'push'",
            "!cancelled() && vars.CI_POST_MERGE_VSCODIUM != 'off'",
          ),
        ),
        postMergeProblems('jobs:\n  acceptance-vscodium:\n    runs-on: x\n'),
        postMergeProblems(
          readFileSync(
            path.join(REPOSITORY_ROOT, '.github', 'workflows', 'ci.yml'),
            'utf8',
          ),
        ),
      ],
      [
        [],
        [
          ".github/workflows/ci.yml: acceptance-vscodium's if: reads a repository variable, which could turn the post-merge run off",
          ".github/workflows/ci.yml: acceptance-vscodium-containers's if: reads a repository variable, which could turn the post-merge run off",
        ],
        [
          '.github/workflows/ci.yml: no vscodium-plan job, which the post-merge run needs',
          '.github/workflows/ci.yml: no acceptance-vscodium-containers job, which the post-merge run needs',
        ],
        [],
      ],
    );
  });

  it("tooling-159: a dispatch's fallback is the group expression's last top-level || operand, the text when there is no expression", () => {
    deepStrictEqual(
      [
        dispatchFallbackOf(
          "${{ github.event_name == 'schedule' && 'a' || (github.event_name == 'push' && format('b-{0}', github.ref)) || format('c-{0}', github.run_id) }}-${{ matrix.part.name }}",
        ),
        dispatchFallbackOf("${{ 'x || y' }}"),
        dispatchFallbackOf('fixed-group'),
      ],
      ["format('c-{0}', github.run_id)", "'x || y'", 'fixed-group'],
    );
  });

  it("tooling-159: the launch jobs' groups name the run in the dispatch fallback; a group of the part alone, or with the run only in the push branch, is named", () => {
    function jobsWith(group: string): string {
      return `jobs:\n  acceptance-vscodium:\n    concurrency:\n      group: "${group}"\n  acceptance-vscodium-containers:\n    concurrency:\n      group: "\${{ format('x-{0}', github.run_id) }}"\n  acceptance-genuine:\n    concurrency:\n      group: "\${{ format('y-{0}', github.run_id) }}"\n`;
    }
    const problem =
      ".github/workflows/ci.yml: acceptance-vscodium's concurrency group doesn't name the run for a dispatch, so one dispatch can replace another's pending job";
    deepStrictEqual(
      [
        dispatchGroupProblems(
          jobsWith(
            "${{ github.event_name == 'push' && 'main' || format('run-{0}', github.run_id) }}-a",
          ),
        ),
        dispatchGroupProblems(
          jobsWith('acceptance-vscodium-${{ matrix.part.name }}'),
        ),
        dispatchGroupProblems(
          jobsWith(
            "${{ github.event_name == 'push' && format('v-{0}', github.run_id) || 'acceptance-vscodium' }}-a",
          ),
        ),
        dispatchGroupProblems(
          readFileSync(
            path.join(REPOSITORY_ROOT, '.github', 'workflows', 'ci.yml'),
            'utf8',
          ),
        ),
      ],
      [[], [problem], [problem], []],
    );
  });
});
