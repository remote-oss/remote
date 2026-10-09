/** The marker a named secret or an unmarked run becomes. */
const MARKER = '[redacted]';

/** The length at which a run of word characters is a token. */
const MIN_RUN = 32;

/**
 * The shape of a token a caller may have missed naming: a run of 32 or more word characters. The matches are
 * maximal; the run rule then trims the outer hyphens, so a hyphen glued to a run belongs to its neighbour.
 */
const RUN_SHAPE = /[A-Za-z0-9_-]{32,}/g;

/**
 * A whole-word commit id (40 hex) or digest (64 hex). These are not secrets, so they are carved out of a message
 * before the run rule; the capturing group lets a split keep each id in place while the pieces between them are
 * scanned for runs.
 */
const ID_SHAPE = /\b([0-9a-fA-F]{40}|[0-9a-fA-F]{64})\b/g;

/**
 * Replace every run of word characters of 32 or more that does not itself start or end with a hyphen by the
 * marker, leaving the rest of the piece. The outer hyphens of a longer candidate stay in place, so the marker
 * never eats a separator.
 */
function markRuns(piece: string): string {
  return piece.replace(RUN_SHAPE, wordRun => {
    const inner = wordRun.replace(/^-+|-+$/g, '');
    return inner.length >= MIN_RUN ? wordRun.replace(inner, MARKER) : wordRun;
  });
}

/**
 * Replace every named secret with the fixed marker, then split the message on its whole-word commit and digest
 * ids, redact the runs in the pieces between them, and join the pieces and ids back together. An id carved out of
 * a longer run keeps its neighbours readable while the run around it is still marked. The marker is applied once
 * per span, so an id and a pre-existing marker are never touched.
 */
export function redact(message: string, secrets: readonly string[]): string {
  let result = message;
  for (const namedSecret of secrets) {
    if (namedSecret.length > 0) {
      result = result.split(namedSecret).join(MARKER);
    }
  }
  return result
    .split(ID_SHAPE)
    .map((part, index) => (index % 2 === 0 ? markRuns(part) : part))
    .join('');
}
