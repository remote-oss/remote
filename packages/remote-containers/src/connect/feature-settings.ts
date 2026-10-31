/**
 * @fileoverview The values of the two Feature settings, from the user's (global) settings: the Features to always
 * install and whether a lockfile is written. Both keys have application scope, so only the user's value counts.
 */

import type {FeatureSettings} from '../cli/cli-arguments.ts';

/** The Features the setting names when it holds an object; none for anything else. */
function defaultFeaturesOf(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * The default Features the configuration does not name: a default whose id equals a key of the configuration's `features`
 * ignoring case is dropped (BR-14), so the CLI, which merges the two lists by their ids' text, never sees both.
 */
function withoutNamed(
  defaults: Readonly<Record<string, unknown>>,
  configurationFeatures: unknown,
): Readonly<Record<string, unknown>> {
  if (
    typeof configurationFeatures !== 'object' ||
    configurationFeatures === null ||
    Array.isArray(configurationFeatures)
  ) {
    return defaults;
  }
  const named = new Set(
    Object.keys(configurationFeatures).map(key => key.toLowerCase()),
  );
  return Object.fromEntries(
    Object.entries(defaults).filter(
      ([featureId]) => !named.has(featureId.toLowerCase()),
    ),
  );
}

/**
 * The settings: `lockfile` is true unless the user wrote the boolean `false`, or the text `"false"` by hand; the
 * default Features leave out the ones `configurationFeatures`, the `features` of the configuration, already names.
 */
export function featureSettingsOf(
  defaultFeatures: unknown,
  lockfile: unknown,
  configurationFeatures?: unknown,
): FeatureSettings {
  return {
    defaultFeatures: withoutNamed(
      defaultFeaturesOf(defaultFeatures),
      configurationFeatures,
    ),
    lockfile: lockfile !== false && lockfile !== 'false',
  };
}
