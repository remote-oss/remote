/**
 * @fileoverview The check of the proxy settings before a connection of the window's own: each value must be a URI the
 * editor's strict parser accepts.
 */

/** A proxy value the parser rejected, and the parser's message. */
export interface ProxyProblem {
  value: string;
  error: string;
}

/**
 * The first of the two values, the HTTP one first, that `parse` rejects by throwing; an empty value is no proxy and
 * is not parsed.
 */
export function proxyProblem(
  values: {httpProxy: string; httpsProxy: string},
  parse: (text: string) => void,
): ProxyProblem | undefined {
  for (const value of [values.httpProxy, values.httpsProxy]) {
    if (value === '') {
      continue;
    }
    try {
      parse(value);
    } catch (caught) {
      return {
        value,
        error: caught instanceof Error ? caught.message : String(caught),
      };
    }
  }
  return undefined;
}
