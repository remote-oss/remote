/**
 * @fileoverview The rewrites the CLI cannot do itself, made on the raw JSONC text in place so comments and layout stay:
 * a `${localEnv:VAR:default}` or `${env:VAR:default}` whose variable is set to the empty text in the editor's
 * environment gets its default, as the editor does; and a top-level `image` that sits beside a Dockerfile build is
 * removed, so the build is tagged for the folder and a local image of the same name keeps its tag.
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

/** Whether a parsed configuration has a top-level `image` beside a Dockerfile build (`build` object or `dockerFile`). */
function imageBesideBuild(parsed: unknown): boolean {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return false;
  }
  const configuration = parsed as Record<string, unknown>;
  const build = configuration.build;
  return (
    'image' in configuration &&
    ((typeof build === 'object' && build !== null && !Array.isArray(build)) ||
      typeof configuration.dockerFile === 'string')
  );
}

/** The parsed configuration, or nothing when the text does not parse. */
function parsedConfiguration(configText: string): {value: unknown} | undefined {
  const errors: ParseError[] = [];
  const value: unknown = parse(configText, errors, {allowTrailingComma: true});
  return errors.length > 0 ? undefined : {value};
}

/** Whether the override drops the configuration's `image`, for the log line that says so. */
export function dropsImage(configText: string): boolean {
  return imageBesideBuild(parsedConfiguration(configText)?.value);
}

/**
 * The configuration text with the defaults of the empty variables put in and the `image` beside a Dockerfile build
 * taken out, or nothing when nothing changed or the text does not parse (the CLI reads it itself then, or fails in its
 * own words).
 */
export function overrideText(
  configText: string,
  editorEnvironment: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const parsed = parsedConfiguration(configText);
  if (parsed === undefined) {
    return undefined;
  }
  let text = configText;
  for (const {path, value} of stringValues(parsed.value, [])) {
    const rewritten = withDefaults(value, editorEnvironment);
    if (rewritten !== value) {
      text = applyEdits(text, modify(text, path, rewritten, {}));
    }
  }
  if (imageBesideBuild(parsed.value)) {
    text = applyEdits(text, modify(text, ['image'], undefined, {}));
  }
  return text === configText ? undefined : text;
}
