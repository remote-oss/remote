import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {ciGateProblems} from './check-ci-gate.ts';
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
});
