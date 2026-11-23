/**
 * @fileoverview The edits of a configuration's text that keep every other byte of it: a value appended to an array, a
 * property set. Comments, key order, indentation and line ends stay, a comma is added where one is needed, and a
 * parent object that is missing is created.
 */

import {
  applyEdits,
  type FormattingOptions,
  type JSONPath,
  modify,
  parseTree,
} from 'jsonc-parser';

/** The text does not parse as a JSON object, so there is nothing to edit. */
export class NotAnObjectError extends Error {
  /** An error that names what was wrong with the text. */
  constructor() {
    super('the text is not a JSON object');
    this.name = 'NotAnObjectError';
  }
}

/** The line ends of the text: CRLF when present, else LF. */
export function lineEndsOf(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

/** The file's own indentation: the first indented line's, two spaces when it has none. */
export function indentStepOf(text: string): string {
  const match = /^([ \t]+)\S/m.exec(text);
  return match?.[1] ?? '  ';
}

/** The formatting the file already has: its indentation and its line ends. */
function formattingOf(text: string): FormattingOptions {
  const step = indentStepOf(text);
  return {
    insertSpaces: !step.startsWith('\t'),
    tabSize: step.length,
    // eslint-disable-next-line id-length -- the option is named eol by jsonc-parser
    eol: lineEndsOf(text),
  };
}

/** The text with `value` at `path`, edited in the file's own formatting. */
function modified(text: string, path: JSONPath, value: unknown): string {
  if (parseTree(text, [])?.type !== 'object') {
    throw new NotAnObjectError();
  }
  return applyEdits(
    text,
    modify(text, path, value, {formattingOptions: formattingOf(text)}),
  );
}

/** The text with `value` appended to the array at `path`, which is created, with its parents, when it is missing. */
export function appendToArray(
  text: string,
  path: JSONPath,
  value: unknown,
): string {
  return modified(text, [...path, -1], value);
}

/** The text with the property at `path` set to `value`, added when it is missing. */
export function setProperty(
  text: string,
  path: JSONPath,
  value: unknown,
): string {
  return modified(text, path, value);
}
