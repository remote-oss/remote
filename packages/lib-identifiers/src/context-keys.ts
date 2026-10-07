/**
 * @fileoverview Sets a context key through the identifier table, only for keys the extension itself sets.
 */

/** A context key of a package's identifier table. */
export interface ContextKeyEntry {
  readonly id: string;
  /** Who sets the key: the extension, or the editor. */
  readonly setter: 'extension' | 'core';
}

/** The editor operation that setting a context key needs. */
export interface ContextKeyHost {
  /** Sets the context key `contextKey` to `value` in the window. */
  setContext(contextKey: string, value: unknown): PromiseLike<unknown>;
}

/** Sets an extension-set context key; throws for a key the editor sets, which is a programming error. */
export function setContextKey(
  host: ContextKeyHost,
  entry: ContextKeyEntry,
  value: unknown,
): PromiseLike<unknown> {
  if (entry.setter !== 'extension') {
    throw new Error(
      `NotExtensionSet: context key '${entry.id}' is set by the editor`,
    );
  }
  return host.setContext(entry.id, value);
}
