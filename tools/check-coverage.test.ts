import {deepStrictEqual, strictEqual} from 'node:assert';
import {
  checkCoverage,
  citedBy,
  COVERAGE_FILE,
  type CoverageReport,
  outputOf,
} from './check-coverage.ts';
import {TemporaryWorkspace} from './temporary-workspace.ts';

const HEADER = 'ac\ttag\treason\n';

/** The problems of a report, or the way it failed. */
function problemsOf(report: CoverageReport): string[] {
  return report.kind === 'checked' ? report.problems : [report.kind];
}

describe('check-coverage', () => {
  let workspace: TemporaryWorkspace;

  /** Writes the coverage file with these lines under the header. */
  function tagged(...lines: string[]): void {
    workspace.write(COVERAGE_FILE, `${HEADER}${lines.join('\n')}\n`);
  }

  function acceptanceTest(...names: string[]): void {
    workspace.write(
      'tests/acceptance/server/x.test.ts',
      names.map(name => `it('${name}', () => {});`).join('\n'),
    );
  }

  function unitTest(...names: string[]): void {
    workspace.write(
      'packages/remote-x/test/unit/x.test.ts',
      names.map(name => `it('${name}', () => {});`).join('\n'),
    );
  }

  function problems(): string[] {
    return problemsOf(checkCoverage(workspace.root));
  }

  beforeEach(() => {
    workspace = new TemporaryWorkspace('check-coverage');
  });

  afterEach(() => {
    workspace.remove();
  });

  describe('the file', () => {
    it('#142 1: a file with only todo lines and no tests passes', () => {
      tagged('F-2601.AC-1\ttodo\t', 'F-2601.AC-2\ttodo\t');
      deepStrictEqual(problems(), []);
    });

    it('#142 1: the report counts the lines per tag, todo included', () => {
      tagged(
        'F-2601.AC-1\ttodo\t',
        'F-2601.AC-2\ttodo\t',
        'F-2601.AC-3\tcore\twhy',
      );
      deepStrictEqual(outputOf(checkCoverage(workspace.root)).lines.slice(-6), [
        'acceptance: 0',
        'unit: 0',
        'recorded: 0',
        'core: 1',
        'deferred: 0',
        'todo: 2',
      ]);
    });

    it('#142 1: a passing check exits 0', () => {
      tagged('F-2601.AC-1\ttodo\t');
      strictEqual(outputOf(checkCoverage(workspace.root)).exitCode, 0);
    });

    it('#142 1: a line with a tag that is not one of the six fails', () => {
      tagged('F-2601.AC-1\tdone\t');
      deepStrictEqual(problems(), [
        `${COVERAGE_FILE}:00002: unknown tag: done`,
      ]);
    });

    it('#142 1: a line with two fields fails', () => {
      tagged('F-2601.AC-12\tacceptance');
      deepStrictEqual(problems(), [
        `${COVERAGE_FILE}:00002: wrong number of fields`,
      ]);
    });

    it('#142 1: AC-3 before AC-12 passes, the order being numeric', () => {
      tagged('F-2601.AC-3\ttodo\t', 'F-2601.AC-12\ttodo\t');
      deepStrictEqual(problems(), []);
    });

    it('#142 1: AC-12 before AC-3 fails as out of order', () => {
      tagged('F-2601.AC-12\ttodo\t', 'F-2601.AC-3\ttodo\t');
      deepStrictEqual(problems(), [
        `${COVERAGE_FILE}:00003: F-2601.AC-3 is out of order`,
      ]);
    });

    it('#142 1: a feature after a later one fails as out of order', () => {
      tagged('F-2601.AC-1\ttodo\t', 'F-2001.AC-1\ttodo\t');
      deepStrictEqual(problems(), [
        `${COVERAGE_FILE}:00003: F-2001.AC-1 is out of order`,
      ]);
    });

    it('#142 1: the same criterion twice fails as repeated', () => {
      tagged('F-2601.AC-1\ttodo\t', 'F-2601.AC-1\ttodo\t');
      deepStrictEqual(problems(), [
        `${COVERAGE_FILE}:00003: F-2601.AC-1 is repeated`,
      ]);
    });

    it('#142 1: an id that is not of the form fails', () => {
      tagged('F-2601.AC-x\ttodo\t');
      deepStrictEqual(problems(), [
        `${COVERAGE_FILE}:00002: AC id out of form: F-2601.AC-x`,
      ]);
    });

    it('#142 1: a core line with no reason fails', () => {
      tagged('F-2601.AC-1\tcore\t');
      deepStrictEqual(problems(), [
        `${COVERAGE_FILE}:00002: F-2601.AC-1 needs a reason`,
      ]);
    });

    it('#142 1: a deferred line with no reason fails', () => {
      tagged('F-2601.AC-1\tdeferred\t');
      deepStrictEqual(problems(), [
        `${COVERAGE_FILE}:00002: F-2601.AC-1 needs a reason`,
      ]);
    });

    it('#142 1: a deferred line with a reason passes', () => {
      tagged('F-2601.AC-1\tdeferred\tD-51');
      deepStrictEqual(problems(), []);
    });

    it('#142 1: an acceptance line with a reason fails', () => {
      acceptanceTest('F-2601 AC-1: x');
      tagged('F-2601.AC-1\tacceptance\twhy');
      deepStrictEqual(problems(), [
        `${COVERAGE_FILE}:00002: F-2601.AC-1 has a reason, which is only for core or deferred`,
      ]);
    });

    it('#142 1: a blank line between lines is skipped', () => {
      workspace.write(
        COVERAGE_FILE,
        `${HEADER}F-2601.AC-1\ttodo\t\n\nF-2601.AC-2\ttodo\t\n`,
      );
      deepStrictEqual(problems(), []);
    });

    it('#142: a missing file is unreadable', () => {
      strictEqual(outputOf(checkCoverage(workspace.root)).exitCode, 2);
    });

    it('#142: a missing file names itself', () => {
      deepStrictEqual(outputOf(checkCoverage(workspace.root)).lines, [
        `check-coverage: cannot read ${COVERAGE_FILE}`,
      ]);
    });

    it('#142: problems make the exit code 1', () => {
      tagged('F-2601.AC-1\tdone\t');
      strictEqual(outputOf(checkCoverage(workspace.root)).exitCode, 1);
    });

    it('#142: two problems are both printed, sorted', () => {
      tagged('F-2601.AC-2\tdone\t', 'F-2601.AC-1\tcore\t');
      deepStrictEqual(
        outputOf(checkCoverage(workspace.root)).lines.slice(0, 2),
        [
          `${COVERAGE_FILE}:00002: unknown tag: done`,
          `${COVERAGE_FILE}:00003: F-2601.AC-1 needs a reason`,
        ],
      );
    });
  });

  describe('the rows', () => {
    it('#142 2: an acceptance line and an acceptance row that cites it pass', () => {
      acceptanceTest('F-2601 AC-12: x');
      tagged('F-2601.AC-12\tacceptance\t');
      deepStrictEqual(problems(), []);
    });

    it('#142 2: an acceptance line with no row that cites it fails', () => {
      tagged('F-2601.AC-12\tacceptance\t');
      deepStrictEqual(problems(), [
        `${COVERAGE_FILE}:00002: F-2601.AC-12 is tagged acceptance and no acceptance row cites it`,
      ]);
    });

    it('#142 2: an acceptance line with only a unit row that cites it fails', () => {
      unitTest('F-2601 AC-12: x');
      tagged('F-2601.AC-12\tacceptance\t');
      deepStrictEqual(problems(), [
        `${COVERAGE_FILE}:00002: F-2601.AC-12 is tagged acceptance and no acceptance row cites it`,
      ]);
    });

    it('#142 2: a unit line and a unit row that cites it pass', () => {
      unitTest('F-2601 AC-12: x');
      tagged('F-2601.AC-12\tunit\t');
      deepStrictEqual(problems(), []);
    });

    it('#142 2: a unit line with only an acceptance row that cites it passes', () => {
      acceptanceTest('F-2601 AC-12: x');
      tagged('F-2601.AC-12\tunit\t');
      deepStrictEqual(problems(), []);
    });

    it('#142 2: a unit line no row cites fails', () => {
      tagged('F-2601.AC-12\tunit\t');
      deepStrictEqual(problems(), [
        `${COVERAGE_FILE}:00002: F-2601.AC-12 is tagged unit and no row cites it`,
      ]);
    });

    it('#142 2: a row that cites two criteria satisfies two acceptance lines', () => {
      acceptanceTest('F-2601 AC-1, AC-3: x');
      tagged('F-2601.AC-1\tacceptance\t', 'F-2601.AC-3\tacceptance\t');
      deepStrictEqual(problems(), []);
    });

    it('#142 2: a cites field of the failure suite satisfies an acceptance line', () => {
      workspace.write('tests/acceptance/suite-failure/cases.json', {
        cases: [{cite: 'F-2601 AC-6'}, {alias: 'no cite'}],
      });
      tagged('F-2601.AC-6\tacceptance\t');
      deepStrictEqual(problems(), []);
    });

    it('#142 2: a cases file with no list of cases cites nothing', () => {
      workspace.write('tests/acceptance/suite-failure/cases.json', {});
      tagged('F-2601.AC-6\tacceptance\t');
      deepStrictEqual(problems(), [
        `${COVERAGE_FILE}:00002: F-2601.AC-6 is tagged acceptance and no acceptance row cites it`,
      ]);
    });

    it('#142 2: a row that cites a criterion the file lacks fails', () => {
      acceptanceTest('F-2601 AC-99: x');
      tagged('F-2601.AC-1\ttodo\t');
      deepStrictEqual(problems(), [
        `tests/acceptance/server/x.test.ts: row "F-2601 AC-99: x" cites F-2601.AC-99, which the slice's file doesn't have`,
      ]);
    });

    it('#142 2: a row that cites a criterion of a feature outside the slice passes', () => {
      acceptanceTest('F-2407 AC-1: x');
      tagged('F-2601.AC-1\ttodo\t');
      deepStrictEqual(problems(), []);
    });

    it('#142 2: a unit row that cites a criterion the file lacks fails too', () => {
      unitTest('F-2601 AC-99: x');
      tagged('F-2601.AC-1\ttodo\t');
      deepStrictEqual(problems().length, 1);
    });

    it('#142 2: a name with a double quote is read whole', () => {
      workspace.write(
        'tests/acceptance/server/x.test.ts',
        'it("F-2601 AC-1: says \\"hi\\"", () => {});',
      );
      tagged('F-2601.AC-1\tacceptance\t');
      deepStrictEqual(problems(), []);
    });

    it('#142 4: a unit template name is read by the text before its placeholder', () => {
      workspace.write(
        'packages/remote-x/test/unit/x.test.ts',
        'it(`F-2601 AC-12: case ${name}`, () => {});',
      );
      tagged('F-2601.AC-12\tunit\t');
      deepStrictEqual(problems(), []);
    });

    it('#142 4: an acceptance template name cites its criteria before the placeholder', () => {
      workspace.write(
        'tests/acceptance/server/x.test.ts',
        'it(`F-2601 AC-1, AC-3: ${text}`, () => {});',
      );
      tagged('F-2601.AC-1\tacceptance\t', 'F-2601.AC-3\tacceptance\t');
      deepStrictEqual(problems(), []);
    });

    it('#142 4: a template name that starts with a placeholder cites nothing', () => {
      workspace.write(
        'packages/remote-x/test/unit/x.test.ts',
        'it(`${name}: something`, () => {});',
      );
      tagged('F-2601.AC-1\ttodo\t');
      deepStrictEqual(problems(), []);
    });

    it('#142 4: an acceptance template name with a placeholder in the number fails', () => {
      workspace.write(
        'tests/acceptance/server/x.test.ts',
        'it(`F-2409.AC-${n}: x`, () => {});',
      );
      tagged('F-2409.AC-1\ttodo\t');
      deepStrictEqual(problems(), [
        'tests/acceptance/server/x.test.ts: row "F-2409.AC-${" names F-2409 without an AC',
      ]);
    });

    it('triton on #475: a template name whose placeholder starts on the next line is read to it', () => {
      workspace.write(
        'packages/remote-x/test/unit/x.test.ts',
        'it(`F-2601 AC-12: case ${\nname}`, () => {});',
      );
      tagged('F-2601.AC-12\tunit\t');
      deepStrictEqual(problems(), []);
    });

    it('triton on #475: a template name with a placeholder right after a digit cites nothing', () => {
      workspace.write(
        'packages/remote-x/test/unit/x.test.ts',
        'it(`F-2601 AC-1${n}: x`, () => {});',
      );
      tagged('F-2601.AC-1\tunit\t');
      deepStrictEqual(problems(), [
        `${COVERAGE_FILE}:00002: F-2601.AC-1 is tagged unit and no row cites it`,
      ]);
    });

    it('#142 4: a unit template name with a placeholder in the number passes', () => {
      workspace.write(
        'packages/remote-x/test/unit/x.test.ts',
        'it(`F-2409.AC-${n}: x`, () => {});',
      );
      tagged('F-2409.AC-1\ttodo\t');
      deepStrictEqual(problems(), []);
    });

    it('#142 2: a name in a template literal with no placeholder is read', () => {
      workspace.write(
        'tests/acceptance/server/x.test.ts',
        'it(`F-2601 AC-1: x`, () => {});',
      );
      tagged('F-2601.AC-1\tacceptance\t');
      deepStrictEqual(problems(), []);
    });

    it('#142 2: a test file under node_modules is not read', () => {
      workspace.write(
        'tests/acceptance/node_modules/x/y.test.ts',
        "it('F-2601 AC-99: x', () => {});",
      );
      tagged('F-2601.AC-1\ttodo\t');
      deepStrictEqual(problems(), []);
    });

    it('#142 2: a file that is not a test file is not read', () => {
      workspace.write(
        'tests/acceptance/server/helper.ts',
        "it('F-2601 AC-99: x', () => {});",
      );
      tagged('F-2601.AC-1\ttodo\t');
      deepStrictEqual(problems(), []);
    });
  });

  describe('a row that names a feature without a criterion', () => {
    it('athena on #465: an acceptance row F-2409: fails', () => {
      acceptanceTest('F-2409: picks a free port');
      tagged('F-2601.AC-1\ttodo\t');
      deepStrictEqual(problems(), [
        'tests/acceptance/server/x.test.ts: row "F-2409: picks a free port" names F-2409 without an AC',
      ]);
    });

    it('athena on #465: an acceptance row F-2409.BR-7: fails', () => {
      acceptanceTest('F-2409.BR-7: x');
      tagged('F-2601.AC-1\ttodo\t');
      deepStrictEqual(problems().length, 1);
    });

    it('athena on #465: an acceptance row F-2601 5.0: fails', () => {
      acceptanceTest('F-2601 5.0: x');
      tagged('F-2601.AC-1\ttodo\t');
      deepStrictEqual(problems().length, 1);
    });

    it('athena on #465: a cite of the failure suite that is a feature alone fails', () => {
      workspace.write('tests/acceptance/suite-failure/cases.json', {
        cases: [{cite: 'F-2601'}],
      });
      tagged('F-2601.AC-1\ttodo\t');
      deepStrictEqual(problems(), [
        'tests/acceptance/suite-failure/cases.json: row "F-2601" names F-2601 without an AC',
      ]);
    });

    it('daedalus on #546: a bound cite counts, so its acceptance line is cited', () => {
      workspace.write('tests/acceptance/suite-failure/cases.json', {
        cases: [
          {bound: {from: 'progress', milliseconds: 2000, cite: 'F-2304 AC-22'}},
        ],
      });
      tagged('F-2304.AC-22\tacceptance\t');
      deepStrictEqual(problems(), []);
    });

    it('athena on #465: an acceptance row of a feature outside the slice passes', () => {
      acceptanceTest('F-2407: x');
      tagged('F-2601.AC-1\ttodo\t');
      deepStrictEqual(problems(), []);
    });

    it('athena on #465: an acceptance row that starts with contracts passes', () => {
      acceptanceTest('contracts V7: x');
      tagged('F-2601.AC-1\ttodo\t');
      deepStrictEqual(problems(), []);
    });

    it('athena on #465: a unit row F-2409: passes', () => {
      unitTest('F-2409: x');
      tagged('F-2601.AC-1\ttodo\t');
      deepStrictEqual(problems(), []);
    });
  });

  describe('citedBy', () => {
    it('#142 2: F-2601 AC-12: cites AC-12', () => {
      deepStrictEqual(citedBy('F-2601 AC-12: x'), ['F-2601.AC-12']);
    });

    it('#142 2: F-2601.AC-12: cites AC-12 the same', () => {
      deepStrictEqual(citedBy('F-2601.AC-12: x'), ['F-2601.AC-12']);
    });

    it('#142 2: F-2601 AC-1, AC-3: cites both', () => {
      deepStrictEqual(citedBy('F-2601 AC-1, AC-3: x'), [
        'F-2601.AC-1',
        'F-2601.AC-3',
      ]);
    });

    it('#142 2: a list of three cites three', () => {
      deepStrictEqual(citedBy('F-2601 AC-1, AC-2,AC-3: x'), [
        'F-2601.AC-1',
        'F-2601.AC-2',
        'F-2601.AC-3',
      ]);
    });

    it('#142 2: a cite alone, as a cases file gives it, cites its criterion', () => {
      deepStrictEqual(citedBy('F-2601 AC-6'), ['F-2601.AC-6']);
    });

    it('#142 2: F-2601: cites nothing', () => {
      deepStrictEqual(citedBy('F-2601: x'), []);
    });

    it('#142 2: contracts V7: cites nothing', () => {
      deepStrictEqual(citedBy('contracts V7: x'), []);
    });

    it('#142 2: a name with no feature id cites nothing', () => {
      deepStrictEqual(citedBy('refuses a reversed range'), []);
    });

    it('#142 2: a name that only mentions a criterion later cites nothing', () => {
      deepStrictEqual(citedBy('see F-2601 AC-1: x'), []);
    });

    it('daedalus on #546: a two-feature cite cites each feature, the second with its own list', () => {
      deepStrictEqual(citedBy('F-2601 AC-6, F-2304 AC-14, AC-27'), [
        'F-2601.AC-6',
        'F-2304.AC-14',
        'F-2304.AC-27',
      ]);
    });

    it('daedalus on #546: a cite with a lower-case label then a colon cites its feature', () => {
      deepStrictEqual(
        citedBy('F-2206 AC-16 (platform-out-of-enum-solaris): x'),
        ['F-2206.AC-16'],
      );
    });

    it('daedalus on #546: a label with no AC before it cites nothing', () => {
      deepStrictEqual(citedBy('F-2206 (solaris): x'), []);
    });

    it('daedalus on #546: an upper-case or spaced label is not a label', () => {
      deepStrictEqual(
        [citedBy('F-2206 AC-1 (Foo):'), citedBy('F-2601 AC-1 (bad label): x')],
        [[], []],
      );
    });
  });
});
