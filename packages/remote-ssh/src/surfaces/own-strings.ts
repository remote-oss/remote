/**
 * @fileoverview The strings that are ours alone: our own named string ids, their English templates, and the text one
 * of them gives with its values.
 */

import {SSH_LABEL_PREFIX_ID} from '../window/label-suffix.ts';
import type {StringRef} from '../connect/picker-model.ts';
import {type Translate, filled} from './strings.ts';

/** The ids of the strings that are ours alone, and their English templates. */
export const OWN_TEMPLATES = {
  [SSH_LABEL_PREFIX_ID]: 'SSH: {0}',
  platformPickPlaceholder: 'Select the platform of the remote host "{0}"',
  mitigationReloadWindow: 'Reload Window',
} as const;

/** The text of a string of our own: its template translated and filled. Throws for an id this table lacks. */
export function ownText(reference: StringRef, translate: Translate): string {
  if (!Object.hasOwn(OWN_TEMPLATES, reference.id)) {
    throw new Error(`no template for the string id ${reference.id}`);
  }
  return filled(
    translate,
    OWN_TEMPLATES[reference.id as keyof typeof OWN_TEMPLATES],
    reference.values,
  );
}
