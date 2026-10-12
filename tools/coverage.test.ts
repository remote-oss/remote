import {deepStrictEqual, strictEqual} from 'node:assert';
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {
  type CoverageNumbers,
  type CoverageUnit,
  coverageUnits,
  exclusionProblems,
  gateProblems,
  measureUnit,
  nextRatchet,
  runCoverage,
} from './coverage.ts';
import {TemporaryWorkspace} from './temporary-workspace.ts';

const passing: CoverageNumbers = {lines: 95, branches: 90, functions: 100};

describe('coverage', () => {
  let workspace: TemporaryWorkspace;

  function unitAt(position: number): CoverageUnit {
    const unit = coverageUnits(workspace.root)[position];
    if (unit === undefined) {
      throw new Error(`the workspace has no unit at ${String(position)}`);
    }
    return unit;
  }

  function packageUnit(): CoverageUnit {
    return unitAt(1);
  }

  beforeEach(() => {
    workspace = new TemporaryWorkspace('coverage');
    workspace.writeManifest('remote-a');
    workspace.writeManifest('remote-b');
    workspace.write('tools/.keep', '');
    workspace.write('packages/remote-a/README.md', '# remote-a\n');
    workspace.write(
      'packages/remote-a/src/sign.ts',
      "export function sign(value: number): string {\n  if (value < 0) {\n    return 'negative';\n  }\n  return 'positive';\n}\n",
    );
    workspace.write(
      'packages/remote-a/test/unit/sign.test.ts',
      "import {strictEqual} from 'node:assert';\nimport {sign} from '../../src/sign.ts';\n\nit('signs a negative number', () => {\n  strictEqual(sign(-1), 'negative');\n});\n",
    );
  });

  afterEach(() => {
    workspace.remove();
  });

  describe('units', () => {
    it('measure the unit and integration tests of a package', () => {
      workspace.write('packages/remote-a/test/integration/.keep', '');
      deepStrictEqual(packageUnit().tests, [
        'packages/remote-a/test/unit/**/*.test.ts',
        'packages/remote-a/test/integration/**/*.test.ts',
      ]);
    });

    it('are tools/ and each package with src/', () => {
      deepStrictEqual(
        coverageUnits(workspace.root).map(unit => unit.name),
        ['tools', 'remote-a'],
      );
    });
  });

  describe('exclusions', () => {
    it('accept a listed file with a reason', () => {
      workspace.write('packages/remote-a/src/editor.ts', '');
      workspace.write(
        'packages/remote-a/README.md',
        'Excluded: src/editor.ts\n',
      );
      deepStrictEqual(
        exclusionProblems(packageUnit(), {
          exclude: {'src/editor.ts': 'only the editor calls it'},
        }),
        [],
      );
    });

    it('report a missing reason, a stale file and a missing README entry', () => {
      deepStrictEqual(
        exclusionProblems(packageUnit(), {exclude: {'src/gone.ts': ' '}}),
        [
          'remote-a: exclusion src/gone.ts has no reason',
          'remote-a: exclusion src/gone.ts names no file',
          'remote-a: exclusion src/gone.ts is not listed in README.md',
        ],
      );
    });

    it('need no README entry for tools/', () => {
      workspace.write('tools/run.ts', '');
      deepStrictEqual(
        exclusionProblems(unitAt(0), {exclude: {'run.ts': 'a script'}}),
        [],
      );
    });

    it('report a named generated file as covered by the rule', () => {
      workspace.write('packages/remote-a/src/x.generated.ts', '');
      deepStrictEqual(
        exclusionProblems(packageUnit(), {
          exclude: {'src/x.generated.ts': 'generated'},
        }),
        [
          'remote-a: exclusion src/x.generated.ts is covered by the generated-file rule; remove the entry',
        ],
      );
    });
  });

  describe('gates', () => {
    it('pass numbers at the gates', () => {
      deepStrictEqual(
        gateProblems(
          'unit',
          {lines: 90, branches: 85, functions: 90},
          undefined,
        ),
        [],
      );
    });

    it('report each number below its gate', () => {
      deepStrictEqual(
        gateProblems(
          'unit',
          {lines: 89.9, branches: 84, functions: 50},
          undefined,
        ),
        [
          'unit: lines 89.9 % is below the gate of 90 %',
          'unit: branches 84 % is below the gate of 85 %',
          'unit: functions 50 % is below the gate of 90 %',
        ],
      );
    });

    it('allow a drop of half a point below the record', () => {
      deepStrictEqual(
        gateProblems('unit', {...passing, lines: 94.5}, passing),
        [],
      );
    });

    it('report a drop of more than half a point below the record', () => {
      deepStrictEqual(
        gateProblems('unit', {...passing, branches: 89.4}, passing),
        [
          'unit: branches 89.4 % dropped more than 0.5 points below the record of 90 %',
        ],
      );
    });
  });

  describe('ratchet', () => {
    it('keeps the larger of record and measurement', () => {
      deepStrictEqual(
        nextRatchet(passing, {lines: 99, branches: 89.8, functions: 100}),
        {lines: 99, branches: 90, functions: 100},
      );
    });

    it('starts from the measurement', () => {
      deepStrictEqual(nextRatchet(undefined, passing), passing);
    });
  });

  describe('measurement', () => {
    it('measures a package with c8', function () {
      this.timeout(30_000);
      deepStrictEqual(measureUnit(workspace.root, packageUnit(), []), {
        lines: 83.33,
        branches: 66.66,
        functions: 100,
      });
    });

    it('does not count a generated file, even when uncovered', function () {
      this.timeout(30_000);
      workspace.write(
        'packages/remote-a/src/x.generated.ts',
        'export function neverRun(): string {\n  return "generated";\n}\n',
      );
      deepStrictEqual(measureUnit(workspace.root, packageUnit(), []), {
        lines: 83.33,
        branches: 66.66,
        functions: 100,
      });
    });

    it('still counts an uncovered file that is not generated', function () {
      this.timeout(30_000);
      workspace.write(
        'packages/remote-a/src/plain.ts',
        'export const one = 1;\nexport function a() {\n  return 1;\n}\nexport function b() {\n  return 2;\n}\n',
      );
      deepStrictEqual(measureUnit(workspace.root, packageUnit(), []), {
        lines: 38.46,
        branches: 50,
        functions: 50,
      });
    });

    it('returns nothing when the tests fail', function () {
      this.timeout(30_000);
      workspace.write(
        'packages/remote-a/test/unit/sign.test.ts',
        "import {strictEqual} from 'node:assert';\n\nit('fails', () => {\n  strictEqual(1, 2);\n});\n",
      );
      strictEqual(measureUnit(workspace.root, packageUnit(), []), undefined);
    });
  });

  describe('run', () => {
    function measured(numbers: CoverageNumbers | undefined) {
      return (): CoverageNumbers | undefined => numbers;
    }

    it('reports a unit without a ratchet', () => {
      deepStrictEqual(runCoverage(workspace.root, false, measured(passing)), [
        'tools: coverage.json has no ratchet; run pnpm coverage:update',
        'remote-a: coverage.json has no ratchet; run pnpm coverage:update',
      ]);
    });

    it('records the ratchet on update', () => {
      runCoverage(workspace.root, true, measured(passing));
      const file = path.join(workspace.root, 'packages/remote-a/coverage.json');
      deepStrictEqual(JSON.parse(readFileSync(file, 'utf8')), {
        ratchet: passing,
      });
    });

    it('reports failing tests and keeps the record', () => {
      workspace.write('packages/remote-a/coverage.json', {ratchet: passing});
      workspace.write('tools/coverage.json', {ratchet: passing});
      deepStrictEqual(runCoverage(workspace.root, true, measured(undefined)), [
        'tools: the tests failed or none were found',
        'remote-a: the tests failed or none were found',
      ]);
    });

    it('does not update a unit below its gate', () => {
      runCoverage(
        workspace.root,
        true,
        measured({lines: 10, branches: 10, functions: 10}),
      );
      strictEqual(
        existsSync(
          path.join(workspace.root, 'packages/remote-a/coverage.json'),
        ),
        false,
      );
    });
  });
});
