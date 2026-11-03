/**
 * @fileoverview The words a channel gives a host's shell: a value quoted as one word for a POSIX shell or as one string
 * for PowerShell, a value as one argument of a Windows command line, and the command that evaluates the first bytes of
 * its standard input and leaves the rest to what they start.
 */

/** A value as one word for a POSIX shell, whatever it holds. */
export function posixQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** Every character PowerShell reads as a single quote: the apostrophe and the four typographic single quotes. */
const POWERSHELL_SINGLE_QUOTES = /['\u2018\u2019\u201A\u201B]/gu;

/**
 * A value as one single-quoted PowerShell string, whatever it holds. Inside such a string PowerShell ends the string at
 * any of its single-quote characters, and reads one of them twice as itself, so each is doubled.
 */
export function powershellQuote(value: string): string {
  return `'${value.replace(POWERSHELL_SINGLE_QUOTES, quote => quote + quote)}'`;
}

/**
 * A value as one argument of a Windows command line, as the C runtime and .NET split one: in double quotes, each
 * double quote escaped with a backslash, and each run of backslashes doubled where it comes before a double quote or
 * the end.
 */
export function windowsArgument(value: string): string {
  const escaped = value
    .replace(/(\\*)"/gu, '$1$1\\"')
    .replace(/(\\+)$/u, '$1$1');
  return `"${escaped}"`;
}

/**
 * The shell command that evaluates the first `byteCount` bytes of its standard input and leaves the rest of the input
 * to what they start. Only a number is on the command line.
 */
export function preludeCommand(byteCount: number): string {
  return `eval "$(dd bs=1 count=${String(byteCount)} 2>/dev/null)"`;
}
