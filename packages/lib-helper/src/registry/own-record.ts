import {parseRecord} from '../types.ts';
import type {RegistryFilePort} from './file-port.ts';

/**
 * Removes the record file of a helper, and only when the record there parses and carries the helper's nonce: a record
 * of another helper stays, a file that does not parse stays, and a missing file is already clean.
 */
export async function removeOwnRecord(
  files: Pick<RegistryFilePort, 'read' | 'remove'>,
  recordFile: string,
  nonce: string,
): Promise<void> {
  const text = await files.read(recordFile);
  if (text !== undefined && parseRecord(text)?.nonce === nonce) {
    await files.remove(recordFile);
  }
}
