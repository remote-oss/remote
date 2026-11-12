/**
 * @fileoverview What the files of the recent folders under a host row share (card coverage-102, part 1): the four aliases
 * of the run's file that reach the same host and the same account, the labels of the row actions, and the refresh.
 */

import {inWindow} from '../windows/harness.ts';
import {titleAction} from '../windows/renderer.ts';
import {VIEW} from '../windows/explorer-rows.ts';

/** The first of four aliases of the run's file that reach the same host and the same account. */
export const HOST_A = 'agentfwd-off';
/** The second of the four aliases. */
export const HOST_B = 'harness';
/** The third of the four aliases. */
export const HOST_C = '127.0.0.1';
/** The fourth of the four aliases. */
export const HOST_D = 'agentfwd';

/** The menu entry that connects in the current window. */
export const CURRENT = 'Connect in Current Window...';
/** The menu entry that connects in a new window. */
export const IN_NEW = 'Connect in New Window...';
/** The menu entry that removes a folder from the history. */
export const REMOVE = 'Remove from Recent List';

/** Shows the view in the local window and refreshes it, so that it reads the history as it is now. */
export async function refreshed(): Promise<void> {
  await inWindow('local', 'workbench.view.remote');
  await titleAction('local', VIEW, 'Refresh');
}
