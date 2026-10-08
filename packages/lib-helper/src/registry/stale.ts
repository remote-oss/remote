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
 * remove and the create wins, and the caller joins with its record; there is no retry loop.
 */
export async function replaceStale(
  port: RegistryFilePort,
  folder: string,
  namespace: string,
  // eslint-disable-next-line id-length -- the name the registry keys its records by, fixed by the contract
  key: string,
  record: HelperRecord,
): Promise<{outcome: 'claimed'} | {outcome: 'existing'; record: HelperRecord}> {
  await port.remove(recordPath(folder, namespace, key));
  const result = await claim(port, folder, namespace, key, record);
  if (result.outcome === 'corrupt') {
    // A file that appears after the remove and does not parse is not the record of a live
    // helper; the caller proceeds as if it claimed rather than guessing at a neighbour.
    return {outcome: 'claimed'};
  }
  return result;
}
