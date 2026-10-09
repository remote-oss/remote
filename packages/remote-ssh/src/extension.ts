/**
 * @fileoverview The Remote - SSH extension's entry point: it loads the editor, which exists only in the
 * extension host, so the conformance cases cover it, not the unit tests.
 */

/** The extension's activation: nothing yet; the connect flow lands with card remote-ssh-01. */
// eslint-disable-next-line @typescript-eslint/no-empty-function -- the card fixes both entry points as empty
export function activate(): void {}

/** The extension's deactivation: nothing yet. */
// eslint-disable-next-line @typescript-eslint/no-empty-function -- the card fixes both entry points as empty
export function deactivate(): void {}
