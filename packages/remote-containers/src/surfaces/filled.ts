/**
 * @fileoverview A template with `{0}`, `{1}` for its values, translated first.
 */

import type {Translate} from './engine-dialogs.ts';

const PLACE = /\{(\d+)\}/g;

/** The translated template with each `{n}` replaced by `texts[n]`; a place with no text stays as written. */
export function filled(
  translate: Translate,
  template: string,
  texts: readonly string[] = [],
): string {
  return translate(template).replace(
    PLACE,
    (written, index: string) => texts[Number(index)] ?? written,
  );
}
