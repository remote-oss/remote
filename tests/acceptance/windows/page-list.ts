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

/** How many pages, how long a title, how many remembering windows and how long a window's name a description keeps. */
const DESCRIBED_PAGES = 12;
const DESCRIBED_TITLE = 80;
const DESCRIBED_OWNERS = 4;
const DESCRIBED_NAME = 40;

/** `text` cut to `width` characters, with an ellipsis where it was cut. */
function cutTo(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, width)}…`;
}

/**
 * The pages of `found` as a failure names them: each title with the start of its id and the windows that remember it,
 * a closed one marked, so that a wait that ends on two pages with one title says which is whose. It is bounded by
 * construction: the first twelve pages, a title cut at 80 characters, four remembering windows with their names cut at
 * 40, and an `and N more` tail for what is left out.
 */
export function pagesDescription(
  found: readonly DebugTarget[],
  remembered: ReadonlyMap<string, string>,
  open: (window: string) => boolean,
): string {
  const described = found.slice(0, DESCRIBED_PAGES).map(page => {
    const owners = [...remembered]
      .filter(([, pageId]) => pageId === page.id)
      .map(
        ([window]) =>
          `${cutTo(window, DESCRIBED_NAME)}${open(window) ? '' : ' (closed)'}`,
      );
    const names =
      owners.length > DESCRIBED_OWNERS
        ? `${owners.slice(0, DESCRIBED_OWNERS).join(', ')} and ${String(owners.length - DESCRIBED_OWNERS)} more`
        : owners.join(', ');
    return `${cutTo(page.title, DESCRIBED_TITLE)} #${page.id.slice(0, 8)} ${owners.length === 0 ? 'remembered by none' : `remembered by ${names}`}`;
  });
  const left = found.length - described.length;
  return left > 0
    ? `${described.join('; ')}; and ${String(left)} more`
    : described.join('; ');
}

/** The port the editor chose, read from the file it writes in the launch's user-data folder; none while there is no port. */
export function portIn(file: string): number | undefined {
  const port = existsSync(file)
    ? Number.parseInt(readFileSync(file, 'utf8').split('\n')[0] ?? '', 10)
    : Number.NaN;
  return Number.isInteger(port) ? port : undefined;
}

/** The pages the editor lists now; none when the port or its list cannot be read. */
export async function listedPages(
  userDataFolder: string,
): Promise<DebugTarget[] | undefined> {
  const port = portIn(path.join(userDataFolder, 'DevToolsActivePort'));
  if (port === undefined) {
    return undefined;
  }
  try {
    const answer = await fetch(`http://127.0.0.1:${String(port)}/json/list`);
    const targets = (await answer.json()) as DebugTarget[];
    return targets.filter(target => target.type === 'page');
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
 * window, the page and the list's size, and the list itself: the caller tells them, and the close goes on, since a page
 * that lingers is not something a close can end.
 */
export async function waitUntilPageLeft(
  window: string,
  pageId: string,
  read: () => Promise<readonly DebugTarget[] | undefined>,
  milliseconds: number,
  pause: (milliseconds: number) => Promise<void>,
): Promise<
  | {state: 'left'}
  | {state: 'stayed'; note: string; listed: readonly DebugTarget[]}
> {
  const deadline = Date.now() + milliseconds;
  for (;;) {
    const listed = await read();
    if (listed?.some(page => page.id === pageId) !== true) {
      return {state: 'left'};
    }
    if (Date.now() > deadline) {
      return {
        state: 'stayed',
        note: lingeringPageNote(window, pageId, listed.length, milliseconds),
        listed,
      };
    }
    await pause(250);
  }
}

/** What one close of a window ended with: its page gone, or still listed with the note and the list that say so. */
export type CloseAttempt =
  | {state: 'left'}
  | {state: 'stayed'; note: string; listed: readonly DebugTarget[]};

/** The end of a close that may be sent again: the last attempt, how many were made and the note of each that left the page. */
export interface ClosedOutcome {
  last: CloseAttempt;
  tried: number;
  notes: string[];
}

/**
 * Makes `attempt` (a close of the window and the wait for its page) until the page has left the editor's list, at most
 * `attempts` times, and sends the close again only while the window is open: a close that met the window's own reload
 * (it deactivated and came back on the same page, as a window that reopens as the local folder does) is withdrawn with the
 * deactivation, and the window stays listed until a close reaches the agent it came back with. A window that is not open
 * has nothing to send a close to, so a page that stays then ends the closes.
 */
export async function closeUntilGone(
  attempt: () => Promise<CloseAttempt>,
  windowOpen: () => boolean,
  attempts: number,
): Promise<ClosedOutcome> {
  const notes: string[] = [];
  let last: CloseAttempt = {state: 'left'};
  let tried = 0;
  while (tried < attempts) {
    last = await attempt();
    tried += 1;
    if (last.state === 'left') {
      break;
    }
    notes.push(last.note);
    if (!windowOpen()) {
      break;
    }
  }
  return {last, tried, notes};
}
