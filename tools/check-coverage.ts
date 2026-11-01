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
 * acceptance row names a feature of a file and no criterion. It prints how many criteria each tag holds, per file. A `todo` line a row already cites gets a note, which never changes the exit code. Exit 0
 * when it passes, 1 with problems, 2 when a file cannot be read.
 *
 * A line tagged `open` is one a person has decided to prove with the acceptance rows its reason names, by their case
 * labels (`(first-case), (second-case)`): it counts as `acceptance` once every named row exists and cites the
 * criterion, and as `todo`, with a note naming the missing rows, until then. A row whose case label ends in `-half` or
 * `-part` proves a part of a criterion and never counts.
 *
 *     node tools/check-coverage.ts --table
 *
 * prints every criterion with the tag it counts as and, for an `open` one, the rows that make it so.
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

/** The tags a criterion counts as, `todo` meaning not tagged yet. */
const TAGS = [
  'acceptance',
  'unit',
  'recorded',
  'core',
  'deferred',
  'todo',
] as const;

type Tag = (typeof TAGS)[number];

/** The tags a line of the file holds: the tags above, and `open` for a line whose tag the named rows decide. */
const FILE_TAGS: readonly string[] = [...TAGS, 'open'];

/** The tags whose line must say why, `open` saying which rows decide it. */
const REASON_TAGS: readonly string[] = ['core', 'deferred', 'open'];

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

/** The case label of a name that cites criteria. */
const CASE_LABEL_PATTERN = new RegExp(
  `^${FEATURE_CITE}(?:, ${FEATURE_CITE})* \\(([a-z0-9-]+)\\)`,
);

/** What the check found. */
export type CoverageReport =
  | {kind: 'unreadable'; file: string}
  | {
      kind: 'checked';
      problems: string[];
      notes: string[];
      counts: Array<{file: string; counts: Record<Tag, number>}>;
    };

/** One test row: where it is, its name, and whether it is an acceptance row. */
interface Row {
  file: string;
  name: string;
  acceptance: boolean;
}

/** The case label of a row's cite, the text in parentheses after the criteria, or none. */
function caseLabelOf(name: string): string | undefined {
  return CASE_LABEL_PATTERN.exec(name)?.[1];
}

/** A case label that marks its row as proving a part of a criterion, which never counts towards a tag. */
function isPartLabel(label: string): boolean {
  return /-(?:half|part)$/.test(label);
}

/** A word in a case label that says its row proves a part, wherever it stands in the label. */
const PART_WORD_PATTERN = /(?:^|-)(?:half|part|clause|only)(?:-|$)/;

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
      if (!FILE_TAGS.includes(tagName)) {
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
        `${place(scope.file, line.number)}: ${line.id} has a reason, which is only for core, deferred or open`,
      );
    }
  }
}

/** The rows that cite a criterion, the acceptance rows apart from the unit rows. */
interface Citations {
  acceptance: Row[];
  unit: Row[];
}

/** Which rows cite each criterion. */
function citationsOf(rows: readonly Row[]): Map<string, Citations> {
  const citations = new Map<string, Citations>();
  for (const testRow of rows) {
    for (const criterion of citedBy(testRow.name)) {
      const cited = citations.get(criterion) ?? {acceptance: [], unit: []};
      cited[testRow.acceptance ? 'acceptance' : 'unit'].push(testRow);
      citations.set(criterion, cited);
    }
  }
  return citations;
}

/** The case labels an `open` line names in its reason, `(first), (second)`. */
function namedLabels(line: Line): string[] {
  return [...line.reason.matchAll(/\(([a-z0-9-]+)\)/g)].map(
    match => match[1] ?? '',
  );
}

/** What a line counts as, with the rows that make it so for an `open` line, and the named labels no row has. */
interface Effective {
  counted: Tag;
  rows: Row[];
  missing: string[];
}

/** The tag a line counts as: an `open` line is `acceptance` once every row it names exists, and `todo` before. */
function effectiveOf(
  line: Line,
  citations: ReadonlyMap<string, Citations>,
): Effective {
  if (line.tagName !== 'open') {
    return {counted: line.tagName as Tag, rows: [], missing: []};
  }
  const cited = citations.get(line.id)?.acceptance ?? [];
  const named = namedLabels(line).map(label => ({
    label,
    found: cited.find(each => caseLabelOf(each.name) === label),
  }));
  const missing = named.filter(each => each.found === undefined);
  return {
    counted: missing.length === 0 && named.length > 0 ? 'acceptance' : 'todo',
    rows: named.flatMap(each => (each.found === undefined ? [] : [each.found])),
    missing: missing.map(each => each.label),
  };
}

/** Checks what the tags promise against the rows that cite the criteria. */
function rowProblems(
  scope: CoverageScope,
  lines: readonly Line[],
  rows: readonly Row[],
  citations: ReadonlyMap<string, Citations>,
  problems: string[],
  notes: string[],
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
    if (line.tagName === 'open') {
      openProblems(scope, line, citations, problems, notes);
    }
  }
  for (const line of lines) {
    if (line.tagName !== 'todo') {
      continue;
    }
    if (acceptanceCited.has(line.id)) {
      notes.push(
        `${place(scope.file, line.number)}: ${line.id} is todo and an acceptance row cites it`,
      );
    } else if (unitCited.has(line.id)) {
      notes.push(
        `${place(scope.file, line.number)}: ${line.id} is todo and a unit row cites it`,
      );
    }
  }
}

