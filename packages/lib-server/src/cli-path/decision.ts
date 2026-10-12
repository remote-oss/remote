/**
 * @fileoverview Which way the server gets onto the host: through the editor's command-line interface, or by the
 * bootstrap script. The decision is made from facts already known, and the variables that fill the download template
 * of the command-line interface's archive.
 */

/** The facts the decision rests on. */
export interface CliPathInput {
  /** The download template of the command-line interface in the product, when it has one. */
  productCliTemplate: string | undefined;
  /** The host's operating system (`linux`, `alpine`, `darwin`, `win32`) and architecture (`x64`, `arm64`, `armhf`). */
  hostPlatform: {operatingSystem: string; architecture: string};
  /** The `<operating system>-<architecture>` tokens the product publishes command-line archives for. */
  cliBuildsAvailable: readonly string[];
  /** Whether the user's setting allows the command-line path. */
  useExecServerSetting: boolean;
  /** Whether the command-line program is already in the data folder of the host. */
  cliPresentOnHost: boolean;
  /** Whether a server that can be reused is already on the host. */
  serverPresentOnHost: boolean;
}

/** The way chosen; `download` says the command-line program is not on the host yet. */
export type CliPathDecision =
  | {
      kind: 'bootstrap';
      reason:
        'noTemplate' | 'noBuildForPlatform' | 'settingOff' | 'serverPresent';
    }
  | {kind: 'cli'; download: boolean};

/** The product facts that fill the download template. */
interface CliProfile {
  commit: string;
  quality: string;
  version: string;
}

/** Chooses the way: a server on the host is reused first, then the setting, the template and the platform decide. */
export function decideCliPath(input: CliPathInput): CliPathDecision {
  if (input.serverPresentOnHost) {
    return {kind: 'bootstrap', reason: 'serverPresent'};
  }
  if (!input.useExecServerSetting) {
    return {kind: 'bootstrap', reason: 'settingOff'};
  }
  if (input.productCliTemplate === undefined) {
    return {kind: 'bootstrap', reason: 'noTemplate'};
  }
  const {operatingSystem, architecture} = input.hostPlatform;
  if (
    !input.cliBuildsAvailable.includes(`${operatingSystem}-${architecture}`)
  ) {
    return {kind: 'bootstrap', reason: 'noBuildForPlatform'};
  }
  return {kind: 'cli', download: !input.cliPresentOnHost};
}

/** The variables of the download template for a host; the release is the version. */
export function cliArchiveTemplateVariables(
  profile: CliProfile,
  host: {operatingSystem: string; architecture: string},
): Record<string, string> {
  return Object.fromEntries([
    ['os', host.operatingSystem],
    ['arch', host.architecture],
    ['commit', profile.commit],
    ['quality', profile.quality],
    ['version', profile.version],
    ['release', profile.version],
  ]);
}
