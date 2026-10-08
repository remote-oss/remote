/**
 * @fileoverview resolveServerArchive: where the server archive for a host comes from. The first source that gives
 * a URL wins: the extension's override setting, the product's own template, the built-in table; else there is none.
 */

import {type Expansion, expand, type PlaceholderValues} from './expand.ts';
import type {OverridePolicy, SettingsLayer} from './policies.ts';
import {BUILT_IN_SOURCES} from './product-table.ts';
import type {ProductProfile} from './profile.ts';

/** The host's platform, as the server archives name it. */
export interface HostPlatform {
  readonly operatingSystem: string;
  readonly architecture: string;
}

/** The override value the caller's adapter read, with the layer it came from. */
export interface OverrideValue {
  readonly value: string;
  readonly layer: SettingsLayer;
}

/** The step that produced the URL. */
export type ResolutionStep = 'override' | 'productTemplate' | 'builtInTable';

/** Why a template gave no URL. */
export type TemplateProblem =
  | Exclude<Expansion, {kind: 'url'}>
  | {
      readonly kind: 'unsupportedPlatform';
      readonly operatingSystem: string;
      readonly architecture: string;
    };

/** A source that was tried and skipped, for the caller's log. */
export interface SkippedSource {
  readonly step: Exclude<ResolutionStep, 'override'>;
  readonly problem: TemplateProblem;
}

/** The outcome of resolving the archive. */
export type ArchiveResolution =
  | {
      readonly kind: 'resolved';
      readonly address: string;
      readonly step: ResolutionStep;
      /** The facts the licence gate needs. */
      readonly urlHost: string;
      readonly serverLicenseEmpty: boolean;
      readonly skipped: readonly SkippedSource[];
    }
  | {
      readonly kind: 'noSource';
      readonly applicationName: string;
      readonly settingKey: string;
      readonly skipped: readonly SkippedSource[];
    }
  | {
      readonly kind: 'invalidOverride';
      readonly settingKey: string;
      readonly problem: TemplateProblem;
    };

/** The platform names of the base-URL form, by the host's `<os>-<arch>`. */
const BASE_URL_PLATFORMS = new Map([
  ['linux-x64', 'linux-x64'],
  ['linux-arm64', 'linux-arm64'],
  ['linux-armhf', 'linux-armhf'],
  ['alpine-x64', 'linux-alpine'],
  ['alpine-arm64', 'alpine-arm64'],
]);

function resolvedAt(
  profile: ProductProfile,
  address: string,
  step: ResolutionStep,
  skipped: readonly SkippedSource[],
): ArchiveResolution {
  return {
    kind: 'resolved',
    address,
    step,
    urlHost: new URL(address).hostname,
    serverLicenseEmpty: profile.serverLicense.length === 0,
    skipped,
  };
}

function expandBaseUrl(
  base: string,
  values: PlaceholderValues,
): Expansion | TemplateProblem {
  const platform = BASE_URL_PLATFORMS.get(
    `${values.operatingSystem}-${values.architecture}`,
  );
  if (platform === undefined) {
    return {
      kind: 'unsupportedPlatform',
      operatingSystem: values.operatingSystem,
      architecture: values.architecture,
    };
  }
  const archivePath = `/commit:${values.commit}/server-${platform}/${values.quality}`;
  return expand(`${base.replace(/\/+$/, '')}${archivePath}`, values, []);
}

function expandOverride(
  override: OverrideValue,
  policy: OverridePolicy,
  values: PlaceholderValues,
): Expansion | TemplateProblem {
  return policy.acceptsBaseUrl && !override.value.includes('${')
    ? expandBaseUrl(override.value, values)
    : expand(override.value, values, policy.placeholders);
}

/**
 * Resolves the archive for `host`. An override counts when it comes from a layer the policy allows, whatever its
 * value; an unusable one is `invalidOverride`. An unusable product template or table entry is skipped and reported.
 */
export function resolveServerArchive(
  profile: ProductProfile,
  host: HostPlatform,
  policy: OverridePolicy,
  override?: OverrideValue,
): ArchiveResolution {
  const values: PlaceholderValues = {
    operatingSystem: host.operatingSystem,
    architecture: host.architecture,
    commit: profile.commit,
    quality: profile.quality,
    version: profile.version,
    release: profile.release,
    applicationName: profile.applicationName,
  };
  if (override !== undefined && policy.layers.includes(override.layer)) {
    const expansion = expandOverride(override, policy, values);
    return expansion.kind === 'url'
      ? resolvedAt(profile, expansion.address, 'override', [])
      : {
          kind: 'invalidOverride',
          settingKey: policy.settingKey,
          problem: expansion,
        };
  }
  const candidates: Array<[Exclude<ResolutionStep, 'override'>, string]> = [];
  if (profile.serverDownloadUrlTemplate !== '') {
    candidates.push(['productTemplate', profile.serverDownloadUrlTemplate]);
  }
  const builtIn = BUILT_IN_SOURCES.find(
    source => source.applicationName === profile.applicationName,
  );
  if (builtIn !== undefined) {
    candidates.push(['builtInTable', builtIn.template]);
  }
  const skipped: SkippedSource[] = [];
  for (const [step, template] of candidates) {
    const expansion = expand(template, values, policy.placeholders);
    if (expansion.kind === 'url') {
      return resolvedAt(profile, expansion.address, step, skipped);
    }
    skipped.push({step, problem: expansion});
  }
  return {
    kind: 'noSource',
    applicationName: profile.applicationName,
    settingKey: policy.settingKey,
    skipped,
  };
}
