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

/** The settings: `lockfile` is true unless the user wrote the boolean `false`, or the text `"false"` by hand. */
export function featureSettingsOf(
  defaultFeatures: unknown,
  lockfile: unknown,
): FeatureSettings {
  return {
    defaultFeatures: defaultFeaturesOf(defaultFeatures),
    lockfile: lockfile !== false && lockfile !== 'false',
  };
}
