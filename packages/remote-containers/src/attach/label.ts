/**
 * @fileoverview The text an attached-container window shows after its folder: the image and the name of the container,
 * and the engine when the target is pinned to one; the bare word when the container is not found.
 */

import {engineLabelOf, type PinnedEngine} from '../engine/effective-engine.ts';
import type {Translate} from '../surfaces/engine-dialogs.ts';
import {filled} from '../surfaces/filled.ts';

/** The English templates of the suffix. */
const LABEL_TEMPLATES = {
  S091: 'Container {0} ({1}){2}',
  container: 'Container',
} as const;

/** The container a window attached to, as the engine reports it. */
export interface AttachedIdentity {
  image: string;
  /** The container's name without the slash Docker keeps. */
  name: string;
}

/** The suffix of the window's label. */
export function attachedSuffixOf(
  identity: AttachedIdentity | undefined,
  engine: PinnedEngine,
  translate: Translate,
): string {
  if (identity === undefined) {
    return translate(LABEL_TEMPLATES.container);
  }
  const label = engineLabelOf(engine);
  return filled(translate, LABEL_TEMPLATES.S091, [
    identity.image,
    identity.name,
    label === undefined ? '' : ` @ ${label}`,
  ]);
}
