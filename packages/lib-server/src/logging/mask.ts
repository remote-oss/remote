/**
 * @fileoverview The connection token in a log line: every occurrence is changed to a mask of the same shape, so that a
 * line shows that a token was there and what kind, never the token.
 */

/** `token` with every digit changed to `1` and every ASCII letter to `a`. */
export function maskOf(token: string): string {
  return token.replace(/\d/g, '1').replace(/[A-Za-z]/g, 'a');
}

/** `text` with every occurrence of the connection token masked; the text as it is when there is no token. */
export function masked(text: string, token: string | undefined): string {
  return token === undefined || token === ''
    ? text
    : text.replaceAll(token, () => maskOf(token));
}