/** The problems and the note of an `open` line: what it names, and the rows that cite it with a part's wording. */
function openProblems(
  scope: CoverageScope,
  line: Line,
  citations: ReadonlyMap<string, Citations>,
  problems: string[],
  notes: string[],
): void {
  const where = place(scope.file, line.number);
  const labels = namedLabels(line);
  if (labels.length === 0 && line.reason !== '') {
    problems.push(`${where}: ${line.id} is open and names no row`);
  }
  for (const label of labels.filter(each => PART_WORD_PATTERN.test(each))) {
    problems.push(
      `${where}: ${line.id} names (${label}), whose label marks a part of the criterion`,
    );
  }
  const cited = citations.get(line.id);
  for (const testRow of [
    ...(cited?.acceptance ?? []),
    ...(cited?.unit ?? []),
  ]) {
    const label = caseLabelOf(testRow.name) ?? '';
    if (PART_WORD_PATTERN.test(label) && !isPartLabel(label)) {
      problems.push(
        `${testRow.file}: row "${testRow.name}" cites ${line.id}, which is open, with a case label that marks a part: end it in -half or -part`,
      );
    }
  }
  const {missing} = effectiveOf(line, citations);
  if (missing.length > 0) {
    notes.push(
      `${where}: ${line.id} is open and still counts as todo: no acceptance row cites it as ${missing.map(each => `(${each})`).join(', ')}`,
    );
  }
}

/** The count of `lines` per tag they count as. */
function countsOf(
  lines: readonly Line[],
  citations: ReadonlyMap<string, Citations>,
): Record<Tag, number> {
  const counts: Record<Tag, number> = {
    acceptance: 0,
    unit: 0,
    recorded: 0,
    core: 0,
    deferred: 0,
    todo: 0,
  };
  for (const line of lines) {
    counts[effectiveOf(line, citations).counted] += 1;
  }
  return counts;
}

/**
 * The present files of `scopes`, each with its lines, and the rows with what cites each criterion; or the file of the
 * slice-1 set when that is missing, which makes the check unreadable.
 */
function readScopes(
  root: string,
  scopes: readonly CoverageScope[],
  problems: string[],
):
  | {unreadable: string}
  | {
      read: Array<{scope: CoverageScope; lines: Line[]}>;
      rows: Row[];
      citations: Map<string, Citations>;
    } {
  const sliceMissing = scopes.find(
    scope =>
      scope.name === READABLE_SET && !existsSync(path.join(root, scope.file)),
  );
  if (sliceMissing !== undefined) {
    return {unreadable: sliceMissing.file};
  }
  const rows = rowsOf(root);
  const read = scopes
    .filter(scope => existsSync(path.join(root, scope.file)))
    .map(scope => ({
      scope,
      lines: linesOf(
        scope.file,
        readFileSync(path.join(root, scope.file), 'utf8'),
        problems,
      ),
    }));
  return {read, rows, citations: citationsOf(rows)};
}

/**
 * Runs the check over the repository at `root`, for every coverage file of `scopes` that is present: a missing file of
 * the slice-1 set makes the check unreadable, a missing file of any other set is skipped.
 */
export function checkCoverage(
  root: string,
  scopes: readonly CoverageScope[] = COVERAGE_SCOPES,
): CoverageReport {
  const problems: string[] = [];
  const notes: string[] = [];
  const found = readScopes(root, scopes, problems);
  if ('unreadable' in found) {
    return {kind: 'unreadable', file: found.unreadable};
  }
  const {read, rows, citations} = found;
  const counts = read.map(({scope, lines}) => {
    reasonProblems(scope, lines, problems);
    rowProblems(scope, lines, rows, citations, problems, notes);
    return {file: scope.file, counts: countsOf(lines, citations)};
  });
  return {
    kind: 'checked',
    problems: problems.sort(),
    notes: notes.sort(),
    counts,
  };
}

/**
 * Every criterion of each present file of `scopes` with the tag it counts as and, for an `open` line, the rows that
 * make it so, one tab-separated line each under a line for the file; for people, never committed.
 */
export function tableOf(
  root: string,
  scopes: readonly CoverageScope[] = COVERAGE_SCOPES,
): string[] {
  const found = readScopes(root, scopes, []);
  if ('unreadable' in found) {
    return [`check-coverage: cannot read ${found.unreadable}`];
  }
  return found.read.flatMap(({scope, lines}) => [
    `${scope.file}:`,
    ...lines.map(line => {
      const {counted, rows} = effectiveOf(line, found.citations);
      return [
        line.id,
        counted,
        ...rows.map(each => `${each.file}: ${each.name}`),
      ].join('\t');
    }),
  ]);
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
    lines: [
      ...report.problems,
      ...report.notes.map(note => `note: ${note}`),
      ...counts,
    ],
    exitCode: report.problems.length === 0 ? 0 : 1,
  };
}

if (isMainModule(import.meta.url)) {
  try {
    if (process.argv.includes('--table')) {
      console.log(tableOf(REPOSITORY_ROOT).join('\n'));
    } else {
      const {lines, exitCode} = outputOf(checkCoverage(REPOSITORY_ROOT));
      console.log(lines.join('\n'));
      process.exitCode = exitCode;
    }
  } catch (error) {
    console.error(`check-coverage: ${messageOf(error)}`);
    process.exitCode = 2;
  }
}
