/**
 * @fileoverview The one log line of a command that would open a window on an SSH host while the editor does not grant
 * the `resolvers` proposal: it opens nothing, so the family's setup notice stays in the window it ran from.
 */

/** The log line of `commandId` run while the editor does not grant `resolvers`. */
export function windowlessLine(commandId: string): string {
  return `${commandId} opens no window: the editor has not enabled the proposed API resolvers for Remote - SSH`;
}
