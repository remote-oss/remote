/**
 * @fileoverview The English texts the activation shows or writes; the composition root translates each for the user's
 * language.
 */

/** The display name, which is also the name of the extension's Output channel. */
export const DISPLAY_NAME = 'Remote - Tunnels';

/** The coexistence warning when the extension with the same identifiers is enabled. */
export const STAND_DOWN_WARNING =
  'Remote - Tunnels (ms-vscode.remote-server) is enabled in this window. This extension stays inactive while it is enabled because both use the same commands, settings and remote resolver. Disable one of the two extensions and reload the window.';

/** The button of the coexistence warning. */
export const STAND_DOWN_BUTTON = 'Show Remote - Tunnels Extension';

/** The line the Output channel opens with when the editor has not enabled the proposed API of remote resolvers. */
export const RESOLVER_UNAVAILABLE =
  'The tunnel resolver is unavailable: the editor has not enabled the resolvers proposal for this extension, so tunnel windows cannot be opened.';
