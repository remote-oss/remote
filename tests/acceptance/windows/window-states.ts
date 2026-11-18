/**
 * @fileoverview The window states that the rows of F-2006 (cards #2815, #2817) read the palette in: an empty local
 * window, a window whose first connection failed and was dismissed, and the wait for the remote indicator to read a
 * text.
 */

import {
  appendScript,
  inWindow,
  nextEmptyWindow,
  openWindow,
  recordLines,
  waitFor,
} from './harness.ts';
import {dismissals} from './maintenance.ts';
import {indicatorDisconnects, statusBarText} from './renderer.ts';

/**
 * Has the renderer take the page of the launch's own `local` window for its name before another empty window opens: it
 * tells two empty windows apart only by the page it already took for a name, so a read of the new empty window made
 * first finds two pages that match.
 */
async function takingLocalPage(): Promise<void> {
  await statusBarText('local', 'status.host').catch(() => '');
}

/** An empty window of the editor, opened from the local window. */
export async function emptyLocalWindow(): Promise<string> {
  await takingLocalPage();
  return nextEmptyWindow(() => inWindow('local', 'workbench.action.newWindow'));
}

/** A window named `name` on the host `alias`, whose first connection failed and whose failure dialog was dismissed. */
export async function failedWindow(alias: string, name: string): Promise<void> {
  const mark = recordLines('failureDialog', name).length;
  appendScript(dismissals(name));
  await openWindow(alias, name);
  await waitFor(
    `the failure dialog of ${name}`,
    () => recordLines('failureDialog', name).length > mark,
    120_000,
  );
  await indicatorDisconnects(name, 5000);
}

/** Waits until the remote indicator of window `name` starts with `text`, for up to `milliseconds`. */
export function indicatorReads(
  name: string,
  text: string,
  milliseconds: number,
): Promise<void> {
  return waitFor(
    `the indicator of ${name} to read ${text}`,
    async () =>
      (await statusBarText(name, 'status.host').catch(() => '')).startsWith(
        text,
      ),
    milliseconds,
  );
}
