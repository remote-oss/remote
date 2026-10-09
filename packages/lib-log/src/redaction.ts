/** The marker a named secret or an unmarked run becomes. */
const MARKER = '[redacted]';

/**
 * The shape of a token a caller may have missed naming: a run of 32 or more word characters. The matches are
 * maximal, so a hex run of exactly 40 or 64 characters is always a whole word.
 */
const RUN_SHAPE = /[A-Za-z0-9_-]{32,}/g;

/** Whether the run is only hex characters: a commit id (40) or a digest (64) is not a secret. */
function isHex(wordRun: string): boolean {
  return /^[0-9a-fA-F]+$/.test(wordRun);
}

/**
 * Replace every named secret with the fixed marker, then every run of 32 or more word characters with the
 * marker, leaving the rest of the message; a run of exactly 40 or 64 hex characters is a commit or digest id
 * and is kept. The marker is applied once per span.
 */
export function redact(message: string, secrets: readonly string[]): string {
  let result = message;
  for (const namedSecret of secrets) {
    if (namedSecret.length > 0) {
      result = result.split(namedSecret).join(MARKER);
    }
  }
  return result.replace(RUN_SHAPE, wordRun => {
    const exempt =
      (wordRun.length === 40 || wordRun.length === 64) && isHex(wordRun);
    return exempt ? wordRun : MARKER;
  });
}
