/**
 * @fileoverview The one neutraliser for text that comes from outside the extension (a payload, a path, a distro name
 * or a recent entry) before it is shown in a notification, a tooltip, a tree label or a quick pick: the editor reads
 * `[`, `]`, `(`, `)` and `$(` there as link and icon syntax, and control characters as layout.
 */

/**
 * The characters the editor reads as link or icon syntax: a bracket, a parenthesis, `$` that opens an icon, and the
 * backslash, which would otherwise cancel the escape put before the character after it.
 */
const MARKUP = /[[\]()\\]|\$(?=\()/gu;

/** Whether a code point is a C0 (U+0000 to U+001F) or C1 (U+0080 to U+009F) control character. */
function isControl(codePoint: number): boolean {
  return codePoint <= 0x1f || (codePoint >= 0x80 && codePoint <= 0x9f);
}

/** `value` with each link or icon character escaped by a backslash and each control character dropped. */
export function neutralText(value: string): string {
  return Array.from(value)
    .filter(character => !isControl(character.charCodeAt(0)))
    .join('')
    .replace(MARKUP, '\\$&');
}
