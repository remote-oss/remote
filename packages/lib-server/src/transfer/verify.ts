/**
 * @fileoverview The check of a downloaded archive against what the response announced, by the rules of the policy
 * record in order.
 */

import type {Verification} from '../policy/record.ts';
import type {ClientFilePort, DownloadFacts} from './ports.ts';

/** What the check found. */
export type Verdict = 'verified' | 'checksumMismatch' | 'lengthMismatch';

/**
 * Applies the first rule whose facts the response gave: `headerHash` needs an announced SHA-256, `lengthOnly` an
 * announced length, and `none` always applies and accepts. When no rule applies there is nothing to check against and
 * the archive counts as verified.
 */
export async function verifyArchive(
  file: string,
  facts: DownloadFacts,
  rules: readonly Verification[],
  files: ClientFilePort,
): Promise<Verdict> {
  for (const rule of rules) {
    if (rule === 'headerHash' && facts.announcedSha256 !== undefined) {
      const found = await files.sha256(file);
      return found === facts.announcedSha256.toLowerCase()
        ? 'verified'
        : 'checksumMismatch';
    }
    if (rule === 'lengthOnly' && facts.announcedLength !== undefined) {
      return (await files.size(file)) === facts.announcedLength
        ? 'verified'
        : 'lengthMismatch';
    }
    if (rule === 'none') {
      return 'verified';
    }
  }
  return 'verified';
}
