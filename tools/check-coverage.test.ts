import {deepStrictEqual, strictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {
  checkCoverage,
  citedBy,
  COVERAGE_FILE,
  type CoverageReport,
  outputOf,
  tableOf,
} from './check-coverage.ts';
import {REPOSITORY_ROOT} from './repository.ts';
import {
  CONTAINERS_RELEASE_ONE_SCOPE,
  COVERAGE_SCOPES,
  EXPLORER_SLICE_ONE_SCOPE,
  EXTENSIONPACK_RELEASE_ONE_SCOPE,
  SLICE_ONE_SCOPE,
} from './spec-acceptance-criteria.ts';
import {TemporaryWorkspace} from './temporary-workspace.ts';

const HEADER = 'ac\ttag\treason\n';

/** The first slice's file alone, as most rows check it. */
const SLICE_ONLY = [SLICE_ONE_SCOPE];

/** Both coverage files. */
const BOTH = [SLICE_ONE_SCOPE, CONTAINERS_RELEASE_ONE_SCOPE];

/** Where the containers file lies. */
const CONTAINERS_FILE = CONTAINERS_RELEASE_ONE_SCOPE.file;

/** The problems or the notes of a report, or the way it failed. */
function reportMember(
  report: CoverageReport,
  member: 'problems' | 'notes',
): string[] {
  return report.kind === 'checked' ? report[member] : [report.kind];
}

/** The problems of a report, or the way it failed. */
function problemsOf(report: CoverageReport): string[] {
  return reportMember(report, 'problems');
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
    return problemsOf(checkCoverage(workspace.root, SLICE_ONLY));
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
      deepStrictEqual(
        outputOf(checkCoverage(workspace.root, SLICE_ONLY)).lines.slice(-7),
        [
          `${COVERAGE_FILE}:`,
          'acceptance: 0',
          'unit: 0',
          'recorded: 0',
          'core: 1',
          'deferred: 0',
          'todo: 2',
        ],
      );
    });

    it('#142 1: a passing check exits 0', () => {
      tagged('F-2601.AC-1\ttodo\t');
      strictEqual(
        outputOf(checkCoverage(workspace.root, SLICE_ONLY)).exitCode,
        0,
      );
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
        `${COVERAGE_FILE}:00002: F-2601.AC-1 has a reason, which is only for core, deferred or open`,
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
      strictEqual(
        outputOf(checkCoverage(workspace.root, SLICE_ONLY)).exitCode,
        2,
      );
    });

    it('#142: a missing file names itself', () => {
      deepStrictEqual(
        outputOf(checkCoverage(workspace.root, SLICE_ONLY)).lines,
        [`check-coverage: cannot read ${COVERAGE_FILE}`],
      );
    });

    it('#142: problems make the exit code 1', () => {
      tagged('F-2601.AC-1\tdone\t');
      strictEqual(
        outputOf(checkCoverage(workspace.root, SLICE_ONLY)).exitCode,
        1,
      );
    });

    it('#142: two problems are both printed, sorted', () => {
      tagged('F-2601.AC-2\tdone\t', 'F-2601.AC-1\tcore\t');
      deepStrictEqual(
        outputOf(checkCoverage(workspace.root, SLICE_ONLY)).lines.slice(0, 2),
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

    it('#142 2: a cites field of the ports suite satisfies an acceptance line', () => {
      workspace.write('tests/acceptance/suite-ports/cases.json', {
        cases: [{cite: 'F-2601 AC-6 (probe)'}, {label: 'no cite'}],
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
        `tests/acceptance/server/x.test.ts: row "F-2601 AC-99: x" cites F-2601.AC-99, which ${COVERAGE_FILE} doesn't have`,
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

  describe('a todo line a row already cites (card tooling-65)', () => {
    /** The notes of the slice-1 check, or the way it failed. */
    function notesOf(): string[] {
      return reportMember(checkCoverage(workspace.root, SLICE_ONLY), 'notes');
    }

    it('tooling-65: a todo line an acceptance row cites gets the note', () => {
      tagged('F-2601.AC-1\ttodo\t');
      acceptanceTest('F-2601 AC-1: x');
      deepStrictEqual(notesOf(), [
        `${COVERAGE_FILE}:00002: F-2601.AC-1 is todo and an acceptance row cites it`,
      ]);
    });

    it('tooling-65: a todo line a unit row alone cites gets the unit note', () => {
      tagged('F-2601.AC-1\ttodo\t');
      unitTest('F-2601 AC-1: x');
      deepStrictEqual(notesOf(), [
        `${COVERAGE_FILE}:00002: F-2601.AC-1 is todo and a unit row cites it`,
      ]);
    });

    it('tooling-65: a todo line no row cites gets no note', () => {
      tagged('F-2601.AC-1\ttodo\t');
      deepStrictEqual(notesOf(), []);
    });

    it('tooling-65: a deferred, an acceptance and a unit line get no problem and no note', () => {
      tagged(
        'F-2601.AC-1\tdeferred\tD-51',
        'F-2601.AC-2\tacceptance\t',
        'F-2601.AC-3\tunit\t',
      );
      acceptanceTest('F-2601 AC-2: x');
      unitTest('F-2601 AC-3: x');
      deepStrictEqual([problems(), notesOf()], [[], []]);
    });

    it('tooling-65: a note alone keeps the exit 0', () => {
      tagged('F-2601.AC-1\ttodo\t');
      acceptanceTest('F-2601 AC-1: x');
      strictEqual(
        outputOf(checkCoverage(workspace.root, SLICE_ONLY)).exitCode,
        0,
      );
    });

    it('tooling-65: outputOf puts the note after the problems and before the counts, prefixed note: ', () => {
      tagged('F-2601.AC-1\ttodo\t', 'F-2601.AC-2\tacceptance\t');
      acceptanceTest('F-2601 AC-1: x');
      deepStrictEqual(
        outputOf(checkCoverage(workspace.root, SLICE_ONLY)).lines,
        [
          `${COVERAGE_FILE}:00003: F-2601.AC-2 is tagged acceptance and no acceptance row cites it`,
          `note: ${COVERAGE_FILE}:00002: F-2601.AC-1 is todo and an acceptance row cites it`,
          `${COVERAGE_FILE}:`,
          'acceptance: 1',
          'unit: 0',
          'recorded: 0',
          'core: 0',
          'deferred: 0',
          'todo: 1',
        ],
      );
    });

    it('tooling-65: a note does not change the exit 1 of a problem', () => {
      tagged('F-2601.AC-1\ttodo\t', 'F-2601.AC-2\tacceptance\t');
      acceptanceTest('F-2601 AC-1: x');
      strictEqual(
        outputOf(checkCoverage(workspace.root, SLICE_ONLY)).exitCode,
        1,
      );
    });
  });

  describe('an open line (card tooling-39)', () => {
    function notesOf(): string[] {
      return reportMember(checkCoverage(workspace.root, SLICE_ONLY), 'notes');
    }

    /** The count of acceptance lines the report gives. */
    function acceptanceCount(): string | undefined {
      return outputOf(checkCoverage(workspace.root, SLICE_ONLY)).lines.find(
        line => line.startsWith('acceptance: '),
      );
    }

    it('tooling-39: an open line whose named rows all exist counts as acceptance', () => {
      acceptanceTest('F-2601 AC-1 (first): x', 'F-2601 AC-1 (second): y');
      tagged('F-2601.AC-1\topen\t(first), (second)');
      deepStrictEqual(
        [problems(), notesOf(), acceptanceCount()],
        [[], [], 'acceptance: 1'],
      );
    });

    it('tooling-39: an open line with a named row missing counts as todo and a note names the row', () => {
      acceptanceTest('F-2601 AC-1 (first): x');
      tagged('F-2601.AC-1\topen\t(first), (second)');
      deepStrictEqual(
        [problems(), notesOf(), acceptanceCount()],
        [
          [],
          [
            `${COVERAGE_FILE}:00002: F-2601.AC-1 is open and still counts as todo: no acceptance row cites it as (second)`,
          ],
          'acceptance: 0',
        ],
      );
    });

    it('tooling-39: a named row that is a unit row does not count', () => {
      unitTest('F-2601 AC-1 (first): x');
      tagged('F-2601.AC-1\topen\t(first)');
      deepStrictEqual(acceptanceCount(), 'acceptance: 0');
    });

    it('tooling-39: a named row that is skipped is not seen, so it is missing', () => {
      workspace.write(
        'tests/acceptance/server/x.test.ts',
        "it.skip('F-2601 AC-1 (first): x', () => {});",
      );
      tagged('F-2601.AC-1\topen\t(first)');
      deepStrictEqual(acceptanceCount(), 'acceptance: 0');
    });

    it('tooling-39: an open line that names no row fails', () => {
      tagged('F-2601.AC-1\topen\t');
      deepStrictEqual(problems(), [
        `${COVERAGE_FILE}:00002: F-2601.AC-1 needs a reason`,
      ]);
    });

    it('tooling-39: an open line whose reason names no case label fails', () => {
      tagged('F-2601.AC-1\topen\tthe rows');
      deepStrictEqual(problems(), [
        `${COVERAGE_FILE}:00002: F-2601.AC-1 is open and names no row`,
      ]);
    });

    it('tooling-39: an open line that names a -half row fails', () => {
      acceptanceTest('F-2601 AC-1 (image-half): x');
      tagged('F-2601.AC-1\topen\t(image-half)');
      deepStrictEqual(problems(), [
        `${COVERAGE_FILE}:00002: F-2601.AC-1 names (image-half), whose label marks a part of the criterion`,
      ]);
    });

    it('tooling-39: a -half row that cites an open line is not counted and is no problem', () => {
      acceptanceTest('F-2601 AC-1 (first): x', 'F-2601 AC-1 (own-half): y');
      tagged('F-2601.AC-1\topen\t(first)');
      deepStrictEqual([problems(), acceptanceCount()], [[], 'acceptance: 1']);
    });

    it('tooling-39: a -part row that cites an open line is no problem', () => {
      acceptanceTest('F-2601 AC-1 (first): x', 'F-2601 AC-1 (own-part): y');
      tagged('F-2601.AC-1\topen\t(first)');
      deepStrictEqual(problems(), []);
    });

    it('tooling-39: a row that cites an open line with another partial wording fails', () => {
      acceptanceTest('F-2601 AC-1 (first): x', 'F-2601 AC-1 (only-image): y');
      tagged('F-2601.AC-1\topen\t(first)');
      deepStrictEqual(problems(), [
        'tests/acceptance/server/x.test.ts: row "F-2601 AC-1 (only-image): y" cites F-2601.AC-1, which is open, with a case label that marks a part: end it in -half or -part',
      ]);
    });

    it('tooling-39: a row with a partial wording that cites a line that is not open is no problem', () => {
      acceptanceTest('F-2601 AC-1 (only-image): y');
      tagged('F-2601.AC-1\ttodo\t');
      deepStrictEqual(problems(), []);
    });

    it('tooling-39: a unit row with a partial wording that cites an open line fails too', () => {
      acceptanceTest('F-2601 AC-1 (first): x');
      unitTest('F-2601 AC-1 (clause-two): y');
      tagged('F-2601.AC-1\topen\t(first)');
      deepStrictEqual(problems().length, 1);
    });

    it('tooling-39: the table gives each criterion its tag and, for an open line, the rows that decide it', () => {
      acceptanceTest('F-2601 AC-1 (first): x');
      tagged('F-2601.AC-1\topen\t(first)', 'F-2601.AC-2\ttodo\t');
      deepStrictEqual(tableOf(workspace.root, SLICE_ONLY), [
        `${COVERAGE_FILE}:`,
        'F-2601.AC-1\tacceptance\ttests/acceptance/server/x.test.ts: F-2601 AC-1 (first): x',
        'F-2601.AC-2\ttodo',
      ]);
    });

    it('tooling-39: the table of a repository without the first slice names the file', () => {
      deepStrictEqual(tableOf(workspace.root, SLICE_ONLY), [
        `check-coverage: cannot read ${COVERAGE_FILE}`,
      ]);
    });
  });

  describe('a criterion with a letter', () => {
    it('containers release 1: AC-3, AC-3b, AC-4 is in order', () => {
      tagged(
        'F-2601.AC-3\ttodo\t',
        'F-2601.AC-3b\ttodo\t',
        'F-2601.AC-4\ttodo\t',
      );
      deepStrictEqual(problems(), []);
    });

    it('containers release 1: AC-3b before AC-3 fails as out of order', () => {
      tagged('F-2601.AC-3b\ttodo\t', 'F-2601.AC-3\ttodo\t');
      deepStrictEqual(problems(), [
        `${COVERAGE_FILE}:00003: F-2601.AC-3 is out of order`,
      ]);
    });

    it('containers release 1: AC-3c before AC-3b fails as out of order', () => {
      tagged('F-2601.AC-3c\ttodo\t', 'F-2601.AC-3b\ttodo\t');
      deepStrictEqual(problems(), [
        `${COVERAGE_FILE}:00003: F-2601.AC-3b is out of order`,
      ]);
    });

    it('containers release 1: an upper-case letter is out of form', () => {
      tagged('F-2601.AC-3B\ttodo\t');
      deepStrictEqual(problems(), [
        `${COVERAGE_FILE}:00002: AC id out of form: F-2601.AC-3B`,
      ]);
    });

    it('containers release 1: a row that cites AC-3b satisfies its acceptance line', () => {
      acceptanceTest('F-2601 AC-3b: x');
      tagged('F-2601.AC-3b\tacceptance\t');
      deepStrictEqual(problems(), []);
    });
  });

  describe('two coverage files', () => {
    /** Writes the containers file with these lines under the header. */
    function containersTagged(...lines: string[]): void {
      workspace.write(CONTAINERS_FILE, `${HEADER}${lines.join('\n')}\n`);
    }

    function bothProblems(): string[] {
      return problemsOf(checkCoverage(workspace.root, BOTH));
    }

    it('containers release 1: both files with todo lines pass', () => {
      tagged('F-2601.AC-1\ttodo\t');
      containersTagged('F-0101.AC-1\ttodo\t');
      deepStrictEqual(bothProblems(), []);
    });

    it('coverage-25a: a workspace with the slice-1 file only checks it, the other sets skipped', () => {
      tagged('F-2601.AC-1\ttodo\t');
      deepStrictEqual(outputOf(checkCoverage(workspace.root)).lines, [
        `${COVERAGE_FILE}:`,
        'acceptance: 0',
        'unit: 0',
        'recorded: 0',
        'core: 0',
        'deferred: 0',
        'todo: 1',
      ]);
    });

    it('containers release 1: a problem of the second file names it', () => {
      tagged('F-2601.AC-1\ttodo\t');
      containersTagged('F-0101.AC-1\tdone\t');
      deepStrictEqual(bothProblems(), [
        `${CONTAINERS_FILE}:00002: unknown tag: done`,
      ]);
    });

    it('containers release 1: a row that cites a containers criterion the containers file lacks fails, naming it', () => {
      unitTest('F-0101 AC-99: x');
      tagged('F-2601.AC-1\ttodo\t');
      containersTagged('F-0101.AC-1\ttodo\t');
      deepStrictEqual(bothProblems(), [
        `packages/remote-x/test/unit/x.test.ts: row "F-0101 AC-99: x" cites F-0101.AC-99, which ${CONTAINERS_FILE} doesn't have`,
      ]);
    });

    it('containers release 1: an acceptance row that names a containers feature without an AC fails', () => {
      acceptanceTest('F-0101: x');
      tagged('F-2601.AC-1\ttodo\t');
      containersTagged('F-0101.AC-1\ttodo\t');
      deepStrictEqual(bothProblems(), [
        'tests/acceptance/server/x.test.ts: row "F-0101: x" names F-0101 without an AC',
      ]);
    });

    it('containers release 1: a containers line tagged unit is satisfied by a unit row', () => {
      unitTest('F-0101 AC-17b: x');
      tagged('F-2601.AC-1\ttodo\t');
      containersTagged('F-0101.AC-17b\tunit\t');
      deepStrictEqual(bothProblems(), []);
    });

    it('containers release 1: the counts are printed per file', () => {
      tagged('F-2601.AC-1\ttodo\t');
      containersTagged('F-0101.AC-1\tcore\twhy', 'F-0101.AC-2\ttodo\t');
      deepStrictEqual(outputOf(checkCoverage(workspace.root, BOTH)).lines, [
        `${COVERAGE_FILE}:`,
        'acceptance: 0',
        'unit: 0',
        'recorded: 0',
        'core: 0',
        'deferred: 0',
        'todo: 1',
        `${CONTAINERS_FILE}:`,
        'acceptance: 0',
        'unit: 0',
        'recorded: 0',
        'core: 1',
        'deferred: 0',
        'todo: 1',
      ]);
    });
  });

  describe('the explorer coverage file', () => {
    const EXPLORER_FILE = EXPLORER_SLICE_ONE_SCOPE.file;

    const EXPLORER_SETS = [SLICE_ONE_SCOPE, EXPLORER_SLICE_ONE_SCOPE];

    /** Writes the explorer file with these lines under the header. */
    function explorerTagged(...lines: string[]): void {
      workspace.write(EXPLORER_FILE, `${HEADER}${lines.join('\n')}\n`);
    }

    function explorerProblems(): string[] {
      return problemsOf(checkCoverage(workspace.root, EXPLORER_SETS));
    }

    it("coverage-25a: a deferred line whose reason is not one of the set's fails, naming it", () => {
      tagged('F-2601.AC-1\ttodo\t');
      explorerTagged('F-5101.AC-1\tdeferred\tlater');
      deepStrictEqual(explorerProblems(), [
        `${EXPLORER_FILE}:00002: F-5101.AC-1 gives the reason "later", which isn't one of the set's`,
      ]);
    });

    it("coverage-25a: a deferred line with one of the set's reasons passes", () => {
      tagged('F-2601.AC-1\ttodo\t');
      explorerTagged('F-5101.AC-1\tdeferred\tD-55: no tunnel rows');
      deepStrictEqual(explorerProblems(), []);
    });

    it('coverage-25a: an acceptance row that cites an explorer criterion the explorer file lacks fails, naming it', () => {
      acceptanceTest('F-5101 AC-1: x');
      tagged('F-2601.AC-1\ttodo\t');
      explorerTagged('F-5101.AC-2\ttodo\t');
      deepStrictEqual(explorerProblems(), [
        `tests/acceptance/server/x.test.ts: row "F-5101 AC-1: x" cites F-5101.AC-1, which ${EXPLORER_FILE} doesn't have`,
      ]);
    });

    it('coverage-25a: no feature is in two coverage sets', () => {
      const features = COVERAGE_SCOPES.flatMap(scope => scope.features);
      strictEqual(new Set(features).size, features.length);
    });

    it('coverage-25a: the repository check reads every coverage file, and the total of the last one is its line count', () => {
      const report = checkCoverage(REPOSITORY_ROOT);
      const counts = report.kind === 'checked' ? report.counts : [];
      const last = counts.at(-1);
      const lines = readFileSync(
        path.join(REPOSITORY_ROOT, EXTENSIONPACK_RELEASE_ONE_SCOPE.file),
        'utf8',
      )
        .trim()
        .split('\n')
        .slice(1).length;
      deepStrictEqual(
        {
          kind: report.kind,
          files: counts.map(each => each.file),
          totalIsLineCount:
            last === undefined
              ? false
              : Object.values(last.counts).reduce(
                  (total, count) => total + count,
                  0,
                ) === lines,
        },
        {
          kind: 'checked',
          files: COVERAGE_SCOPES.map(scope => scope.file),
          totalIsLineCount: true,
        },
      );
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

    it('containers release 1: F-0101 AC-17b: cites AC-17b', () => {
      deepStrictEqual(citedBy('F-0101 AC-17b: x'), ['F-0101.AC-17b']);
    });

    it('containers release 1: F-0101 AC-3, AC-3b: cites both', () => {
      deepStrictEqual(citedBy('F-0101 AC-3, AC-3b: x'), [
        'F-0101.AC-3',
        'F-0101.AC-3b',
      ]);
    });

    it('daedalus on #546: an upper-case or spaced label is not a label', () => {
      deepStrictEqual(
        [citedBy('F-2206 AC-1 (Foo):'), citedBy('F-2601 AC-1 (bad label): x')],
        [[], []],
      );
    });
  });
});
