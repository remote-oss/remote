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

function fieldOf(name: PlaceholderName): keyof PlaceholderValues {
  if (name === 'os') {
    return 'operatingSystem';
  }
  if (name === 'arch') {
    return 'architecture';
  }
  return name;
}

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

function isAllowed(
  name: string,
  allowedNames: readonly PlaceholderName[],
): name is PlaceholderName {
  return (allowedNames as readonly string[]).includes(name);
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
  let unknown: string | undefined;
  const address = template.replace(PLACEHOLDER, (matchedText, name: string) => {
    if (isAllowed(name, allowedNames)) {
      return values[fieldOf(name)];
    }
    unknown ??= name;
    return matchedText;
  });
  if (unknown !== undefined) {
    return {kind: 'unknownPlaceholder', name: unknown};
  }
  return isHttpUrl(address)
    ? {kind: 'url', address}
    : {kind: 'notHttpUrl', value: address};
}
