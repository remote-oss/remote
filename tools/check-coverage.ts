/**
 * @fileoverview check-coverage: keeps the acceptance criteria of each coverage file, one tag each, and the names of the
 * tests in agreement.
 *
 *     node tools/check-coverage.ts
 *
 * The files are those of `COVERAGE_SCOPES` under docs/architecture/catalogue (the first slice of Remote - SSH, Remote
 * - Containers release 1, and the first slice of Remote Explorer), each with its own features: `ac`, `tag`, `reason` per line. An id's number may end in
 * a lower-case letter (`AC-17b`). A test row proves the
 * criteria its name starts with (feature ids, each with its `AC-` numbers, after a space or a dot, in a `, `-separated list, then a colon). The check fails when a line is malformed, when a tag asks for a
 * kind of row that does not cite the criterion, when a row cites a criterion the file does not have, or when an
 * acceptance row names a feature of a file and no criterion. It prints how many criteria each tag holds, per file. Exit 0
 * when it passes, 1 with problems, 2 when a file cannot be read.
 */

import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {
  isMainModule,
  messageOf,
  REPOSITORY_ROOT,
  sortedEntries,
} from './repository.ts';
import {
  COVERAGE_SCOPES,
  type CoverageScope,
  SLICE_ONE_SCOPE,
} from './spec-acceptance-criteria.ts';

/** Where the first slice's file lies under the repository root. */
export const COVERAGE_FILE = SLICE_ONE_SCOPE.file;

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

/** The set whose missing file makes the check unreadable; the others' missing files are skipped. */
const READABLE_SET = 'slice1';

const AC_PATTERN = /^(F-\d{4})\.AC-(\d+)([a-z]?)$/;

/**
 * One feature's part of a cite: its id, then its criteria, `AC-1` or a list `AC-1, AC-3b`, after a space or a dot. A
 * number may end in a lower-case letter.
 */
const FEATURE_CITE = String.raw`F-\d{4}[ .]AC-\d+[a-z]?(?:, ?AC-\d+[a-z]?)*`;

/**
 * The criteria a name or cite starts with: one or more feature cites separated by `, `, then an optional lower-case case
 * label in parentheses, then a colon or the end.
 */
const CITE_PATTERN = new RegExp(
  `^(${FEATURE_CITE}(?:, ${FEATURE_CITE})*)(?: \\([a-z0-9-]+\\))?(?::|$)`,
);

/** What the check found. */
export type CoverageReport =
  | {kind: 'unreadable'; file: string}
  | {
      kind: 'checked';
      problems: string[];
      counts: Array<{file: string; counts: Record<Tag, number>}>;
    };

/** One test row: where it is, its name, and whether it is an acceptance row. */
interface Row {
  file: string;
  name: string;
  acceptance: boolean;
}

/**
 * The criterion ids a name or cite starts with, in the order the features are cited, or none for a name that cites
 * nothing.
 */
export function citedBy(name: string): string[] {
  const match = CITE_PATTERN.exec(name);
  if (match === null) {
    return [];
  }
  const criteria: string[] = [];
  for (const featureCite of (match[1] ?? '').matchAll(
    /(F-\d{4})[ .]AC-(\d+[a-z]?)((?:, ?AC-\d+[a-z]?)*)/g,
  )) {
    const [, feature, first, rest] = featureCite;
    const numbers = [
      first,
      ...[...(rest ?? '').matchAll(/AC-(\d+[a-z]?)/g)].map(each => each[1]),
    ];
    for (const number of numbers) {
      criteria.push(`${String(feature)}.AC-${String(number)}`);
    }
  }
  return criteria;
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

/** The `cite` and `bound.cite` fields of a suite's cases file. */
function casesCites(file: string): string[] {
  if (!existsSync(file)) {
    return [];
  }
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
    cases?: Array<{cite?: unknown; bound?: {cite?: unknown}}>;
  };
  return (parsed.cases ?? []).flatMap(each =>
    [each.cite, each.bound?.cite].filter(
      (cite): cite is string => typeof cite === 'string',
    ),
  );
}

