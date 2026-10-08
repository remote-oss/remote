import type {HelperRecord} from '../types.ts';
import {recordPath, type RegistryFilePort} from './file-port.ts';
import {claim} from './claim.ts';

/**
 * Whether a record is stale from one hello exchange: stale when the helper does not answer with
 * the right nonce within the limit. An answer at the limit still counts as late.
 */
export function isStale(
  record: HelperRecord,
  hello: {
    answered: boolean;
    nonceMatched: boolean;
    elapsedMilliseconds: number;
  },
  limitMilliseconds: number,
): boolean {
  return (
    !hello.answered ||
    !hello.nonceMatched ||
    hello.elapsedMilliseconds >= limitMilliseconds
  );
}

/**
 * Replace a stale record: remove the file and claim once. A helper that appears between the
 * remove and the create wins, and the caller joins with its record; a file that appears and does
 * not parse is reported as corrupt, because it is a rival's file and not the caller's. There is
 * no retry loop.
 */
export async function replaceStale(
  port: RegistryFilePort,
  folder: string,
  namespace: string,
  recordKey: string,
  record: HelperRecord,
): Promise<
  | {outcome: 'claimed'}
  | {outcome: 'existing'; record: HelperRecord}
  | {outcome: 'corrupt'}
> {
  await port.remove(recordPath(folder, namespace, recordKey));
  return claim(port, folder, namespace, recordKey, record);
}
