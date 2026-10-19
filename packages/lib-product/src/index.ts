/**
 * @fileoverview lib-product: the running editor's product profile, and where its server archive comes from.
 */

export {
  BASE_PLACEHOLDERS,
  type Expansion,
  expand,
  type PlaceholderValues,
} from './expand.ts';
export {
  classifyLicence,
  type LicenceFacts,
  licenceTermsUrl,
} from './licence.ts';
export {
  type OverridePolicy,
  OVERRIDE_POLICIES,
  type SettingsLayer,
} from './policies.ts';
export {
  ACTIVE_LICENCE_RULES,
  allowedRedirectHosts,
  type LicenceRuleName,
  REFERENCE_LAYOUT_APPLICATION_NAMES,
  keepsReferenceLayout,
  volumeServerFolder,
} from './product-table.ts';
export {
  type ProductProfile,
  type ProfileReading,
  profileOf,
  readProfile,
  serverDataFolderNameOrDefault,
} from './profile.ts';
export {
  type RedirectRule,
  redirectAllows,
  redirectRuleFor,
} from './redirect-rule.ts';
export {type ResolutionStep} from './resolution-step.ts';
export {
  type ArchiveResolution,
  type HostPlatform,
  type OverrideValue,
  resolveServerArchive,
  type SkippedSource,
  type TemplateProblem,
} from './resolve.ts';
