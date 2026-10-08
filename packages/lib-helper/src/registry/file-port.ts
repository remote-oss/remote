import {createHash} from 'node:crypto';

/**
 * The narrow file access a registry needs: an atomic exclusive create, a read, and a remove. A
 * bundle supplies the real form; tests use the in-memory port. No module touches the filesystem
 * directly; everything goes through a port.
 */
export interface RegistryFilePort {
  createExclusive(path: string, text: string): Promise<'created' | 'exists'>;
  read(path: string): Promise<string | undefined>;
  remove(path: string): Promise<void>;
}

/**
 * The record's file: under the registry folder, in the namespace folder, named by the first 32 hex
 * characters of the recordKey's digest, so the recordKey's own characters never reach a file name.
 */
export function recordPath(
  folder: string,
  namespace: string,
  recordKey: string,
): string {
  const digest = createHash('sha256')
    .update(recordKey)
    .digest('hex')
    .slice(0, 32);
  return `${folder}/${namespace}/${digest}.json`;
}
