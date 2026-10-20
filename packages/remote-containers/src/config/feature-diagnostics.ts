/**
 * @fileoverview The check of the `features` keys of a dev container configuration: each key that is malformed, by the
 * rule that tells a local path, a URL, a bare word and a registry id apart, becomes one problem over the whole property.
 * It looks at the text alone: nothing is fetched and nothing is resolved.
 */

import {findNodeAtLocation, type Node, parseTree} from 'jsonc-parser';

/** The English texts of the problems, which the editor's language translates. */
const FEATURE_PROBLEM_TEMPLATES = {
  absolute:
    'Absolute file paths are not allowed. Local file path must be indicated relative to the devcontainer.json.',
  insecure: 'Direct tarball references must be served over HTTPS.',
  unparsable: 'Failed to parse feature identifier.',
  releaseId: 'GitHub release feature id contains invalid characters',
  registryId: 'OCI Feature id contains invalid characters',
  legacy:
    'Legacy feature not supported. Please check https://containers.dev/features for replacements.',
} as const;

/** One problem of a key: its text, where in the file it is, and the code the hover links. */
export interface FeatureProblem {
  key: string;
  /** The offsets of the whole property, key and value. */
  range: {start: number; end: number};
  message: string;
  code: 'referencing-a-feature' | 'legacy-feature';
}

/** The characters a part of a registry path may hold. */
const REGISTRY_PART = /^[A-Za-z0-9._:-]+$/;

/** The characters a part of a three-part id may hold, and the optional version of the last. */
const RELEASE_PART = /^[A-Za-z0-9_-]+$/;
const RELEASE_LAST = /^[A-Za-z0-9_-]+(@[A-Za-z0-9._-]+)?$/;

/** The legacy features, which only a bare word can name. */
const LEGACY = new Set(['fish', 'homebrew']);

/** The message of a key that starts as a path or a URL, or none. */
function locationMessage(key: string): string | undefined {
  if (key.startsWith('/')) {
    return FEATURE_PROBLEM_TEMPLATES.absolute;
  }
  return key.startsWith('http://')
    ? FEATURE_PROBLEM_TEMPLATES.insecure
    : undefined;
}

/** Whether the key is a path or a URL that is well-formed, so that no other rule looks at it. */
function isAllowedLocation(key: string): boolean {
  return (
    key.startsWith('https://') || key.startsWith('./') || key.startsWith('../')
  );
}

/** The message of a registry id, whose first part holds a dot. */
function registryMessage(parts: readonly string[]): string | undefined {
  if (parts.length < 2) {
    return FEATURE_PROBLEM_TEMPLATES.unparsable;
  }
  if (parts.length === 2) {
    return undefined;
  }
  return parts.every(part => REGISTRY_PART.test(part))
    ? undefined
    : FEATURE_PROBLEM_TEMPLATES.registryId;
}

/** The message of an id whose first part holds no dot. */
function releaseMessage(
  key: string,
  parts: readonly string[],
): string | undefined {
  if (parts.length !== 3 || key.includes('\\')) {
    return FEATURE_PROBLEM_TEMPLATES.unparsable;
  }
  const [first = '', second = '', last = ''] = parts;
  return RELEASE_PART.test(first) &&
    RELEASE_PART.test(second) &&
    RELEASE_LAST.test(last)
    ? undefined
    : FEATURE_PROBLEM_TEMPLATES.releaseId;
}

/**
 * The message the key earns, or none when it is well-formed. The rule, in order: a path or a URL by its start; a bare
 * word, of which only the legacy ones are flagged; an id whose first part holds a dot is a registry id; any other is
 * a three-part id or unparsable.
 */
function messageOf(key: string): string | undefined {
  const located = locationMessage(key);
  if (located !== undefined || isAllowedLocation(key)) {
    return located;
  }
  if (!key.includes('/') && !key.includes('\\')) {
    return LEGACY.has(key) ? FEATURE_PROBLEM_TEMPLATES.legacy : undefined;
  }
  const parts = key.split('/') as [string, ...string[]];
  return parts[0].includes('.')
    ? registryMessage(parts)
    : releaseMessage(key, parts);
}

/** The problems of the keys of the top-level `features` object of the configuration text (JSONC), in file order. */
export function featureProblems(text: string): FeatureProblem[] {
  const root = parseTree(text, [], {allowTrailingComma: true});
  const features =
    root === undefined ? undefined : findNodeAtLocation(root, ['features']);
  if (features?.type !== 'object') {
    return [];
  }
  const problems: FeatureProblem[] = [];
  for (const property of features.children as readonly Node[]) {
    const [keyNode, valueNode] = property.children as [Node, Node | undefined];
    const message = messageOf(keyNode.value as string);
    if (message !== undefined) {
      const last = valueNode ?? keyNode;
      problems.push({
        key: keyNode.value as string,
        range: {start: keyNode.offset, end: last.offset + last.length},
        message,
        code:
          message === FEATURE_PROBLEM_TEMPLATES.legacy
            ? 'legacy-feature'
            : 'referencing-a-feature',
      });
    }
  }
  return problems;
}
