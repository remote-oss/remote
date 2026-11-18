/**
 * @fileoverview pseudo-locale: the qps-ploc text of a pseudo-localized package, generated from its English text and
 * the strings the editor marks for keeping.
 *
 * Each of the 22 substituted letters becomes its fixed counterpart and every other character stands, so
 * `{0}`-style placeholders, `$(codicon)` names and `command:` link targets are changed letter by letter.
 */

const LETTERS = new Map<string, string>([
  ['A', 'Æ'],
  ['B', 'ß'],
  ['C', 'Ç'],
  ['D', 'Ð'],
  ['E', 'Ë'],
  ['I', 'Ï'],
  ['L', '£'],
  ['N', 'Ñ'],
  ['O', 'Ø'],
  ['S', '§'],
  ['U', 'Ü'],
  ['Y', 'Ý'],
  ['a', 'æ'],
  ['b', 'þ'],
  ['c', 'ç'],
  ['d', 'ð'],
  ['e', 'ë'],
  ['i', 'ï'],
  ['n', 'ñ'],
  ['o', 'ø'],
  ['u', 'µ'],
  ['y', 'ÿ'],
]);

/**
 * The text with each mapped letter substituted; a kept string that stands in it is copied as it is, the longest
 * kept string winning where two start at once.
 */
export function pseudoLocalize(
  text: string,
  kept: readonly string[] = [],
): string {
  const copies = kept
    .filter(part => part !== '')
    .sort((first, second) => second.length - first.length);
  let output = '';
  let index = 0;
  while (index < text.length) {
    const copy = copies.find(part => text.startsWith(part, index));
    if (copy !== undefined) {
      output += copy;
      index += copy.length;
      continue;
    }
    const unit = text.charAt(index);
    output += LETTERS.get(unit) ?? unit;
    index += 1;
  }
  return output;
}
