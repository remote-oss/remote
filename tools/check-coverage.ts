/**
 * @fileoverview check-coverage: keeps the acceptance criteria of the first slice, one tag each in one file, and the
 * names of the tests in agreement.
 *
 *     node tools/check-coverage.ts
 *
 * The file is docs/architecture/catalogue/coverage-slice1.tsv: `ac`, `tag`, `reason` per line. A test row proves the
 * criteria its name starts with (a feature id, `AC-` and a number, then a colon). The check fails when a line is malformed, when a tag asks for a
 * kind of row that does not cite the criterion, when a row cites a criterion the file does not have, or when an
 * acceptance row of the slice names a feature and no criterion. It prints how many criteria each tag holds. Exit 0 when it passes, 1
 * with problems, 2 when the file cannot be read.
 */

import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {
  isMainModule,
  messageOf,
  REPOSITORY_ROOT,
  sortedEntries,
} from './repository.ts';
import {SLICE_ONE_FEATURES} from './spec-acceptance-criteria.ts';

/** Where the file lies under the repository root. */
export const COVERAGE_FILE = path.join(
  'docs',
  'architecture',
  'catalogue',
  'coverage-slice1.tsv',
);

/** The tags of a criterion, `todo` meaning not tagged yet. */
const TAGS = [
  'acceptance',
  'unit',
  'recorded',
  'core',
  'deferred',
  'todo',
] as const;

type Tag = (typeof TAGS)[number];

/** The tags whose line must say why. */
const REASON_TAGS: readonly string[] = ['core', 'deferred'];

const AC_PATTERN = /^(F-\d{4})\.AC-(\d+)$/;

/** The criteria a name or cite starts with: a feature id, then `AC-1`, or a list `AC-1, AC-3`, after a space or a dot. */
const CITE_PATTERN = /^(F-\d{4})(?: |\.)AC-(\d+)((?:, ?AC-\d+)*)(?::|$)/;

/** What the check found. */
export type CoverageReport =
  | {kind: 'unreadable'; file: string}
  | {kind: 'checked'; problems: string[]; counts: Record<Tag, number>};

/** One test row: where it is, its name, and whether it is an acceptance row. */
interface Row {
  file: string;
  name: string;
  acceptance: boolean;
}

/** The criterion ids a name or cite starts with, or none for a name that cites nothing. */
export function citedBy(name: string): string[] {
  const match = CITE_PATTERN.exec(name);
  if (match === null) {
    return [];
  }
  const [, feature, first, rest] = match;
  const numbers = [
    first,
    ...[...(rest ?? '').matchAll(/AC-(\d+)/g)].map(each => each[1]),
  ];
  return numbers.map(number => `${String(feature)}.AC-${String(number)}`);
}

/** The test files under `folder` whose names end in `.test.ts`, skipping what is installed or built. */
function testFilesUnder(folder: string): string[] {
  if (!existsSync(folder)) {
    return [];
  }
  return sortedEntries(folder).flatMap(entry => {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      return ['node_modules', 'dist', '.tsc'].some(skipped =>
        entry.name.startsWith(skipped),
      )
        ? []
        : testFilesUnder(full);
    }
    return entry.name.endsWith('.test.ts') ? [full] : [];
  });
}

/** Undoes the escapes of a quoted name. */
function unescaped(text: string): string {
  return text.replace(/\\(.)/g, '$1');
}

/**
 * An `it(` and its name: a quoted name on one line, or a template literal up to its first placeholder, which stays in the name
 * as `${`, or up to its closing backtick, with no newline needed before either.
 */
