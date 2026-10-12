/**
 * @fileoverview Watches the editor for the user saving and closing a document: the sign that an edit of the runtime
 * arguments is finished.
 */

/** The editor's document events, reduced to the path of the document. */
export interface DocumentEvents {
  onSaved(listener: (documentPath: string) => void): {dispose(): void};
  onClosed(listener: (documentPath: string) => void): {dispose(): void};
}

/**
 * Settles when a document that `matches` is closed: `true` when it was saved before, `false` when it was closed
 * without a save. It never settles while the document stays open.
 */
export function savedAndClosed(
  events: DocumentEvents,
  matches: (documentPath: string) => boolean,
): Promise<boolean> {
  return new Promise(resolve => {
    let saved = false;
    const saveListener = events.onSaved(documentPath => {
      saved ||= matches(documentPath);
    });
    const closeListener = events.onClosed(documentPath => {
      if (!matches(documentPath)) {
        return;
      }
      saveListener.dispose();
      closeListener.dispose();
      resolve(saved);
    });
  });
}
