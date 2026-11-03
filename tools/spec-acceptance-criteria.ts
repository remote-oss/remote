/**
 * @fileoverview The acceptance criteria of a feature's issue and the features of each coverage file: what the coverage
 * files are seeded from.
 */

import path from 'node:path';

/** The features whose criteria the coverage file lists, as the build order names them; two decision records have no criteria. */
export const SLICE_ONE_FEATURES: readonly string[] = [
  'F-2001',
  'F-2101',
  'F-2102',
  'F-2104',
  'F-2106',
  'F-2108',
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
  'F-2308',
  'F-2311',
  'F-2312',
  'F-2401',
  'F-2403',
  'F-2405',
  'F-2409',
  'F-2410',
  'F-2411',
  'F-2412',
  'F-2501',
  'F-2502',
  'F-2507',
  'F-2508',
  'F-2509',
  'F-2601',
  'F-2604',
  'F-2605',
  'F-2606',
  'F-2704',
  'F-3901',
  'F-3902',
  'F-3903',
];

/** The features of Remote - Containers release 1, as its brief cuts them, and the four views features of #960; three decision records have no criteria. */
export const CONTAINERS_RELEASE_ONE_FEATURES: readonly string[] = [
  'F-0101',
  'F-0106',
  'F-0201',
  'F-0205',
  'F-0301',
  'F-0302',
  'F-0401',
  'F-0402',
  'F-0403',
  'F-0405',
  'F-0408',
  'F-0409',
  'F-0410',
  'F-0411',
  'F-0412',
  'F-0414',
  'F-0415',
  'F-0416',
  'F-0417',
  'F-0419',
  'F-0501',
  'F-0502',
  'F-0503',
  'F-0504',
  'F-0505',
  'F-0801',
  'F-0802',
  'F-0803',
  'F-0804',
  'F-0805',
  'F-0901',
  'F-0902',
  'F-0903',
  'F-0906',
  'F-1101',
  'F-1102',
  'F-1401',
  'F-1402',
  'F-1403',
  'F-1406',
];

/** The features of Remote - Containers release 2, the 54 reviewed families no release had taken yet. */
export const CONTAINERS_RELEASE_TWO_FEATURES: readonly string[] = [
  'F-0102',
  'F-0103',
  'F-0107',
  'F-0108',
  'F-0109',
  'F-0202',
  'F-0203',
  'F-0204',
  'F-0206',
  'F-0207',
  'F-0303',
  'F-0304',
  'F-0305',
  'F-0306',
  'F-0404',
  'F-0406',
  'F-0407',
  'F-0413',
  'F-0418',
  'F-0506',
  'F-0507',
  'F-0603',
  'F-0604',
  'F-0605',
  'F-0701',
  'F-0702',
  'F-0703',
  'F-0704',
  'F-0705',
  'F-0706',
  'F-0707',
  'F-0708',
  'F-0806',
  'F-0807',
  'F-0808',
  'F-0809',
  'F-0810',
  'F-0811',
  'F-0812',
  'F-0904',
  'F-0905',
  'F-1001',
  'F-1002',
  'F-1003',
  'F-1004',
  'F-1005',
  'F-1006',
  'F-1007',
  'F-1103',
  'F-1201',
  'F-1301',
  'F-1302',
  'F-1404',
  'F-1405',
];

/** A coverage file: its name, where it lies under the repository root, the features it holds, and the repository of their issues. */
export interface CoverageScope {
  /** The file's set name, the argument of `seed-coverage`'s command line. */
  name: string;
  file: string;
  features: readonly string[];
  repository: string;
  /** The only reasons a `deferred` line may give; any reason when absent. */
  deferredReasons?: readonly string[];
}

/** The folder the coverage files lie in. */
const CATALOGUE_FOLDER = path.join('docs', 'architecture', 'catalogue');

/** The coverage file of the first slice of Remote - SSH. */
export const SLICE_ONE_SCOPE: CoverageScope = {
  name: 'slice1',
  file: path.join(CATALOGUE_FOLDER, 'coverage-slice1.tsv'),
  features: SLICE_ONE_FEATURES,
  repository: 'remote-ssh',
};

/** The coverage file of Remote - Containers release 1. */
export const CONTAINERS_RELEASE_ONE_SCOPE: CoverageScope = {
  name: 'containers-r1',
  file: path.join(CATALOGUE_FOLDER, 'coverage-containers-r1.tsv'),
  features: CONTAINERS_RELEASE_ONE_FEATURES,
  repository: 'remote-containers',
};

