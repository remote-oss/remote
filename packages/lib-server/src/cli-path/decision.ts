/**
 * @fileoverview Which way the server gets onto the host: through the editor's command-line interface, or by the
 * bootstrap script. The decision is made from facts already known, and the variables that fill the download template
 * of the command-line interface's archive.
 */

import {CLI_PLATFORMS} from './platforms.ts';

/** Why the direct install is used instead of the command-line program. */
export type DirectReason =
  | 'settingOff'
  | 'manualBootstrap'
  | 'noCliSource'
  | 'noBuildForPlatform'
  | 'termsToAccept';

/** The facts the decision rests on. */
export interface CliModeInput {
  /** Whether the user's `useExecServer` setting allows the command-line path. */
  useExecServerSetting: boolean;
  /** Whether the user chose the manual bootstrap for the server download. */
  manualBootstrap: boolean;
  /** The product's `cliDownloadUrlTemplate`; empty when it names none. */
  cliTemplate: string;
  /** The host's operating system (`linux`, `alpine`, `darwin`, `win32`) and architecture (`x64`, `arm64`, `armhf`). */
  hostPlatform: {operatingSystem: string; architecture: string};
  /** Whether both the command-line program's source and the server's source need no acceptance of terms. */
  sourcesFree: boolean;
}

/** The way chosen: the command-line program, or the direct install and why. */
export type CliMode = {kind: 'direct'; reason: DirectReason} | {kind: 'cli'};

/** The product facts that fill the download template. */
interface CliProfile {
  commit: string;
  quality: string;
  version: string;
}

/**
 * The install mode of one connect, judged in this order: the setting, a manual bootstrap, the product's CLI source,
 * the host's platform, and the terms. What is already installed does not decide it: reuse is judged within the mode.
 */
export function decideCliMode(input: CliModeInput): CliMode {
  if (!input.useExecServerSetting) {
    return {kind: 'direct', reason: 'settingOff'};
  }
  if (input.manualBootstrap) {
    return {kind: 'direct', reason: 'manualBootstrap'};
  }
  if (input.cliTemplate === '') {
    return {kind: 'direct', reason: 'noCliSource'};
  }
  const {operatingSystem, architecture} = input.hostPlatform;
  if (!CLI_PLATFORMS.includes(`${operatingSystem}-${architecture}`)) {
    return {kind: 'direct', reason: 'noBuildForPlatform'};
  }
  if (!input.sourcesFree) {
    return {kind: 'direct', reason: 'termsToAccept'};
  }
  return {kind: 'cli'};
}

/** The variables of the download template for a host; the release is the version. */
export function cliArchiveTemplateVariables(
  profile: CliProfile,
  host: {operatingSystem: string; architecture: string},
): Record<string, string> {
  return {
    os: host.operatingSystem,
    arch: host.architecture,
    commit: profile.commit,
    quality: profile.quality,
    version: profile.version,
    release: profile.version,
  };
}
