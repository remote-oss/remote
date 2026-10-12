/**
 * @fileoverview The match of a typed distribution name against the registered rows, and the hiding of the
 * Docker Desktop distros from the list.
 */

import {type DistroRow, type DistroVersion} from './list.ts';

/** The match of a typed name against the registered rows, or the reason there is no match. */
export type MatchResult =
  | {
      readonly kind: 'match';
      readonly registeredName: string;
      readonly version: DistroVersion;
      readonly isDefault: boolean;
    }
  | {readonly kind: 'distroUnknown'; readonly asTyped: string}
  | {readonly kind: 'noDistro'};

/**
 * The match of the distribution named `typedName`: the empty name selects the default row, an exactly equal
 * name wins, and of the case-folded rows exactly one is the match; the registered spelling, the version and
 * the default marker of the matched row are the match.
 */
export function matchDistro(
  rows: readonly DistroRow[],
  typedName: string,
): MatchResult {
  if (typedName === '') {
    const defaultRow = rows.find(entry => entry.isDefault);
    if (defaultRow === undefined) {
      return {kind: 'noDistro'};
    }
    return {
      kind: 'match',
      registeredName: defaultRow.name,
      version: defaultRow.version,
      isDefault: defaultRow.isDefault,
    };
  }
  const exact = rows.find(entry => entry.name === typedName);
  if (exact !== undefined) {
    return {
      kind: 'match',
      registeredName: exact.name,
      version: exact.version,
      isDefault: exact.isDefault,
    };
  }
  const lowered = typedName.toLowerCase();
  let folded: DistroRow | undefined;
  for (const entry of rows) {
    if (entry.name.toLowerCase() === lowered) {
      // A second row folded to the same name: the names differ only in case, so none may win.
      if (folded !== undefined) {
        return {kind: 'distroUnknown', asTyped: typedName};
      }
      folded = entry;
    }
  }
  if (folded === undefined) {
    return {kind: 'distroUnknown', asTyped: typedName};
  }
  return {
    kind: 'match',
    registeredName: folded.name,
    version: folded.version,
    isDefault: folded.isDefault,
  };
}

/** The registered names of the Docker Desktop distros; they are compared folded, as every other name match. */
const DOCKER_DESKTOP_NAMES = ['docker-desktop', 'docker-desktop-data'];

/**
 * The rows without the Docker Desktop distros, in input order, when the caller does not include them; `rows`
 * itself when it does. The input is never changed.
 */
export function filterDockerDesktop(
  rows: readonly DistroRow[],
  includeDockerDesktop: boolean,
): readonly DistroRow[] {
  if (includeDockerDesktop) {
    return rows;
  }
  return rows.filter(
    entry =>
      !DOCKER_DESKTOP_NAMES.some(name => entry.name.toLowerCase() === name),
  );
}
