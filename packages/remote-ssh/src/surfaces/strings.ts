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
  return translate(template).replace(
    /\{(\d+)\}/g,
    (place: string, digits: string) => values[Number(digits)] ?? place,
  );
}

/** A stretch of a filled string: where it starts and how many characters it has, counted in the string's own characters. */
export interface TextRange {
  start: number;
  length: number;
}

/**
 * Translates the template and puts the values into its `{n}` places, and says where the values of the places in
 * `slots` ended up in the text.
 */
export function filledWithRanges(
  translate: Translate,
  template: string,
  values: readonly string[],
  slots: readonly number[],
): {text: string; ranges: TextRange[]} {
  let text = '';
  const ranges: TextRange[] = [];
  let next = 0;
  const translated = translate(template);
  for (const place of translated.matchAll(/\{(\d+)\}/g)) {
    text += translated.slice(next, place.index);
    const given = values[Number(place[1])];
    const value = given ?? place[0];
    if (
      given !== undefined &&
      given !== '' &&
      slots.includes(Number(place[1]))
    ) {
      ranges.push({start: text.length, length: value.length});
    }
    text += value;
    next = place.index + place[0].length;
  }
  return {text: text + translated.slice(next), ranges};
}
