/**
 * @fileoverview The relay's address: the one domain the extension talks to, read from `relay.json` beside its
 * manifest. The release build writes the file and the acceptance harness writes the run's domain into the installed
 * copy; there is no setting for it.
 */

import {readFileSync} from 'node:fs';
import path from 'node:path';

/** The file that holds the domain, beside the manifest. */
export const RELAY_FILE = 'relay.json';

/** A host name: dot-separated labels of letters, digits and inner hyphens. */
const HOST_NAME =
  /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/u;

/** The relay's domain, or why the file does not give one. */
export type RelayDomain =
  | {kind: 'domain'; domain: string}
  | {kind: 'failed'; file: string; reason: string};

/** The domain of the file `file`'s text, or the reason it gives none. */
function domainOf(text: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    const domain =
      typeof parsed === 'object' && parsed !== null
        ? (parsed as {domain?: unknown}).domain
        : undefined;
    return typeof domain === 'string' && HOST_NAME.test(domain)
      ? domain
      : undefined;
  } catch {
    return undefined;
  }
}

/** The relay's domain in the extension folder `extensionFolder`: a failure names the file and what is wrong with it. */
export function readRelayDomain(extensionFolder: string): RelayDomain {
  const file = path.join(extensionFolder, RELAY_FILE);
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (caught) {
    return {
      kind: 'failed',
      file,
      reason: `${RELAY_FILE} cannot be read: ${caught instanceof Error ? caught.message : String(caught)}`,
    };
  }
  const domain = domainOf(text);
  return domain === undefined
    ? {
        kind: 'failed',
        file,
        reason: `${RELAY_FILE} does not hold {"domain": "<host name>"}`,
      }
    : {kind: 'domain', domain};
}
