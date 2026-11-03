/**
 * @fileoverview The rows of the source pick of Clone Repository in Container Volume, as the typed text changes: one
 * row that clones the typed text, once there is text.
 */

import type {Translate} from '../surfaces/engine-dialogs.ts';
import {cloneText} from './clone-strings.ts';

/** A row of the source pick: its label, and the text it clones as its description. */
export interface SourceRow {
  label: string;
  description: string;
}

/** The rows for `value` as typed: the clone row with the text, its surrounding whitespace removed, or none. */
export function sourceRowsOf(value: string, translate: Translate): SourceRow[] {
  const text = value.trim();
  return text === ''
    ? []
    : [{label: cloneText('S072', translate), description: text}];
}
