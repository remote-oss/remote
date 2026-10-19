/**
 * @fileoverview RedirectRule: which hosts a server download may follow a redirect to, as the resolution step that
 * chose the source decides it.
 */

import {allowedRedirectHosts} from './product-table.ts';
import type {ProductProfile} from './profile.ts';
import type {ResolutionStep} from './resolution-step.ts';

/** Which hosts a download may follow a redirect to: any host, or only the ones listed (lower case). */
export type RedirectRule =
  | {readonly kind: 'any'}
  | {readonly kind: 'hosts'; readonly hosts: readonly string[]};

/** Whether `rule` lets a download reach `host` (compared in lower case, exact; no wildcard, no port). */
export function redirectAllows(rule: RedirectRule, host: string): boolean {
  return rule.kind === 'any' || rule.hosts.includes(host.toLowerCase());
}

/**
 * The redirect rule of a download whose source `step` chose, at `host`: whoever chose the source decides which hosts
 * its download may reach. An override allows any host; the other steps allow the source host and the table's hosts
 * for it, a product template also the hosts product.json lists. The list is lower case and has no repeats.
 */
export function redirectRuleFor(
  profile: Pick<ProductProfile, 'serverDownloadRedirectHosts'>,
  step: ResolutionStep,
  host: string,
): RedirectRule {
  if (step === 'override') {
    return {kind: 'any'};
  }
  const listed =
    step === 'productTemplate' ? profile.serverDownloadRedirectHosts : [];
  const hosts = [host, ...allowedRedirectHosts(host), ...listed].map(name =>
    name.toLowerCase(),
  );
  return {kind: 'hosts', hosts: [...new Set(hosts)]};
}
