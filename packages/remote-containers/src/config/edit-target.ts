/**
 * @fileoverview Which configuration an edit from the editor changes, decided from the facts of the
 * window alone: an attached container's attach file, the window's own configuration, a Recovery Container's session
 * file, then the configurations of the folder, picked from when there are several.
 */

import type {AttachConfigFiles} from '../attach/config-files.ts';
import type {EditPolicy} from './configuration-edit.ts';
import type {Candidate} from './discovery.ts';
import {joinedCandidates} from './candidates.ts';

/** What the window tells of itself and of its folder. */
export interface WindowEditFacts {
  /** The attach files of an attached container's window. */
  attached?: AttachConfigFiles;
  /** The configuration file the window's own dev container was made from. */
  ownFile?: string;
  /** The session file of a Recovery Container window. */
  recoverySessionFile?: string;
  /** The configurations in the folder itself. */
  workspace: readonly Candidate[];
  /** The mirrored and the user-data configurations of the folder. */
  external: readonly Candidate[];
}

/** A configuration to pick from, with the way it is edited. */
interface PickCandidate {
  candidate: Candidate;
  policy: EditPolicy;
}

/** What an edit changes. */
export type EditTarget =
  | {kind: 'file'; file: string; policy: EditPolicy}
  | {kind: 'attach'; files: AttachConfigFiles}
  | {kind: 'pick'; candidates: readonly PickCandidate[]}
  | {kind: 'none'};

/** The way a candidate is edited: a file of the workspace through its buffer, any other on disk unless it is open. */
function policyOf(candidate: Candidate, facts: WindowEditFacts): EditPolicy {
  return facts.external.some(each => each.file === candidate.file)
    ? 'diskUnlessOpen'
    : 'buffer';
}

/** The configuration an edit changes, in the order the editor's edits follow. */
export function editTargetOf(
  facts: WindowEditFacts & {attached: AttachConfigFiles},
): {kind: 'attach'; files: AttachConfigFiles};
export function editTargetOf(
  facts: Omit<WindowEditFacts, 'attached'>,
): Exclude<EditTarget, {kind: 'attach'}>;
export function editTargetOf(facts: WindowEditFacts): EditTarget {
  if (facts.attached !== undefined) {
    return {kind: 'attach', files: facts.attached};
  }
  if (facts.ownFile !== undefined) {
    return {kind: 'file', file: facts.ownFile, policy: 'buffer'};
  }
  if (facts.recoverySessionFile !== undefined) {
    return {
      kind: 'file',
      file: facts.recoverySessionFile,
      policy: 'diskUnlessOpen',
    };
  }
  const candidates = joinedCandidates(facts.workspace, facts.external);
  const [only, ...others] = candidates;
  if (only === undefined) {
    return {kind: 'none'};
  }
  if (others.length > 0) {
    return {
      kind: 'pick',
      candidates: candidates.map(candidate => ({
        candidate,
        policy: policyOf(candidate, facts),
      })),
    };
  }
  return {kind: 'file', file: only.file, policy: policyOf(only, facts)};
}