/** The coverage file of Remote - Containers release 2. */
export const CONTAINERS_RELEASE_TWO_SCOPE: CoverageScope = {
  name: 'containers-r2',
  file: path.join(CATALOGUE_FOLDER, 'coverage-containers-r2.tsv'),
  features: CONTAINERS_RELEASE_TWO_FEATURES,
  repository: 'remote-containers',
};

/** The features of Remote Explorer's slice 1, with the part of Remote - SSH that serves it. */
export const EXPLORER_SLICE_ONE_FEATURES: readonly string[] = [
  'F-2503',
  'F-5001',
  'F-5002',
  'F-5101',
  'F-5102',
  'F-5103',
  'F-5901',
  'F-5902',
];

/** The coverage file of the first slice of Remote Explorer. */
export const EXPLORER_SLICE_ONE_SCOPE: CoverageScope = {
  name: 'explorer',
  file: path.join(CATALOGUE_FOLDER, 'coverage-explorer-slice1.tsv'),
  features: EXPLORER_SLICE_ONE_FEATURES,
  repository: 'remote-explorer',
  /** The only reasons a deferred line of the explorer file may give. */
  deferredReasons: [
    'explorer slice 1: increment 2',
    'explorer slice 1: increment 3',
    'D-55: no tunnel rows',
    'F-2503 Q4: the Windows and macOS path form',
    'D-60: Windows client',
  ],
};

/** The coverage file of Remote Explorer's release 2. */
export const EXPLORER_RELEASE_TWO_SCOPE: CoverageScope = {
  name: 'explorer-r2',
  file: path.join(CATALOGUE_FOLDER, 'coverage-explorer-r2.tsv'),
  features: ['F-5201', 'F-5202', 'F-5104', 'F-5301'],
  repository: 'remote-explorer',
};

/** The features of the Extension Pack's first release: its package data, listing, members and identity. */
export const EXTENSIONPACK_RELEASE_ONE_FEATURES: readonly string[] = [
  'F-9001',
  'F-9002',
  'F-9101',
  'F-9901',
];

/** The coverage file of the Extension Pack's first release. */
export const EXTENSIONPACK_RELEASE_ONE_SCOPE: CoverageScope = {
  name: 'extensionpack-r1',
  file: path.join(CATALOGUE_FOLDER, 'coverage-extensionpack-r1.tsv'),
  features: EXTENSIONPACK_RELEASE_ONE_FEATURES,
  repository: 'remote-extensionpack',
};

/** The coverage file of the Extension Pack's second release. */
export const EXTENSIONPACK_RELEASE_TWO_SCOPE: CoverageScope = {
  name: 'extensionpack-r2',
  file: path.join(CATALOGUE_FOLDER, 'coverage-extensionpack-r2.tsv'),
  features: ['F-9102', 'F-9103'],
  repository: 'remote-extensionpack',
};

/** The features of Remote - SSH release 2. */
export const SSH_RELEASE_TWO_FEATURES: readonly string[] = [
  'F-2002',
  'F-2003',
  'F-2004',
  'F-2005',
  'F-2006',
  'F-2007',
  'F-2008',
  'F-2103',
  'F-2105',
  'F-2107',
  'F-2109',
  'F-2203',
  'F-2205',
  'F-2309',
  'F-2310',
  'F-2402',
  'F-2404',
  'F-2406',
  'F-2407',
  'F-2408',
  'F-2413',
  'F-2504',
  'F-2702',
];

/** The coverage file of Remote - SSH release 2. */
export const SSH_RELEASE_TWO_SCOPE: CoverageScope = {
  name: 'ssh-r2',
  file: path.join(CATALOGUE_FOLDER, 'coverage-ssh-r2.tsv'),
  features: SSH_RELEASE_TWO_FEATURES,
  repository: 'remote-ssh',
};

/** Every coverage file the check reads. */
export const COVERAGE_SCOPES: readonly CoverageScope[] = [
  SLICE_ONE_SCOPE,
  CONTAINERS_RELEASE_ONE_SCOPE,
  EXPLORER_SLICE_ONE_SCOPE,
  EXTENSIONPACK_RELEASE_ONE_SCOPE,
  CONTAINERS_RELEASE_TWO_SCOPE,
  EXPLORER_RELEASE_TWO_SCOPE,
  EXTENSIONPACK_RELEASE_TWO_SCOPE,
  SSH_RELEASE_TWO_SCOPE,
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
