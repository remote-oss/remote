/**
 * An opaque marker for a value the caller declares confidential: its string form is a fixed
 * placeholder, so the value cannot leak by concatenation into a message.
 */
export interface Secret {
  /** The placeholder a string context shows. */
  readonly marker: '[secret]';
  /** The string form, always the placeholder. */
  toString(): string;
}

function makeSecret(): Secret {
  return {
    marker: '[secret]',
    toString: () => '[secret]',
  };
}

/** Wrap a value so it can never be read back or concatenated into a message as itself. */
export function secret(
  // The marker carries no part of the value, so the parameter is intentionally unused.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  value: string,
): Secret {
  return makeSecret();
}

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
