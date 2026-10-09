/**
 * @fileoverview The wording that must not reach the public surface (ADR-0008, decision 5): words of the process that
 * builds the product, and the internal ids of its records. One list serves the ESLint rule over source comments and
 * the tool over the shipped files.
 */

/** Words that name the process wherever they appear. */
const BARE_TERMS: readonly RegExp[] = [
  /\bcards?\b/gi,
  /\bconformance\b/gi,
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

/**
 * Ordinary words that are plain technical vocabulary in most uses (a reference to a value, a process's
 * specification, an SSH session), forbidden only in the senses of the process.
 */
const PROCESS_SENSES: readonly RegExp[] = [
  /\bthe\s+reference\b/gi,
  /\breference's\b/gi,
  /\breference\s+(?:extension|implementation|behaviou?r|client|manifest|product)s?\b/gi,
  /\b(?:spec|specification)s?\s+issues?\b/gi,
  /\b(?:published|written)\s+specifications?\b/gi,
  /\bspecifications?\s+(?:and|&)\s+conformance\b/gi,
  /\b(?:coding|design|architecture|review|agent)\s+sessions?\b/gi,
];

/** One forbidden word or phrase found in a text. */
export interface TermMatch {
  term: string;
  /** Where the match starts in the searched text. */
  index: number;
}

/** The forbidden words and phrases in a text, in the order they appear. */
export function forbiddenMatches(text: string): TermMatch[] {
  const found = [...BARE_TERMS, ...PROCESS_SENSES].flatMap(pattern =>
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
