/**
 * @fileoverview The texts a flow of the troubleshooting feature never shows: no further information is offered and no
 * setting is searched. The rows of the failure suite, of the pre-connection dialog and of the
 * troubleshooting table read what the user was shown through it.
 */

/** The words that name a text the feature never shows. */
const FORBIDDEN = ['More Info', 'in settings'];

/** The texts among `shown` that name a forbidden one: none, when the feature shows what it should. */
export function forbiddenAmong(shown: readonly string[]): string[] {
  return shown.filter(text =>
    FORBIDDEN.some(forbidden => text.includes(forbidden)),
  );
}
