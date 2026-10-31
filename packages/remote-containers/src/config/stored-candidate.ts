/**
 * @fileoverview The configuration of a folder that lives in the extension's store of user data, as a candidate beside
 * the folder's own: found by the marker of the folder's slot, named by its `~`-relative path, and ordered with the
 * others by absolute path when the user has to pick.
 */

import {
  slotOf,
  tildePath,
  type StoreFiles,
} from '../authoring/user-data-store.ts';
import type {Candidate} from './discovery.ts';

/** Where the store is and whose home its paths are written against. */
export interface StoredLookup {
  /** The folder of the store. */
  root: string;
  store: StoreFiles;
  /** The user's home folder, which the pick writes as `~`. */
  home: string;
}

/** The stored configuration of `folder` as a candidate; none when its slot has no configuration file. */
export async function storedCandidate(
  lookup: StoredLookup,
  folder: string,
): Promise<Candidate | undefined> {
  const slot = await slotOf(lookup.root, folder, lookup.store);
  if (
    slot === undefined ||
    (await lookup.store.readText(slot.configFile)) === undefined
  ) {
    return undefined;
  }
  return {
    file: slot.configFile,
    relative: tildePath(slot.configFile, lookup.home),
    place: {kind: 'stored', slot: slot.name},
  };
}

/** The candidates ordered by absolute file path, as the pick shows them when one of them is stored. */
export function byAbsolutePath(candidates: readonly Candidate[]): Candidate[] {
  return [...candidates].sort((left, right) =>
    left.file === right.file ? 0 : left.file < right.file ? -1 : 1,
  );
}