/** Every test row of the repository: the acceptance rows, the cites of the suites' cases files, and the unit rows. */
function rowsOf(root: string): Row[] {
  const rows: Row[] = [];
  const acceptance = path.join(root, 'tests', 'acceptance');
  for (const file of testFilesUnder(acceptance)) {
    for (const name of rowNamesOf(readFileSync(file, 'utf8'))) {
      rows.push({file: path.relative(root, file), name, acceptance: true});
    }
  }
  if (existsSync(acceptance)) {
    for (const entry of sortedEntries(acceptance)) {
      if (!entry.isDirectory()) {
        continue;
      }
      const cases = path.join(acceptance, entry.name, 'cases.json');
      for (const name of casesCites(cases)) {
        rows.push({file: path.relative(root, cases), name, acceptance: true});
      }
    }
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
  letter: string;
  tagName: string;
  reason: string;
}

/** Orders two lines by feature, then by criterion number, then by letter: AC-3, AC-3b, AC-4. */
function before(left: Line, right: Line): boolean {
  if (left.feature !== right.feature) {
    return left.feature < right.feature;
  }
  return left.index === right.index
    ? left.letter < right.letter
    : left.index < right.index;
}

/** The place of a line of `file` in a report; the number is padded so that a sorted report keeps the file's order. */
function place(file: string, number: number): string {
  return `${file}:${String(number).padStart(5, '0')}`;
}

/** Reads the lines of `file`'s text, reporting the malformed ones. */
function linesOf(file: string, text: string, problems: string[]): Line[] {
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
        problems.push(`${place(file, number)}: wrong number of fields`);
        return;
      }
      const [criterion = '', tagName = '', reason = ''] = fields;
      const match = AC_PATTERN.exec(criterion);
      if (match === null) {
        problems.push(
          `${place(file, number)}: AC id out of form: ${criterion}`,
        );
        return;
      }
      if (!(TAGS as readonly string[]).includes(tagName)) {
        problems.push(`${place(file, number)}: unknown tag: ${tagName}`);
        return;
      }
      const line: Line = {
        number,
        id: criterion,
        feature: match[1] ?? '',
        index: Number(match[2]),
        letter: String(match[3]),
        tagName,
        reason,
      };
      if (seen.has(criterion)) {
        problems.push(`${place(file, number)}: ${criterion} is repeated`);
        return;
      }
      seen.add(criterion);
      if (previous !== undefined && !before(previous, line)) {
        problems.push(`${place(file, number)}: ${criterion} is out of order`);
      }
      previous = line;
      lines.push(line);
    });
  return lines;
}

/** Checks the tags of a set's lines against their reasons, the set's deferred reasons included. */
function reasonProblems(
  scope: CoverageScope,
  lines: readonly Line[],
  problems: string[],
): void {
  const deferredReasons = scope.deferredReasons;
  for (const line of lines) {
    const needs = REASON_TAGS.includes(line.tagName);
    const withinSet = deferredReasons?.includes(line.reason) ?? true;
    if (needs && line.reason === '') {
      problems.push(
        `${place(scope.file, line.number)}: ${line.id} needs a reason`,
      );
    } else if (line.tagName === 'deferred' && !withinSet) {
      problems.push(
        `${place(scope.file, line.number)}: ${line.id} gives the reason "${line.reason}", which isn't one of the set's`,
      );
    } else if (!needs && line.reason !== '') {
      problems.push(
        `${place(scope.file, line.number)}: ${line.id} has a reason, which is only for core or deferred`,
      );
    }
  }
}

/** Checks what the tags promise against the rows that cite the criteria. */
function rowProblems(
  scope: CoverageScope,
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
      if (scope.features.includes(feature) && !known.has(criterion)) {
        problems.push(
          `${testRow.file}: row "${testRow.name}" cites ${criterion}, which ${scope.file} doesn't have`,
        );
      }
    }
    const named = /^(F-\d{4})\b/.exec(testRow.name)?.[1];
    if (
      testRow.acceptance &&
      cited.length === 0 &&
      named !== undefined &&
      scope.features.includes(named)
    ) {
      problems.push(
        `${testRow.file}: row "${testRow.name}" names ${named} without an AC`,
      );
    }
  }
  for (const line of lines) {
    if (line.tagName === 'acceptance' && !acceptanceCited.has(line.id)) {
      problems.push(
        `${place(scope.file, line.number)}: ${line.id} is tagged acceptance and no acceptance row cites it`,
      );
    }
    if (
      line.tagName === 'unit' &&
      !unitCited.has(line.id) &&
      !acceptanceCited.has(line.id)
    ) {
      problems.push(
        `${place(scope.file, line.number)}: ${line.id} is tagged unit and no row cites it`,
      );
    }
  }
}

/** The count of `lines` per tag. */
function countsOf(lines: readonly Line[]): Record<Tag, number> {
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
  return counts;
}

/**
 * Runs the check over the repository at `root`, for every coverage file of `scopes` that is present: a missing file of
 * the slice-1 set makes the check unreadable, a missing file of any other set is skipped.
 */
export function checkCoverage(
  root: string,
  scopes: readonly CoverageScope[] = COVERAGE_SCOPES,
): CoverageReport {
  const sliceMissing = scopes.find(
    scope =>
      scope.name === READABLE_SET && !existsSync(path.join(root, scope.file)),
  );
  if (sliceMissing !== undefined) {
    return {kind: 'unreadable', file: sliceMissing.file};
  }
  const present = scopes.filter(scope =>
    existsSync(path.join(root, scope.file)),
  );
  const problems: string[] = [];
  const rows = rowsOf(root);
  const counts = present.map(scope => {
    const lines = linesOf(
      scope.file,
      readFileSync(path.join(root, scope.file), 'utf8'),
      problems,
    );
    reasonProblems(scope, lines, problems);
    rowProblems(scope, lines, rows, problems);
    return {file: scope.file, counts: countsOf(lines)};
  });
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
  const counts = report.counts.flatMap(each => [
    `${each.file}:`,
    ...TAGS.map(name => `${name}: ${String(each.counts[name])}`),
  ]);
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
