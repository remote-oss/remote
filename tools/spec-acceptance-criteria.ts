/**
 * @fileoverview The acceptance criteria of a feature's issue and the features of the first slice: what the coverage
 * file is seeded from.
 */

/** The features of slice 1, as the build order lists them; the last two decision records have no criteria. */
export const SLICE_ONE_FEATURES: readonly string[] = [
  'F-2001',
  'F-2101',
  'F-2102',
  'F-2201',
  'F-2202',
  'F-2206',
  'F-2301',
  'F-2304',
  'F-2305',
  'F-2306',
  'F-2307',
  'F-2401',
  'F-2403',
  'F-2409',
  'F-2501',
  'F-2502',
  'F-2601',
  'F-3901',
  'F-3902',
  'F-3903',
];

/**
 * The ids of the criteria of `feature` in an issue's body, in body order, each once: the lines that start with a
 * bold `<feature>.AC-<n>` after a list dash. A later line that only quotes an id does not count.
 */
export function acceptanceCriteriaOf(body: string, feature: string): string[] {
  const pattern = new RegExp(`^- \\*\\*(${feature}\\.AC-\\d+)\\*\\*`);
  const found: string[] = [];
  for (const line of body.split('\n')) {
    const criterion = pattern.exec(line)?.[1];
    if (criterion !== undefined && !found.includes(criterion)) {
      found.push(criterion);
    }
  }
  return found;
}
