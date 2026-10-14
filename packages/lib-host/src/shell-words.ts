/**
 * @fileoverview The words a channel gives a POSIX shell: a value quoted as one word, and the command that evaluates
 * the first bytes of its standard input and leaves the rest to what they start.
 */

/** A value as one word for a POSIX shell, whatever it holds. */
export function posixQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * The shell command that evaluates the first `byteCount` bytes of its standard input and leaves the rest of the input
 * to what they start. Only a number is on the command line.
 */
export function preludeCommand(byteCount: number): string {
  return `eval "$(dd bs=1 count=${String(byteCount)} 2>/dev/null)"`;
}
