/**
 * @fileoverview expand: a server archive URL template with `${name}` placeholders, made into one absolute URL.
 */

/** The placeholder values: the host's platform and the editor's own facts. */
export interface PlaceholderValues {
  readonly operatingSystem: string;
  readonly architecture: string;
  readonly commit: string;
  readonly quality: string;
  readonly version: string;
  /** Empty when the product has no release tag. */
  readonly release: string;
  readonly applicationName: string;
}

/** A placeholder name as templates write it. */
export type PlaceholderName =
  | 'os'
  | 'arch'
  | 'commit'
  | 'quality'
  | 'version'
  | 'release'
  | 'applicationName';

const VALUE_OF = new Map<PlaceholderName, keyof PlaceholderValues>([
  ['os', 'operatingSystem'],
  ['arch', 'architecture'],
  ['commit', 'commit'],
  ['quality', 'quality'],
  ['version', 'version'],
  ['release', 'release'],
  ['applicationName', 'applicationName'],
]);

/** The names every template may use; `applicationName` only where a policy allows it. */
export const BASE_PLACEHOLDERS: readonly PlaceholderName[] = [
  'os',
  'arch',
  'commit',
  'quality',
  'version',
  'release',
];

/** The outcome of an expansion: the URL, or why the template gives none. */
export type Expansion =
  | {readonly kind: 'url'; readonly address: string}
  | {readonly kind: 'unknownPlaceholder'; readonly name: string}
  | {readonly kind: 'notHttpUrl'; readonly value: string};

const PLACEHOLDER = /\$\{([^}]*)\}/g;

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    // A value the URL parser rejects is not an absolute URL.
    return false;
  }
}

/**
 * Replaces every `${name}` of `template` with its value. A name outside `allowedNames` gives
 * `unknownPlaceholder`; a result that is not an absolute http or https URL gives `notHttpUrl`. A template without
 * placeholders is one URL for every host.
 */
export function expand(
  template: string,
  values: PlaceholderValues,
  allowedNames: readonly PlaceholderName[],
): Expansion {
  const names = [...template.matchAll(PLACEHOLDER)].map(
    match => match[1] ?? '',
  );
  const unknown = names.find(
    name => !(allowedNames as readonly string[]).includes(name),
  );
  if (unknown !== undefined) {
    return {kind: 'unknownPlaceholder', name: unknown};
  }
  const address = template.replace(PLACEHOLDER, (matchedText, name: string) => {
    // Every name left here is one of allowedNames, so VALUE_OF knows it.
    const field = VALUE_OF.get(name as PlaceholderName) ?? 'version';
    return values[field];
  });
  return isHttpUrl(address)
    ? {kind: 'url', address}
    : {kind: 'notHttpUrl', value: address};
}
