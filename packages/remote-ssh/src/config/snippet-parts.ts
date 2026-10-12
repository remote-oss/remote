/**
 * @fileoverview A template as the parts of a snippet: the text between its tab stops, each stop that covers text as a
 * numbered placeholder, and an empty last stop as the final stop. Pure: the editor builds the snippet from the parts.
 */

import type {Template} from './new-file.ts';

/** One part of the snippet. */
export type SnippetPart =
  | {kind: 'text'; text: string}
  | {kind: 'placeholder'; number: number; text: string}
  | {kind: 'final'};

/** The offset of a stop's place in the text, with a line feed ending each line. */
function offsetOf(lineStarts: readonly number[], line: number, column: number) {
  return (lineStarts[line] ?? 0) + column;
}

/**
 * The parts of `template`, in order. A stop that covers text is a placeholder numbered from 1; an empty last stop is the
 * final stop, the one place a snippet may have, and any other empty stop is a placeholder with no text.
 */
export function snippetPartsOf(template: Template): readonly SnippetPart[] {
  const lineStarts: number[] = [0];
  for (let index = 0; index < template.text.length; index++) {
    if (template.text[index] === '\n') {
      lineStarts.push(index + 1);
    }
  }
  const parts: SnippetPart[] = [];
  let cursor = 0;
  let number = 0;
  for (const [index, stop] of template.tabStops.entries()) {
    const start = offsetOf(lineStarts, stop.line, stop.start);
    const end = offsetOf(lineStarts, stop.line, stop.end);
    if (start > cursor) {
      parts.push({kind: 'text', text: template.text.slice(cursor, start)});
    }
    const isLast = index === template.tabStops.length - 1;
    if (start === end && isLast) {
      parts.push({kind: 'final'});
    } else {
      number += 1;
      parts.push({
        kind: 'placeholder',
        number,
        text: template.text.slice(start, end),
      });
    }
    cursor = end;
  }
  if (cursor < template.text.length) {
    parts.push({kind: 'text', text: template.text.slice(cursor)});
  }
  return parts;
}
