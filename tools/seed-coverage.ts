/**
 * @fileoverview seed-coverage: writes a coverage file with the criteria of a set's features tagged `todo`, and never
 * changes a line of one that exists.
 *
 *     node tools/seed-coverage.ts [<name>] [--check]
 *
 * `<name>` picks the set, `slice1` (the default), `containers-r1`, `explorer` or `extensionpack-r1`, and names the set's
 * file. It reads the issue number of each of the set's features from the catalogue, fetches the feature's issue with
 * `gh issue view` in its own repository and takes the criteria from its body. A file that does not exist is written with
 * every criterion `todo`. A file that exists is never rewritten: its lines keep their tags, reasons and places, the
 * criteria it lacks are inserted as `todo` lines in numeric order, and a line of a feature outside the set stops the run,
 * naming the feature. With `--check` nothing is written, and the run fails when it would have added a line.
 */

import {spawnSync} from 'node:child_process';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {isMainModule, messageOf, REPOSITORY_ROOT} from './repository.ts';
import {
  acceptanceCriteriaOf,
  COVERAGE_SCOPES,
  type CoverageScope,
  SLICE_ONE_SCOPE,
} from './spec-acceptance-criteria.ts';

/** The organisation the repositories of the feature issues are in. */
const SPEC_OWNER = 'remote-oss';

/** The issue of a catalogue row: its number, and the repository the issue lives in. */
export interface CatalogueIssue {
  repository: string;
  issue: number;
}

/**
 * The issue of every feature of the catalogue that has one: its number, and the repository of its issue, `remote-oss/`
 * plus the row's repository column.
 */
export function issueNumbersOf(catalogue: string): Map<string, CatalogueIssue> {
  const [header = '', ...rows] = catalogue.split('\n');
  const columns = header.split('\t');
  const idColumn = columns.indexOf('id');
  const issueColumn = columns.indexOf('issue');
  const repositoryColumn = columns.indexOf('repo');
  const issues = new Map<string, CatalogueIssue>();
  for (const catalogueRow of rows) {
    const fields = catalogueRow.split('\t');
    const issueField = fields[issueColumn] ?? '';
    if (fields[idColumn] === undefined || !/^\d+$/.test(issueField)) {
      continue;
    }
    issues.set(fields[idColumn], {
      repository: `${SPEC_OWNER}/${fields[repositoryColumn] ?? ''}`,
      issue: Number(issueField),
    });
  }
  return issues;
}

/** A criterion id's feature, number and letter: an id ending in `.AC-17b` has the number 17 and the letter `b`. */
function partsOf(criterion: string): [string, number, string] {
  const [feature = '', rest = ''] = criterion.split('.AC-');
  const letter = /[a-z]$/.test(rest) ? rest.slice(-1) : '';
  return [feature, Number(rest.slice(0, rest.length - letter.length)), letter];
}

/** Orders two criterion ids by feature, then by number, not by text, then by letter: AC-3, AC-3b, AC-4. */
export function byCriterion(left: string, right: string): number {
  const [leftFeature, leftNumber, leftLetter] = partsOf(left);
  const [rightFeature, rightNumber, rightLetter] = partsOf(right);
  if (leftFeature !== rightFeature) {
    return leftFeature < rightFeature ? -1 : 1;
  }
  if (leftNumber !== rightNumber) {
    return leftNumber - rightNumber;
  }
  return leftLetter === rightLetter ? 0 : leftLetter < rightLetter ? -1 : 1;
}

/** The text of the coverage file for these criteria, every one tagged `todo`. */
export function seedOf(criteria: readonly string[]): string {
  return [
    'ac\ttag\treason',
    ...[...criteria].sort(byCriterion).map(criterion => `${criterion}\ttodo\t`),
    '',
  ].join('\n');
}

/** What runs a program and gives its exit status and output. */
export type Program = (
  name: string,
  programArguments: readonly string[],
) => {status: number | null; stdout: string; stderr: string};

