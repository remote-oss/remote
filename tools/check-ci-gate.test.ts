import {deepStrictEqual} from 'node:assert';
import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {
  ciGateProblems,
  poolJobProblems,
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
          'post-merge-select',
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
});
