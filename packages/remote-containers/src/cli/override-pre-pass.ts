/**
 * @fileoverview The rewrite the CLI cannot do itself: a `${localEnv:VAR:default}` or `${env:VAR:default}` whose
 * variable is set to the empty text in the editor's environment gets its default, as the editor does. The rewrite is
 * made on the raw JSONC text, in place, so comments and layout stay.
 */

import {
  applyEdits,
  type JSONPath,
  modify,
  type ParseError,
  parse,
} from 'jsonc-parser';

/** A reference to an environment variable with a default; the default is the next piece after the name only. */
const REFERENCE = /\$\{(?:localEnv|env):([^:}]+):([^:}]*)(?::[^}]*)?\}/g;

/** The text of a string value with each reference to an empty variable replaced by its default. */
function withDefaults(
  value: string,
  environment: Readonly<Record<string, string | undefined>>,
): string {
  return value.replace(
    REFERENCE,
    (reference, name: string, fallback: string) =>
      environment[name] === '' ? fallback : reference,
  );
}

/** The string values of a parsed configuration with the paths that lead to them. */
function stringValues(
  value: unknown,
  path: JSONPath,
): Array<{path: JSONPath; value: string}> {
  if (typeof value === 'string') {
    return [{path, value}];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item: unknown, index) =>
      stringValues(item, [...path, index]),
    );
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, item]) =>
      stringValues(item, [...path, key]),
    );
  }
  return [];
}

/**
 * The configuration text with the defaults of the empty variables put in, or nothing when nothing changed or the text
 * does not parse (the CLI reads it itself then, or fails in its own words).
 */
export function overrideText(
  configText: string,
  editorEnvironment: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const errors: ParseError[] = [];
  const parsed: unknown = parse(configText, errors, {allowTrailingComma: true});
  if (errors.length > 0) {
    return undefined;
  }
  let text = configText;
  for (const {path, value} of stringValues(parsed, [])) {
    const rewritten = withDefaults(value, editorEnvironment);
    if (rewritten !== value) {
      text = applyEdits(text, modify(text, path, rewritten, {}));
    }
  }
  return text === configText ? undefined : text;
}
