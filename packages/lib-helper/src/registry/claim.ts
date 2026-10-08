import {parseRecord, serializeRecord} from '../types.ts';
import type {HelperRecord} from '../types.ts';
import {recordPath, type RegistryFilePort} from './file-port.ts';

/**
 * Claim the record for a helper: an atomic exclusive create of its file. A helper that already
 * runs for the recordKey returns with its record; a corrupt file is reported, not fixed here.
 */
export async function claim(
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
  const path = recordPath(folder, namespace, recordKey);
  const created = await port.createExclusive(path, serializeRecord(record));
  if (created === 'created') {
    return {outcome: 'claimed'};
  }
  const existing = await port.read(path);
  const parsed = existing === undefined ? undefined : parseRecord(existing);
  return parsed === undefined
    ? {outcome: 'corrupt'}
    : {outcome: 'existing', record: parsed};
}
