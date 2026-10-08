/**
 * @fileoverview classifyLicence: whether a server comes under the server licence terms, which the user must accept
 * before it is installed or started. The licence gate asks; this decides.
 */

import {
  ACTIVE_LICENCE_RULES,
  LICENCE_HOSTS,
  type LicenceRuleName,
  MIT_RELEASE_PREFIXES,
  SERVER_TERMS_URL,
} from './product-table.ts';

/** What is known about the server at the moment of use. */
export interface LicenceFacts {
  /** How the server is obtained: by a download from one of the resolution steps, or by reusing an installed one. */
  readonly step: 'override' | 'productTemplate' | 'builtInTable' | 'reuse';
  /** The download URL; absent on reuse. */
  readonly downloadUrl?: string;
  /** Whether the editor's product.json lists no server licence lines. */
  readonly serverLicenseEmpty: boolean;
  /** The editor's own update URL; empty when it has none. */
  readonly updateUrl: string;
}

function hostOf(address: string): string {
  try {
    return new URL(address).hostname;
  } catch {
    // A value without a host matches no licence host.
    return '';
  }
}

const RULES: Readonly<
  Record<LicenceRuleName, (facts: LicenceFacts) => boolean>
> = {
  clientLicence: facts => !facts.serverLicenseEmpty,
  sourceBased: facts => {
    const address = facts.downloadUrl ?? '';
    const host = hostOf(address);
    const licenceHost =
      host !== '' &&
      (LICENCE_HOSTS.includes(host) ||
        (facts.updateUrl !== '' && host === hostOf(facts.updateUrl)));
    const setByUser =
      facts.step === 'override' &&
      !facts.serverLicenseEmpty &&
      !MIT_RELEASE_PREFIXES.some(prefix => address.startsWith(prefix));
    const reused = facts.step === 'reuse' && !facts.serverLicenseEmpty;
    return licenceHost || setByUser || reused;
  },
};

/** Whether any of `activeRules` puts the server under the licence terms. */
export function classifyLicence(
  facts: LicenceFacts,
  activeRules: readonly LicenceRuleName[] = ACTIVE_LICENCE_RULES,
): boolean {
  return activeRules.some(rule => RULES[rule](facts));
}

/**
 * The page of the server licence terms the user is shown: the editor's own link when its product.json lists licence
 * lines and names one, otherwise the page of the product table.
 */
export function licenceTermsUrl(
  serverLicenseEmpty: boolean,
  serverLicenseUrl: string,
): string {
  return !serverLicenseEmpty && serverLicenseUrl !== ''
    ? serverLicenseUrl
    : SERVER_TERMS_URL;
}
