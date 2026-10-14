/**
 * @fileoverview The acceptance criteria of a feature's issue and the features of each coverage file: what the coverage
 * files are seeded from.
 */

import path from 'node:path';

/** The features of slice 1, as the build order lists them, and the six added to 0.2 later; two decision records have no criteria. */
export const SLICE_ONE_FEATURES: readonly string[] = [
  'F-2001',
  'F-2101',
  'F-2102',
  'F-2201',
  'F-2202',
  'F-2204',
  'F-2206',
  'F-2301',
  'F-2302',
  'F-2303',
  'F-2304',
  'F-2305',
  'F-2306',
  'F-2307',
  'F-2401',
  'F-2403',
  'F-2409',
  'F-2411',
  'F-2412',
  'F-2501',
  'F-2502',
  'F-2601',
  'F-2605',
  'F-3901',
  'F-3902',
  'F-3903',
];

/** The features of Remote - Containers release 1, as its brief cuts them; three decision records have no criteria. */
export const CONTAINERS_RELEASE_ONE_FEATURES: readonly string[] = [
  'F-0101',
  'F-0106',
  'F-0201',
  'F-0301',
  'F-0401',
  'F-0403',
  'F-0405',
  'F-0408',
  'F-0409',
  'F-0410',
  'F-0411',
  'F-0412',
  'F-0415',
  'F-0416',
  'F-0419',
  'F-0501',
  'F-0502',
  'F-0503',
  'F-0504',
  'F-0505',
  'F-1401',
  'F-1402',
  'F-1403',
  'F-1406',
];

/** A coverage file: where it lies under the repository root, the features it holds, and the repository of their issues. */
export interface CoverageScope {
  file: string;
  features: readonly string[];
  repository: string;
}

/** The folder the coverage files lie in. */
const CATALOGUE_FOLDER = path.join('docs', 'architecture', 'catalogue');

/** The coverage file of the first slice of Remote - SSH. */
export const SLICE_ONE_SCOPE: CoverageScope = {
  file: path.join(CATALOGUE_FOLDER, 'coverage-slice1.tsv'),
  features: SLICE_ONE_FEATURES,
  repository: 'remote-ssh',
};

/** The coverage file of Remote - Containers release 1. */
export const CONTAINERS_RELEASE_ONE_SCOPE: CoverageScope = {
  file: path.join(CATALOGUE_FOLDER, 'coverage-containers-r1.tsv'),
  features: CONTAINERS_RELEASE_ONE_FEATURES,
  repository: 'remote-containers',
};

/** Every coverage file the check reads. */
export const COVERAGE_SCOPES: readonly CoverageScope[] = [
  SLICE_ONE_SCOPE,
  CONTAINERS_RELEASE_ONE_SCOPE,
];

/**
 * The ids of the criteria of `feature` in an issue's body, in body order, each once: the lines that start with a
 * bold `<feature>.AC-<n>` after a list dash, the number with an optional lower-case letter (`AC-17b`) and the bold
 * text with an optional note after the id (`AC-35 (a note)`), unless the text after the bold starts
 * with `Removed` or `Merged into` (a criterion folded into another). A later line that only quotes an id does not
 * count.
 */
export function acceptanceCriteriaOf(body: string, feature: string): string[] {
  const pattern = new RegExp(
    `^- \\*\\*(${feature}\\.AC-\\d+[a-z]?)\\b[^*]*\\*\\*(?! *(?:Removed|Merged into))`,
  );
  const found: string[] = [];
  for (const line of body.split('\n')) {
    const criterion = pattern.exec(line)?.[1];
    if (criterion !== undefined && !found.includes(criterion)) {
      found.push(criterion);
    }
  }
  return found;
}