/** The body of issue `issue` of `repository` (`remote-oss/` plus the repository name), from `gh`. */
export function bodyOf(
  issue: number,
  repository: string,
  program: Program,
): string {
  const result = program('gh', [
    'issue',
    'view',
    String(issue),
    '-R',
    repository,
    '--json',
    'body',
    '--jq',
    '.body',
  ]);
  if (result.status !== 0) {
    throw new Error(`gh issue view ${String(issue)}: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

/** The criteria of every feature of a set (the first slice's by default), from the catalogue and the issues. */
export function criteriaFor(
  catalogue: string,
  program: Program,
  scope: CoverageScope = SLICE_ONE_SCOPE,
): string[] {
  const numbers = issueNumbersOf(catalogue);
  return scope.features.flatMap(feature => {
    const entry = numbers.get(feature);
    if (entry === undefined) {
      throw new Error(`${feature} is not in the catalogue`);
    }
    return acceptanceCriteriaOf(
      bodyOf(entry.issue, entry.repository, program),
      feature,
    );
  });
}

/** The text of a coverage file (the first slice's by default), from the catalogue and the issues. */
export function seedFor(
  catalogue: string,
  program: Program,
  scope: CoverageScope = SLICE_ONE_SCOPE,
): string {
  return seedOf(criteriaFor(catalogue, program, scope));
}

/** What merging the criteria into an existing coverage file gives. */
export interface Merged {
  /** The file's text: every line it had, in its place, and the missing criteria as `todo` lines in numeric order. */
  text: string;
  /** The criteria that were not in the file and were inserted. */
  added: string[];
  /** The ids in the file that the issues no longer list, kept as they are. */
  unlisted: string[];
}

/** The id of a coverage line: its first field. */
function idOf(line: string): string {
  return line.split('\t')[0] ?? '';
}

/**
 * Merges `criteria` into the text of an existing coverage file and changes or drops no line: the lines keep their
 * tags, reasons and places, and each criterion the file lacks is inserted as a `todo` line before the first line that
 * sorts after it. A line of a feature outside `features` throws, naming every such feature.
 */
export function mergedSeed(
  existing: string,
  criteria: readonly string[],
  features: readonly string[],
): Merged {
  const [header = '', ...rest] = existing.split('\n');
  const lines = rest.filter(line => line !== '');
  const outside = [
    ...new Set(
      lines
        .map(line => idOf(line).split('.AC-')[0] ?? '')
        .filter(feature => !features.includes(feature)),
    ),
  ];
  if (outside.length > 0) {
    throw new Error(
      `the file has lines of features outside the set: ${outside.join(', ')}`,
    );
  }
  const present = new Set(lines.map(idOf));
  const added = criteria
    .filter(criterion => !present.has(criterion))
    .sort(byCriterion);
  const merged = [...lines];
  for (const criterion of added) {
    const after = merged.findIndex(
      line => byCriterion(idOf(line), criterion) > 0,
    );
    merged.splice(after < 0 ? merged.length : after, 0, `${criterion}\ttodo\t`);
  }
  const wanted = new Set(criteria);
  return {
    text: [header, ...merged, ''].join('\n'),
    added,
    unlisted: [...present].filter(entry => !wanted.has(entry)),
  };
}

/** The set `name` picks by its name; none picks the first slice's. */
export function scopeNamed(name: string | undefined): CoverageScope {
  if (name === undefined) {
    return SLICE_ONE_SCOPE;
  }
  const scope = COVERAGE_SCOPES.find(candidate => candidate.name === name);
  if (scope === undefined) {
    throw new Error(`no coverage set named ${name}`);
  }
  return scope;
}

if (isMainModule(import.meta.url)) {
  try {
    const check = process.argv.includes('--check');
    const scope = scopeNamed(
      process.argv.slice(2).find(word => !word.startsWith('--')),
    );
    const criteria = criteriaFor(
      readFileSync(
        path.join(REPOSITORY_ROOT, 'docs', 'architecture', 'catalogue.tsv'),
        'utf8',
      ),
      (name, programArguments) =>
        spawnSync(name, [...programArguments], {encoding: 'utf8'}),
      scope,
    );
    const file = path.join(REPOSITORY_ROOT, scope.file);
    if (!existsSync(file)) {
      if (check) {
        throw new Error(`${scope.file} does not exist`);
      }
      writeFileSync(file, seedOf(criteria));
      console.log(`seed-coverage: wrote ${String(criteria.length)} criteria`);
    } else {
      const merged = mergedSeed(
        readFileSync(file, 'utf8'),
        criteria,
        scope.features,
      );
      if (merged.unlisted.length > 0) {
        console.log(
          `seed-coverage: kept ${String(merged.unlisted.length)} lines the issues no longer list: ${merged.unlisted.join(', ')}`,
        );
      }
      if (check) {
        if (merged.added.length > 0) {
          throw new Error(
            `${scope.file} lacks ${String(merged.added.length)} criteria: ${merged.added.join(', ')}`,
          );
        }
        console.log('seed-coverage: the file has every criterion');
      } else {
        writeFileSync(file, merged.text);
        console.log(
          `seed-coverage: added ${String(merged.added.length)} criteria: ${merged.added.join(', ')}`,
        );
      }
    }
  } catch (error) {
    console.error(`seed-coverage: ${messageOf(error)}`);
    process.exitCode = 1;
  }
}
