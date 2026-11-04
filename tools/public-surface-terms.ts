/**
 * @fileoverview The wording that must not reach the public surface (ADR-0008, decision 5): words of the process that
 * builds the product, and the internal ids of its records. One list serves the ESLint rule over source comments and
 * the tool over the shipped files.
 */

/** Words that name the process wherever they appear. */
const BARE_TERMS: readonly RegExp[] = [
  /\bcards?\b/gi,
  /\bspecs?\b/gi,
  /\brooms?\b/gi,
  /\bworkers?\b/gi,
  /\blabs?\b/gi,
  /\bdirty\b/gi,
  /\bclean[- ]rooms?\b/gi,
  /\breimplement\w*/gi,
  /\bmicrosoft\b/gi,
  /\bms-vscode\S*/gi,
  /\borchestrat\w*/gi,
  // Decision, ruling and feature ids; `ADR-0003` has no boundary before its `R-`.
  /\b[DRF]-\d{2,4}\b/g,
];

/** The forbidden word in the sense of the process: the extension the family stands down for. */
const THE_REFERENCE = /\bthe\s+reference\b/gi;

/**
 * The same word in UI string values, where an occurrence immediately followed by ` to ` is plain vocabulary
 * (ruling-2165-plain-reference): the reused text of STR:S294 speaks of a feature entry in the user's file.
 */
const THE_REFERENCE_UI = /\bthe\s+reference\b(?!\s+to\b)/gi;

/**
 * Ordinary words that are plain technical vocabulary in most uses (a reference to a value, a process's
 * specification, an SSH session), forbidden only in the senses of the process.
 */
const OTHER_PROCESS_SENSES: readonly RegExp[] = [
  /\breference's\b/gi,
  /\breference\s+(?:extension|implementation|behaviou?r|client|manifest|product)s?\b/gi,
  /\b(?:spec|specification)s?\s+issues?\b/gi,
  /\b(?:published|written)\s+specifications?\b/gi,
  /\b(?:coding|design|architecture|review|agent)\s+sessions?\b/gi,
];

const PROCESS_SENSES: readonly RegExp[] = [
  THE_REFERENCE,
  ...OTHER_PROCESS_SENSES,
];

const PROCESS_SENSES_UI: readonly RegExp[] = [
  THE_REFERENCE_UI,
  ...OTHER_PROCESS_SENSES,
];

/** One forbidden word or phrase found in a text. */
export interface TermMatch {
  term: string;
  /** Where the match starts in the searched text. */
  index: number;
}

/**
 * The forbidden words and phrases in a text, in the order they appear. In UI string values the plain sense of an
 * occurrence followed by ` to ` passes (ruling-2165-plain-reference); every other surface keeps the full list.
 */
export function forbiddenMatches(
  text: string,
  uiStringValues = false,
): TermMatch[] {
  const found = [
    ...BARE_TERMS,
    ...(uiStringValues ? PROCESS_SENSES_UI : PROCESS_SENSES),
  ].flatMap(pattern =>
    [...text.matchAll(pattern)].map(match => ({
      term: match[0].replace(/\s+/g, ' '),
      index: match.index,
      end: match.index + match[0].length,
    })),
  );
  found.sort((left, right) => left.index - right.index);
  // A phrase inside the span of an earlier one is the same finding.
  let reached = 0;
  const matches: TermMatch[] = [];
  for (const {term, index, end} of found) {
    if (index >= reached) {
      matches.push({term, index});
      reached = end;
    }
  }
  return matches;
}
