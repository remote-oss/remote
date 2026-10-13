/**
 * @fileoverview The detector of the family companions: which of them are installed and enabled, asked across extension
 * hosts where the editor allows it. A companion once seen stays present for the detector's life, so a companion removed
 * while the window runs keeps its group until the extension host restarts.
 */

import {type CompanionId, FAMILY_COMPANIONS} from './endpoints.ts';
import type {Registration} from './protocol.ts';

/** The editor's view of installed and enabled extensions. */
export interface ExtensionLookup {
  hasExtension(extensionId: string): boolean;
  onDidChange(listener: () => void): Registration;
}

/** Whether a companion is installed and enabled. */
export type Presence = 'present' | 'absent';

/** What the detector tells Remote Explorer. */
export interface CompanionDetector extends Registration {
  isPresent(companionId: CompanionId): Presence;
  onPresenceChanged(listener: (companionId: CompanionId) => void): Registration;
}

/** A detector over the editor's lookup; the extension makes one at activation. */
export function createDetector(lookup: ExtensionLookup): CompanionDetector {
  const seen = new Set<CompanionId>();
  const listeners = new Set<{notify(companionId: CompanionId): void}>();
  let disposed = false;

  function noteSeen(): CompanionId[] {
    const arrived: CompanionId[] = [];
    for (const companionId of FAMILY_COMPANIONS) {
      if (!seen.has(companionId) && lookup.hasExtension(companionId)) {
        seen.add(companionId);
        arrived.push(companionId);
      }
    }
    return arrived;
  }

  const subscription = lookup.onDidChange(() => {
    if (disposed) {
      return;
    }
    for (const companionId of noteSeen()) {
      for (const entry of [...listeners]) {
        entry.notify(companionId);
      }
    }
  });
  noteSeen();

  return {
    isPresent: companionId => {
      if (seen.has(companionId)) {
        return 'present';
      }
      if (lookup.hasExtension(companionId)) {
        seen.add(companionId);
        return 'present';
      }
      return 'absent';
    },
    onPresenceChanged: listener => {
      const entry = {notify: listener};
      listeners.add(entry);
      return {
        dispose: () => {
          listeners.delete(entry);
        },
      };
    },
    dispose: () => {
      if (!disposed) {
        disposed = true;
        subscription.dispose();
      }
    },
  };
}
