import {type HelperRecord, parseRecord} from '../types.ts';
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
 * Replace a stale record: read the file again and, only when it still holds `staleText`, remove it and claim once. A
 * different text means another window replaced the record meanwhile: it is not removed, and its record is answered for
 * the caller to join (an unreadable one stays `corrupt`). A file that is gone is claimed directly. A helper that
 * appears between the remove and the create wins, and the caller joins with its record; a file that appears and does
 * not parse is reported as corrupt, because it is a rival's file and not the caller's. There is no retry loop.
 */
export async function replaceStale(
  port: RegistryFilePort,
  folder: string,
  namespace: string,
  recordKey: string,
  record: HelperRecord,
  staleText: string,
): Promise<
  | {outcome: 'claimed'}
  | {outcome: 'existing'; record: HelperRecord}
  | {outcome: 'corrupt'}
> {
  const file = recordPath(folder, namespace, recordKey);
  const current = await port.read(file);
  if (current !== undefined && current !== staleText) {
    const parsed = parseRecord(current);
    return parsed === undefined
      ? {outcome: 'corrupt'}
      : {outcome: 'existing', record: parsed};
  }
  if (current !== undefined) {
    await port.remove(file);
  }
  return claim(port, folder, namespace, recordKey, record);
}
