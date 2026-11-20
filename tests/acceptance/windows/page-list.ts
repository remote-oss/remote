/**
 * @fileoverview What the harness reads of the editor's page list without a window's agent: which page a folder-less
 * local window owns when several pages carry its title, who remembers each page for a failure to name, whether a closed
 * window's page has left the list, and the debugging port's own list. The choices here never ask an agent, so a window whose
 * agent is busy with a command that waits on a pick or a dialog still finds its page.
 */

import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';

/** A target of the debugging port's list. */
export interface DebugTarget {
  /** The target's id, which a window's page keeps for as long as the window lives, a reload in place included. */
  id: string;
  type: string;
  title: string;
  webSocketDebuggerUrl?: string;
}

/** The id of the page each window's name was last found by, while the window lives. */
export const REMEMBERED_PAGES = new Map<string, string>();

/**
 * The page of window `name` among `candidates`, the pages whose titles fit its state. A page the window remembered is
 * the one when it is there. Otherwise the one candidate; or, of several, the one that no other open window
 * remembered: two folder-less windows have the same title, but each keeps its own page's id. Nothing when it stays
 * ambiguous.
 */
export function pageAmong(
  candidates: readonly DebugTarget[],
  name: string,
  remembered: ReadonlyMap<string, string>,
  open: (window: string) => boolean,
): DebugTarget | undefined {
  const own = candidates.find(page => page.id === remembered.get(name));
  if (own !== undefined || candidates.length === 1) {
    return own ?? candidates[0];
  }
  const taken = new Set(
    [...remembered]
      .filter(([other]) => other !== name && open(other))
      .map(([, pageId]) => pageId),
  );
  const left = candidates.filter(page => !taken.has(page.id));
  return left.length === 1 ? left[0] : undefined;
}

/**
 * The page of the local window among `found` when two or more pages are titled `[]`: the one it remembered, else the one no
 * other open window remembered. This is what its state would give too, since a local window with no folder is the one
 * whose title is `[]`, but it asks no agent: the window's agent may be running the command that opened a pick the row waits
 * for, and it takes no other command until that pick closes. Nothing when the pages stay ambiguous, which the caller
 * leaves to its state and its wait.
 */
export function localPageAmong(
  found: readonly DebugTarget[],
  remembered: ReadonlyMap<string, string>,
  open: (window: string) => boolean,
): DebugTarget | undefined {
  return pageAmong(
    found.filter(page => page.title === '[]'),
    'local',
    remembered,
    open,
  );
}

/**
 * The pages of `found` as a failure names them: each title with the start of its id and the windows that remember it,
 * a closed one marked, so that a wait that ends on two pages with one title says which is whose.
 */
export function pagesDescription(
  found: readonly DebugTarget[],
  remembered: ReadonlyMap<string, string>,
  open: (window: string) => boolean,
): string {
  return found
    .map(page => {
      const owners = [...remembered]
        .filter(([, pageId]) => pageId === page.id)
        .map(([window]) => `${window}${open(window) ? '' : ' (closed)'}`);
      return `${page.title} #${page.id.slice(0, 8)} ${owners.length === 0 ? 'remembered by none' : `remembered by ${owners.join(', ')}`}`;
    })
    .join('; ');
}

/** The port the editor chose, read from the file it writes in the launch's user-data folder; none while there is no port. */
export function portIn(file: string): number | undefined {
  const port = existsSync(file)
    ? Number.parseInt(readFileSync(file, 'utf8').split('\n')[0] ?? '', 10)
    : Number.NaN;
  return Number.isInteger(port) ? port : undefined;
}

/** The ids of the pages the editor lists now; none when the port or its list cannot be read. */
export async function listedPageIds(
  userDataFolder: string,
): Promise<string[] | undefined> {
  const port = portIn(path.join(userDataFolder, 'DevToolsActivePort'));
  if (port === undefined) {
    return undefined;
  }
  try {
    const answer = await fetch(`http://127.0.0.1:${String(port)}/json/list`);
    const targets = (await answer.json()) as DebugTarget[];
    return targets
      .filter(target => target.type === 'page')
      .map(each => each.id);
  } catch {
    return undefined;
  }
}

/** What a close says when the window's page is still listed after its bound: the window, the page and the list's size. */
export function lingeringPageNote(
  window: string,
  pageId: string,
  listedCount: number,
  milliseconds: number,
): string {
  return `the page of window ${window} (#${pageId.slice(0, 8)}) was still listed ${String(milliseconds / 1000)} s after the window deactivated: the editor lists ${String(listedCount)} pages`;
}

/**
 * Waits until the page `pageId` of window `window`, the one it remembered, has left the editor's list, so that a row that
 * goes on after a close does not find the closed window's page beside its own. It waits on that page and no other, so a
 * window that opens or closes meanwhile neither ends the wait early nor holds it. It gives `left` when the page is gone, or
 * when the list cannot be read, since nothing can be told; and, after `milliseconds`, `stayed` with the text that names the
 * window, the page and the list's size: the caller tells it, and the close goes on, since a page that lingers is not
 * something a close can end.
 */
export async function waitUntilPageLeft(
  window: string,
  pageId: string,
  read: () => Promise<readonly string[] | undefined>,
  milliseconds: number,
  pause: (milliseconds: number) => Promise<void>,
): Promise<{state: 'left'} | {state: 'stayed'; note: string}> {
  const deadline = Date.now() + milliseconds;
  for (;;) {
    const listed = await read();
    if (!listed?.includes(pageId)) {
      return {state: 'left'};
    }
    if (Date.now() > deadline) {
      return {
        state: 'stayed',
        note: lingeringPageNote(window, pageId, listed.length, milliseconds),
      };
    }
    await pause(250);
  }
}
