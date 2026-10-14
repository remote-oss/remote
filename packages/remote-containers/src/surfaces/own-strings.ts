/**
 * @fileoverview The strings of our own that have a name rather than a number, with their English templates.
 */

import type {Translate} from './engine-dialogs.ts';
import {filled} from './filled.ts';

const OWN_TEMPLATES = {
  noServerSource:
    "{0} has no built-in VS Code Server download location for {1}. Set remote.serverDownloadBaseUrl to a URL template for this editor's own server builds.",
} as const;

/** The text of the string of our own named `name`, filled with `texts`; throws for a name the table lacks. */
export function ownText(
  name: string,
  texts: readonly string[],
  translate: Translate,
): string {
  if (!(name in OWN_TEMPLATES)) {
    throw new Error(`no template for the string id ${name}`);
  }
  return filled(
    translate,
    OWN_TEMPLATES[name as keyof typeof OWN_TEMPLATES],
    texts,
  );
}
