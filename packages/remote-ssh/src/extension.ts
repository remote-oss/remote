/**
 * @fileoverview The Remote - SSH extension's entry point: it loads the editor, which exists only in the
 * extension host, so the unit tests do not load it.
 */

/** The extension's activation: empty until the extension registers its commands. */
// eslint-disable-next-line @typescript-eslint/no-empty-function -- activation is empty until commands register
export function activate(): void {}

/** The extension's deactivation: nothing to tear down while activation is empty. */
// eslint-disable-next-line @typescript-eslint/no-empty-function -- deactivation is empty until commands register
export function deactivate(): void {}
