/**
 * @fileoverview The English texts the activation shows or throws; the composition root translates each for the
 * user's language.
 */

/** The coexistence warning when the other WSL extension is enabled. */
export const STAND_DOWN_WARNING =
  'WSL stays inactive in this window because another extension that connects to WSL distros is enabled. Both use the same commands and settings. Disable one of the two and reload the window.';

/** The button of the coexistence warning. */
export const STAND_DOWN_BUTTON = 'Show Other Extension';

/** What a command that would open a WSL window throws in the browser. */
export const WEB_REJECTION =
  'Local hostAuthority resolutions are not possible in web';

/** Why the browser cannot resolve a WSL window. */
export const WEB_RESOLVE_REFUSAL = 'WSL on the web requires an exec server.';
