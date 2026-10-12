/**
 * @fileoverview seed-coverage: writes the coverage file of a slice with every criterion tagged `todo`.
 *
 *     node tools/seed-coverage.ts
 *
 * It reads the issue number of each first-slice feature from the catalogue, fetches the feature's issue with
 * `gh issue view` and takes the criteria from its body. Run it once, commit the output, and tag the lines by
 * hand afterwards; running it again overwrites the tags.
 */

import {spawnSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {COVERAGE_FILE} from './check-coverage.ts';
import {isMainModule, messageOf, REPOSITORY_ROOT} from './repository.ts';
import {
  acceptanceCriteriaOf,
  SLICE_ONE_FEATURES,
} from './spec-acceptance-criteria.ts';

/** The repository the feature issues of Remote - SSH are in. */
const SPEC_REPOSITORY = 'remote-oss/remote-ssh';

/** The issue number of each Remote - SSH feature, from the catalogue's columns of the feature and of its issue. */
export function issueNumbersOf(catalogue: string): Map<string, number> {
  const [header = '', ...rows] = catalogue.split('\n');
  const columns = header.split('\t');
  const idColumn = columns.indexOf('id');
  const issueColumn = columns.indexOf('issue');
  const repositoryColumn = columns.indexOf('repo');
  const numbers = new Map<string, number>();
  for (const catalogueRow of rows) {
    const fields = catalogueRow.split('\t');
    if (fields[repositoryColumn] === 'remote-ssh') {
      numbers.set(fields[idColumn] ?? '', Number(fields[issueColumn]));
    }
  }
  return numbers;
}

/** Orders two criterion ids by feature and then by number, not by text. */
export function byCriterion(left: string, right: string): number {
  const [leftFeature = '', leftNumber = ''] = left.split('.AC-');
  const [rightFeature = '', rightNumber = ''] = right.split('.AC-');
  return leftFeature === rightFeature
    ? Number(leftNumber) - Number(rightNumber)
    : leftFeature < rightFeature
      ? -1
      : 1;
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

/** The body of a feature's issue, from `gh`. */
export function bodyOf(issue: number, program: Program): string {
  const result = program('gh', [
    'issue',
    'view',
    String(issue),
    '-R',
    SPEC_REPOSITORY,
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

/** The text of the coverage file for the first slice, from the catalogue and the issues. */
export function seedFor(catalogue: string, program: Program): string {
  const numbers = issueNumbersOf(catalogue);
  return seedOf(
    SLICE_ONE_FEATURES.flatMap(feature => {
      const issue = numbers.get(feature);
      if (issue === undefined) {
        throw new Error(`${feature} is not in the catalogue`);
      }
      return acceptanceCriteriaOf(bodyOf(issue, program), feature);
    }),
  );
}

if (isMainModule(import.meta.url)) {
  try {
    const text = seedFor(
      readFileSync(
        path.join(REPOSITORY_ROOT, 'docs', 'architecture', 'catalogue.tsv'),
        'utf8',
      ),
      (name, programArguments) =>
        spawnSync(name, [...programArguments], {encoding: 'utf8'}),
    );
    writeFileSync(path.join(REPOSITORY_ROOT, COVERAGE_FILE), text);
    console.log(
      `seed-coverage: ${String(text.split('\n').length - 2)} criteria`,
    );
  } catch (error) {
    console.error(`seed-coverage: ${messageOf(error)}`);
    process.exitCode = 1;
  }
}
