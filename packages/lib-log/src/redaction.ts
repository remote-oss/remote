/** The shape of a token a caller may have missed naming: a long run of word-like characters. */
const TOKEN_SHAPE = /\b[A-Za-z0-9_-]{32,}\b/;

/**
 * Replace every named secret with the fixed marker; if what is left still looks like an unmarked
 * token, the whole message becomes the marker. Empty secrets are ignored.
 */
export function redact(message: string, secrets: readonly string[]): string {
  let result = message;
  for (const namedSecret of secrets) {
    if (namedSecret.length > 0) {
      result = result.split(namedSecret).join('[redacted]');
    }
  }
  return TOKEN_SHAPE.test(result) ? '[redacted]' : result;
}
