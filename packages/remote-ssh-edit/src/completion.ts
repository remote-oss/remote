/**
 * @fileoverview The completion items as plain data, and the rule for where keywords are offered.
 * Nothing here talks to the editor; completion-adapter.ts does.
 */

import {KEYWORDS} from './keywords.ts';

/** The characters that end a line's first word and count as blank before it. */
const SEPARATORS = new Set(
  [
    0x0020, 0x0009, 0x000b, 0x000c, 0x00a0, 0x1680, 0x2000, 0x2001, 0x2002,
    0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x202f,
    0x205f, 0x3000, 0xfeff, 0x2028, 0x2029,
  ].map(codePoint => String.fromCodePoint(codePoint)),
);

/** The "Configure tunnel" template with its tab stops; the editor adapts its indentation and line ends. */
export const TUNNEL_TEMPLATE =
  'Host ${1:alias}\n    HostName ${2:hostname}\n    LocalForward ${3:port} ${4:localhost}:${3:port}\n    User ${5:user}';

/** One completion item, independent of the editor's types. */
export interface CompletionEntry {
  label: string;
  kind: 'property' | 'snippet';
  sortText: string;
  documentation: string;
  snippet?: string;
}

/** The snippet's two strings, already in the display language. */
export interface SnippetTexts {
  label: string;
  documentation: string;
}

/**
 * Whether the text of a line up to the cursor is a keyword position: after its leading separators, it holds no
 * separator. The text after the cursor never matters.
 */
export function isKeywordPosition(textBeforeCursor: string): boolean {
  let position = 0;
  while (
    position < textBeforeCursor.length &&
    SEPARATORS.has(textBeforeCursor.charAt(position))
  ) {
    position++;
  }
  for (; position < textBeforeCursor.length; position++) {
    if (SEPARATORS.has(textBeforeCursor.charAt(position))) {
      return false;
    }
  }
  return true;
}

/**
 * The 96 items offered at every keyword position: the keywords and the "Configure tunnel" snippet, each with a sort
 * key that orders like its label lower-cased, so the editor keeps the case-insensitive order.
 */
export function completionEntries(snippet: SnippetTexts): CompletionEntry[] {
  const keywordEntries = KEYWORDS.map((keyword): CompletionEntry => ({
    label: keyword.label,
    kind: 'property',
    sortText: keyword.label.toLowerCase(),
    documentation: keyword.documentation,
  }));
  const snippetEntry: CompletionEntry = {
    label: snippet.label,
    kind: 'snippet',
    sortText: snippet.label.toLowerCase(),
    documentation: snippet.documentation,
    snippet: TUNNEL_TEMPLATE,
  };
  return [...keywordEntries, snippetEntry];
}
