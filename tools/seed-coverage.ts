/**
 * @fileoverview seed-coverage: writes a coverage file with every criterion tagged `todo`.
 *
 *     node tools/seed-coverage.ts [<name>]
 *
 * `<name>` picks the set, `slice1` (the default), `containers-r1` or `explorer`, and writes the set's file. It reads
 * the issue number of each of the set's features from the catalogue, fetches the feature's issue with `gh issue view`
 * in its own repository and takes the criteria from its body. Run it once, commit the output, and tag the lines by
 * hand afterwards; running it again overwrites the tags.
 */

import {spawnSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
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

/** The text of a coverage file (the first slice's by default), from the catalogue and the issues. */
export function seedFor(
  catalogue: string,
  program: Program,
  scope: CoverageScope = SLICE_ONE_SCOPE,
): string {
  const numbers = issueNumbersOf(catalogue);
  return seedOf(
    scope.features.flatMap(feature => {
      const entry = numbers.get(feature);
      if (entry === undefined) {
        throw new Error(`${feature} is not in the catalogue`);
      }
      return acceptanceCriteriaOf(
        bodyOf(entry.issue, entry.repository, program),
        feature,
      );
    }),
  );
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
    const scope = scopeNamed(process.argv[2]);
    const text = seedFor(
      readFileSync(
        path.join(REPOSITORY_ROOT, 'docs', 'architecture', 'catalogue.tsv'),
        'utf8',
      ),
      (name, programArguments) =>
        spawnSync(name, [...programArguments], {encoding: 'utf8'}),
      scope,
    );
    writeFileSync(path.join(REPOSITORY_ROOT, scope.file), text);
    console.log(
      `seed-coverage: ${String(text.split('\n').length - 2)} criteria`,
    );
  } catch (error) {
    console.error(`seed-coverage: ${messageOf(error)}`);
    process.exitCode = 1;
  }
}
