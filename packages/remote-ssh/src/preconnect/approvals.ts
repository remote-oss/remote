/**
 * @fileoverview The record of the pre-connection scripts the user chose not to be asked about again: for each path,
 * the hash of the contents that were confirmed.
 */

import {createHash} from 'node:crypto';
import type {AcceptanceState} from '../surfaces/acceptance-store.ts';
import type {ConfirmationCopies} from './confirmation-files.ts';
import {
  confirmedKeyOf,
  type ConfirmedKey,
  type ConfirmedUpdateEnvironment,
} from '../state/confirmed-update.ts';

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

/** The name of the copy of a path: the lowercase hexadecimal SHA-256 of its UTF-8 bytes, a file name of 64 characters whatever the path. */
function copyNameOf(expandedPath: string): string {
  return createHash('sha256').update(expandedPath, 'utf8').digest('hex');
}

/**
 * The record over the editor's state memento; nothing ever removes an entry. A confirmation is read back after it is
 * written, since another window must see it. The state is one object that every window rewrites whole, so an older copy
 * can put a confirmation back out of it (#2326), and a retry reloads the window, so nothing in memory outlives it. The
 * profile therefore keeps a copy of each confirmation that was written or read in `copies` (a file each, see
 * confirmation-files.ts), written after the state and before the script runs; a copy that cannot be written is logged and does not fail the confirmation. An entry that the copies hold and the state no longer has is
 * such a revert: it is given back from the copy and written again; the state's own value wins when it has the key,
 * since another window may have confirmed changed contents.
 */
export function approvalsOf(
  state: AcceptanceState,
  copies: ConfirmationCopies,
  environment: ConfirmedUpdateEnvironment,
): PreconnectApprovals {
  const keys = new Map<string, ConfirmedKey<unknown>>();
  function confirmedFor(key: string): ConfirmedKey<unknown> {
    const confirmed =
      keys.get(key) ?? confirmedKeyOf<unknown>(state, key, environment);
    keys.set(key, confirmed);
    return confirmed;
  }
  /** The names whose copy this record has already written from the state, once each. */
  const kept = new Set<string>();
  /** Keeps the copy of a confirmation; a copy that cannot be kept is logged and never fails what the user confirmed. */
  async function keepCopy(
    expandedPath: string,
    name: string,
    hash: string,
  ): Promise<void> {
    try {
      await copies.write(name, hash);
    } catch (caught) {
      environment.logger.warn(
        `the confirmation of ${expandedPath} could not be copied to the profile's storage: ${caught instanceof Error ? caught.message : String(caught)}`,
      );
    }
  }
  return {
    hashFor: expandedPath => {
      const key = keyOf(expandedPath);
      const name = copyNameOf(expandedPath);
      const stored = state.get(key);
      if (typeof stored === 'string') {
        if (!kept.has(name)) {
          kept.add(name);
          void keepCopy(expandedPath, name, stored);
        }
        return stored;
      }
      const copy = copies.read(name);
      if (copy === undefined) {
        return undefined;
      }
      if (copy.kind === 'ignored') {
        environment.logger.info(
          copy.reason === 'it is not a hash'
            ? `the profile's copy of the confirmation of ${expandedPath} is not a hash; ignored`
            : `the profile's copy of the confirmation of ${expandedPath} is ignored: ${copy.reason}`,
        );
        return undefined;
      }
      environment.logger.info(
        `the confirmation of ${expandedPath} was missing from the global state; written again from the profile's copy`,
      );
      void confirmedFor(key).write(copy.hash);
      return copy.hash;
    },
    remember: async (expandedPath, hash) => {
      await confirmedFor(keyOf(expandedPath)).write(hash);
      await keepCopy(expandedPath, copyNameOf(expandedPath), hash);
    },
  };
}

/** The lowercase hexadecimal SHA-256 of the contents. */
export function contentHashOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
