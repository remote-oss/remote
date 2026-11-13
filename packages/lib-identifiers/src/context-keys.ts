/**
 * @fileoverview Sets a context key through the identifier table, only for keys the extension itself sets, alone or with the editor.
 */

/** A context key of a package's identifier table. */
export interface ContextKeyEntry {
  readonly id: string;
  /**
   * Who sets the key: the extension, or the editor. A `coreAndExtension` key is one the editor sets on a Windows desktop
   * for the local machine, and that one named component of the extension may also set.
   */
  readonly setter: 'extension' | 'core' | 'coreAndExtension';
}

/** The editor operation that setting a context key needs. */
export interface ContextKeyHost {
  /** Sets the context key `contextKey` to `value` in the window. */
  setContext(contextKey: string, value: unknown): PromiseLike<unknown>;
}

/** Sets a context key the extension sets, alone or with the editor; throws for a key only the editor sets, which is a programming error. */
export function setContextKey(
  host: ContextKeyHost,
  entry: ContextKeyEntry,
  value: unknown,
): PromiseLike<unknown> {
  if (entry.setter === 'core') {
    throw new Error(
      `NotExtensionSet: context key '${entry.id}' is set by the editor`,
    );
  }
  return host.setContext(entry.id, value);
}
