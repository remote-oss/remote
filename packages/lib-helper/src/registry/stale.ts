/**
 * @fileoverview Whether a recorded helper is gone, and the one replacement of its record.
 */

import type {HelperRecord} from '../types.ts';
import {claim, recordPath} from './claim.ts';
import type {RegistryFilePort} from './file-port.ts';

/** What the hello to a recorded helper showed. */
export interface HelloResult {
  answered: boolean;
  /** Whether the answer repeated the record's nonce. */
  nonceMatched: boolean;
  elapsedMilliseconds: number;
}

/**
 * Whether the recorded helper is to be replaced: it did not answer, answered with another nonce, or took the
 * limit or longer.
 */
export function isStale(
  record: HelperRecord,
  hello: HelloResult,
  limitMilliseconds: number,
): boolean {
  return (
    !hello.answered ||
    !hello.nonceMatched ||
    hello.elapsedMilliseconds >= limitMilliseconds
  );
}

/**
 * Removes the stale record and claims the key once. When another helper claims it in between, its record is the
 * outcome; the replacement never retries.
 */
export async function replaceStale(
  port: RegistryFilePort,
  folder: string,
  namespace: string,
  subject: string,
  record: HelperRecord,
): Promise<{outcome: 'claimed'} | {outcome: 'existing'; record: HelperRecord}> {
  await port.remove(recordPath(folder, namespace, subject));
  const outcome = await claim(port, folder, namespace, subject, record);
  if (outcome.outcome === 'corrupt') {
    throw new Error(
      `helper record of '${namespace}' is unreadable after its replacement`,
    );
  }
  return outcome;
}
