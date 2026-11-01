/**
 * @fileoverview The configuration names this profile has connected: each connected folder's identity is kept in the
 * profile's global state, keyed by the folder and its configuration file, so that a window left disconnected by a failed
 * connect can keep the name it had. The oldest entries go past a limit.
 */

import type {IntentMemento} from '../state/timed-store.ts';
import type {WindowIdentity} from './window-identity.ts';

/** Our key in the global state, which is per profile and not synced. */
export const KNOWN_NAMES_KEY = 'remote-oss.remote-containers.connectedNames';

/** How many connected folders the profile remembers. */
export const KNOWN_NAMES_LIMIT = 200;

/** The identities by key, oldest first. */
type Stored = Record<string, WindowIdentity>;

/** The key of a folder and its configuration file. */
function keyOf(folder: string, configFile: string): string {
  return `${folder}#${configFile}`;
}

/** The entries held in `memento`, or none when its value is not a map of identities. */
function storedIn(memento: IntentMemento): Stored {
  const value = memento.get(KNOWN_NAMES_KEY);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  const stored: Stored = {};
  for (const [key, entry] of Object.entries(value)) {
    const identity = entry as {name?: unknown; context?: unknown} | null;
    if (typeof identity !== 'object' || identity === null) {
      continue;
    }
    stored[key] = {
      name: typeof identity.name === 'string' ? identity.name : undefined,
      context:
        typeof identity.context === 'string' ? identity.context : undefined,
    };
  }
  return stored;
}

/** Remembers the identity of the connection to `folder` made from `configFile`; the oldest go past the limit. */
export async function recordKnownName(
  memento: IntentMemento,
  folder: string,
  configFile: string,
  identity: WindowIdentity,
): Promise<void> {
  const key = keyOf(folder, configFile);
  // A folder connected again is the newest.
  const entries = [
    ...Object.entries(storedIn(memento)).filter(([each]) => each !== key),
    [key, identity] as const,
  ];
  const stored = Object.fromEntries(entries.slice(-KNOWN_NAMES_LIMIT));
  await memento.update(KNOWN_NAMES_KEY, stored);
}

/** The identity this profile last connected `folder` with `configFile` under; none when it never did. */
export function knownName(
  memento: IntentMemento,
  folder: string,
  configFile: string,
): WindowIdentity | undefined {
  return storedIn(memento)[keyOf(folder, configFile)];
}
