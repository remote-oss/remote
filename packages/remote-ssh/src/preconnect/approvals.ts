/**
 * @fileoverview The record of the pre-connection scripts the user chose not to be asked about again: for each path,
 * the hash of the contents that were confirmed.
 */

import {createHash} from 'node:crypto';
import type {AcceptanceState} from '../surfaces/acceptance-store.ts';

/** What the step reads and writes of the record. */
export interface PreconnectApprovals {
  /** The stored content hash for the path, or nothing. */
  hashFor(expandedPath: string): string | undefined;
  remember(expandedPath: string, hash: string): Promise<void>;
}

/** The key of a path: the prefix and the path's UTF-8 bytes in standard base64, with padding. */
function keyOf(expandedPath: string): string {
  return `preconnectScriptConfirmed:${Buffer.from(expandedPath, 'utf8').toString('base64')}`;
}

/** The record over the editor's state memento; nothing ever removes an entry. */
export function approvalsOf(state: AcceptanceState): PreconnectApprovals {
  return {
    hashFor: expandedPath => {
      const stored = state.get(keyOf(expandedPath));
      return typeof stored === 'string' ? stored : undefined;
    },
    remember: async (expandedPath, hash) => {
      await state.update(keyOf(expandedPath), hash);
    },
  };
}

/** The lowercase hexadecimal SHA-256 of the contents. */
export function contentHashOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
