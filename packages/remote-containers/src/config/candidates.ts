/**
 * @fileoverview The candidates of a folder from every source: its own files, the configurations its remotes map to
 * under the user's roots, and the one in the store of user data. Several sources give one list, each file once.
 */

import type {Candidate} from './discovery.ts';
import {byAbsolutePath} from './stored-candidate.ts';

/**
 * The folder's own `local` candidates and the `external` ones (mirrored and stored) as one list. With no external
 * candidate the local order stands; with one, every candidate is ordered by absolute file path whatever its source,
 * and a file found twice counts once.
 */
export function joinedCandidates(
  local: readonly Candidate[],
  external: readonly Candidate[],
): Candidate[] {
  if (external.length === 0) {
    return [...local];
  }
  const once = new Map<string, Candidate>();
  for (const candidate of [...local, ...external]) {
    if (!once.has(candidate.file)) {
      once.set(candidate.file, candidate);
    }
  }
  return byAbsolutePath([...once.values()]);
}