const NAME_PATTERN =
  /\bit\(\s*(?:(['"])((?:\\.|(?!\1)[^\\\n])*)\1|`((?:\\.|[^\\`$]|\$(?!\{))*)(\$\{)?)/g;

/** The names of the `it(` rows of a file; a template literal with a placeholder is read as the text up to the first one, the `${` included. */
function rowNamesOf(source: string): string[] {
  return [...source.matchAll(NAME_PATTERN)].map(
    match => unescaped(match[2] ?? match[3] ?? '') + (match[4] ?? ''),
  );
}

/** The `cite` fields of the failure suite's cases file. */
function casesCites(file: string): string[] {
  if (!existsSync(file)) {
    return [];
  }
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
    cases?: Array<{cite?: unknown}>;
  };
  return (parsed.cases ?? []).flatMap(each =>
    typeof each.cite === 'string' ? [each.cite] : [],
  );
}

/** Every test row of the repository: the acceptance rows, the failure suite's cites, and the unit rows. */
function rowsOf(root: string): Row[] {
  const rows: Row[] = [];
  const acceptance = path.join(root, 'tests', 'acceptance');
  for (const file of testFilesUnder(acceptance)) {
    for (const name of rowNamesOf(readFileSync(file, 'utf8'))) {
      rows.push({file: path.relative(root, file), name, acceptance: true});
    }
  }
  const cases = path.join(acceptance, 'suite-failure', 'cases.json');
  for (const name of casesCites(cases)) {
    rows.push({file: path.relative(root, cases), name, acceptance: true});
  }
  const packages = path.join(root, 'packages');
  if (existsSync(packages)) {
    for (const entry of sortedEntries(packages)) {
      const unit = path.join(packages, entry.name, 'test', 'unit');
      for (const file of testFilesUnder(unit)) {
        for (const name of rowNamesOf(readFileSync(file, 'utf8'))) {
          rows.push({file: path.relative(root, file), name, acceptance: false});
        }
      }
    }
  }
  return rows;
}

/** A criterion line of the file. */
interface Line {
  number: number;
  id: string;
  feature: string;
  index: number;
  tagName: string;
  reason: string;
}

/** Orders two lines by feature, then by criterion number. */
function before(left: Line, right: Line): boolean {
  return left.feature === right.feature
    ? left.index < right.index
    : left.feature < right.feature;
}

/** The place of a line in a report; the number is padded so that a sorted report keeps the file's order. */
function place(number: number): string {
  return `${COVERAGE_FILE}:${String(number).padStart(5, '0')}`;
}

/** Reads the lines of the file, reporting the malformed ones. */
function linesOf(text: string, problems: string[]): Line[] {
  const lines: Line[] = [];
  const seen = new Set<string>();
  let previous: Line | undefined;
  text
    .split('\n')
    .slice(1)
    .forEach((content, offset) => {
      const number = offset + 2;
      if (content === '') {
        return;
      }
      const fields = content.split('\t');
      if (fields.length !== 3) {
        problems.push(`${place(number)}: wrong number of fields`);
        return;
      }
      const [criterion = '', tagName = '', reason = ''] = fields;
      const match = AC_PATTERN.exec(criterion);
      if (match === null) {
        problems.push(`${place(number)}: AC id out of form: ${criterion}`);
        return;
      }
      if (!(TAGS as readonly string[]).includes(tagName)) {
        problems.push(`${place(number)}: unknown tag: ${tagName}`);
        return;
      }
      const line: Line = {
        number,
        id: criterion,
        feature: match[1] ?? '',
        index: Number(match[2]),
        tagName,
        reason,
      };
      if (seen.has(criterion)) {
        problems.push(`${place(number)}: ${criterion} is repeated`);
        return;
      }
      seen.add(criterion);
      if (previous !== undefined && !before(previous, line)) {
        problems.push(`${place(number)}: ${criterion} is out of order`);
      }
      previous = line;
      lines.push(line);
    });
  return lines;
}

/** Checks the tags of the lines against their reasons. */
function reasonProblems(lines: readonly Line[], problems: string[]): void {
  for (const line of lines) {
    const needs = REASON_TAGS.includes(line.tagName);
    if (needs && line.reason === '') {
      problems.push(`${place(line.number)}: ${line.id} needs a reason`);
    } else if (!needs && line.reason !== '') {
      problems.push(
        `${place(line.number)}: ${line.id} has a reason, which is only for core or deferred`,
      );
    }
  }
}

/** Checks what the tags promise against the rows that cite the criteria. */
function rowProblems(
  lines: readonly Line[],
  rows: readonly Row[],
  problems: string[],
): void {
  const known = new Set(lines.map(line => line.id));
  const acceptanceCited = new Set<string>();
  const unitCited = new Set<string>();
  for (const testRow of rows) {
    const cited = citedBy(testRow.name);
    for (const criterion of cited) {
      (testRow.acceptance ? acceptanceCited : unitCited).add(criterion);
      const feature = criterion.slice(0, 6);
      if (SLICE_ONE_FEATURES.includes(feature) && !known.has(criterion)) {
        problems.push(
          `${testRow.file}: row "${testRow.name}" cites ${criterion}, which the slice's file doesn't have`,
        );
      }
    }
    const named = /^(F-\d{4})\b/.exec(testRow.name)?.[1];
    if (
      testRow.acceptance &&
      cited.length === 0 &&
      named !== undefined &&
      SLICE_ONE_FEATURES.includes(named)
    ) {
      problems.push(
        `${testRow.file}: row "${testRow.name}" names ${named} without an AC`,
      );
    }
  }
  for (const line of lines) {
    if (line.tagName === 'acceptance' && !acceptanceCited.has(line.id)) {
      problems.push(
        `${place(line.number)}: ${line.id} is tagged acceptance and no acceptance row cites it`,
      );
    }
    if (
      line.tagName === 'unit' &&
      !unitCited.has(line.id) &&
      !acceptanceCited.has(line.id)
    ) {
      problems.push(
        `${place(line.number)}: ${line.id} is tagged unit and no row cites it`,
      );
    }
  }
}

/** Runs the check over the repository at `root`. */
export function checkCoverage(root: string): CoverageReport {
  const file = path.join(root, COVERAGE_FILE);
  if (!existsSync(file)) {
    return {kind: 'unreadable', file: COVERAGE_FILE};
  }
  const problems: string[] = [];
  const lines = linesOf(readFileSync(file, 'utf8'), problems);
  reasonProblems(lines, problems);
  rowProblems(lines, rowsOf(root), problems);
  const counts: Record<Tag, number> = {
    acceptance: 0,
    unit: 0,
    recorded: 0,
    core: 0,
    deferred: 0,
    todo: 0,
  };
  for (const line of lines) {
    counts[line.tagName as Tag] += 1;
  }
  return {kind: 'checked', problems: problems.sort(), counts};
}

/** The lines the command prints for a report, and its exit code. */
export function outputOf(report: CoverageReport): {
  lines: string[];
  exitCode: number;
} {
  if (report.kind === 'unreadable') {
    return {lines: [`check-coverage: cannot read ${report.file}`], exitCode: 2};
  }
  const counts = TAGS.map(name => `${name}: ${String(report.counts[name])}`);
  return {
    lines: [...report.problems, ...counts],
    exitCode: report.problems.length === 0 ? 0 : 1,
  };
}

if (isMainModule(import.meta.url)) {
  try {
    const {lines, exitCode} = outputOf(checkCoverage(REPOSITORY_ROOT));
    console.log(lines.join('\n'));
    process.exitCode = exitCode;
  } catch (error) {
    console.error(`check-coverage: ${messageOf(error)}`);
    process.exitCode = 2;
  }
}
