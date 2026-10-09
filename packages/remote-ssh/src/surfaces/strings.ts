/**
 * @fileoverview What the surfaces share for their texts: an English template with `{0}`, `{1}` for the values, and
 * the translation of a template into the display language, which the extension supplies from the editor.
 */

/** Turns an English template into the text for the display language. */
export type Translate = (template: string) => string;

/** Translates the template, then puts the values into its `{n}` places. */
export function filled(
  translate: Translate,
  template: string,
  values: readonly string[] = [],
): string {
  return values.reduce(
    (text, value, index) => text.replaceAll(`{${String(index)}}`, value),
    translate(template),
  );
}
