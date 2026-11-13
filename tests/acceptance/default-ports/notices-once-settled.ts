/**
 * @fileoverview The notices of a window once the editor's own startup progress has gone, for the rows that assert that
 * no notice of an extension shows.
 */

import {waitFor} from '../windows/harness.ts';
import {notificationCentre} from '../windows/renderer.ts';

/**
 * The notifications of window `name` once the editor's own progress, "Activating Extensions...", has gone: it shows while
 * a window starts, later on a slower machine, and is the notice of no extension. Fails naming the progress when it stays.
 */
export async function noticesOnceSettled(
  name: string,
  milliseconds = 60_000,
): Promise<string[]> {
  await waitFor(
    `the editor’s activation progress in window ${name} to be gone`,
    async () =>
      !(await notificationCentre(name)).some(text =>
        text.startsWith('Activating Extensions'),
      ),
    milliseconds,
  );
  return notificationCentre(name);
}
