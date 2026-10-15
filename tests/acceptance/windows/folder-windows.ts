/**
 * @fileoverview What the Dev Containers rows share: a local window opened on a folder, and a user setting changed and
 * read back.
 */

import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {inWindow, settingIn, waitFor, windowEvents} from './harness.ts';

/** How many times window `name` has activated its agent. */
export function activations(name: string): number {
  return windowEvents(name).filter(each => each.event === 'activated').length;
}

/** Opens a local window on `folder` and waits for its agent; the window is named after the folder. */
export async function openFolderWindow(folder: string): Promise<string> {
  const name = path.basename(folder);
  const before = activations(name);
  await inWindow(
    'local',
    'acceptance.agent.openWindow',
    pathToFileURL(folder).href,
  );
  await waitFor(
    `window ${name} to activate its agent`,
    () => activations(name) > before,
    60_000,
  );
  return name;
}

/** Sets a user setting from the local window and waits until the local window reads it back. */
export async function setUserSetting(
  settingId: string,
  value: unknown,
): Promise<void> {
  await inWindow('local', 'acceptance.agent.updateSetting', settingId, value);
  await waitFor(
    `${settingId} to read back as ${JSON.stringify(value)}`,
    async () =>
      JSON.stringify((await settingIn('local', settingId)) ?? null) ===
      JSON.stringify(value ?? null),
    30_000,
  );
}
