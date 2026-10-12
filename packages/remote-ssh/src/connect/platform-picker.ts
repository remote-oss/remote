/**
 * @fileoverview The question asked before any `ssh` starts when no setting names the host's platform: a pick of
 * Linux, Windows or macOS. The editor is behind a port; the picker decides nothing but what is shown and what the
 * answer means.
 */

import type {RemotePlatform} from '../pipeline/platform.ts';
import type {StringRef} from './picker-model.ts';

/** The pick as the editor shows it: a placeholder and the labels in order, the first focused. */
export interface PlatformPick {
  placeholder: StringRef;
  items: ReadonlyArray<{label: string; platform: RemotePlatform}>;
}

/** What the picker needs of the editor. */
export interface PlatformPickPort {
  /**
   * Shows the pick, single selection, no title, the first item focused, closing when the user looks away or
   * `cancellation` ends. Gives the chosen platform, or nothing when it closed without one.
   */
  pick(
    pick: PlatformPick,
    cancellation: AbortSignal,
  ): Promise<RemotePlatform | undefined>;
}

/** The pick for a host: the placeholder naming it, and the platforms, whose labels are names and not translated. */
export function platformPickOf(hostName: string): PlatformPick {
  return {
    placeholder: {id: 'platformPickPlaceholder', values: [hostName]},
    items: [
      {label: 'Linux', platform: 'linux'},
      {label: 'Windows', platform: 'windows'},
      {label: 'macOS', platform: 'macOS'},
    ],
  };
}

/** Asks for the host's platform; `cancelled` when the user closed the pick or the connect was cancelled. */
export async function pickRemotePlatform(
  port: PlatformPickPort,
  hostName: string,
  cancellation: AbortSignal,
): Promise<RemotePlatform | 'cancelled'> {
  if (cancellation.aborted) {
    return 'cancelled';
  }
  return (
    (await port.pick(platformPickOf(hostName), cancellation)) ?? 'cancelled'
  );
}
