/**
 * @fileoverview The "Dev Containers: Settings" command: it runs the editor's open-Settings command with this extension's own id.
 */

/** Runs an editor command with its arguments. */
export type RunCommand = (
  command: string,
  ...parameters: unknown[]
) => PromiseLike<unknown>;

/** The "Dev Containers: Settings" command: opens the Settings editor filtered to this extension's own settings. */
export function openOwnSettings(
  runCommand: RunCommand,
  extensionId: string,
): () => PromiseLike<unknown> {
  return () =>
    runCommand('workbench.action.openSettings', `@ext:${extensionId}`);
}
