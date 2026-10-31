/**
 * @fileoverview The renderer of a plainly started editor, read and clicked over the Chrome DevTools Protocol, as a user
 * sees and uses the window: a view's rows, a click on a row's or a view's action, and core's dialogs, read and
 * answered. Only a launch with a debugging port has it. The editor writes the port it chose into the user-data folder,
 * and a window's title follows the launch's `window.title`: the folder name in brackets, the remote name after it on
 * the explorer launches, so that a window is found by what its agent reports of it. The selectors read the workbench
 * of the run's pinned VSCodium build.
 */

import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {isOpen, variable, windowState} from './harness.ts';

/** How long a wait for the renderer lasts, in milliseconds. */
const WAIT_MILLISECONDS = 60_000;

const POLL_MILLISECONDS = 200;

/** A row of a view, as the window shows it. */
export interface ViewRow {
  label: string;
  description: string;
  level: number;
  expanded: boolean | undefined;
}

/** A target of the debugging port's list. */
interface DebugTarget {
  /** The target's id, which a window's page keeps for as long as the window lives, a reload in place included. */
  id: string;
  type: string;
  title: string;
  webSocketDebuggerUrl?: string;
}

/** The answer of the protocol's `Runtime.evaluate`. */
interface EvaluateAnswer {
  id: number;
  result?: {
    result?: {value?: unknown};
    exceptionDetails?: {
      text: string;
      exception?: {description?: string};
    };
  };
  error?: {message: string};
}

/** A dialog of core's, as the window shows it: its message, its detail and its buttons' labels in order. */
export interface ShownDialog {
  message: string;
  details: string;
  buttons: string[];
}

/** Polls `attempt` until it gives a value, for up to `milliseconds`; it fails naming what it waited for. */
async function settled<Value>(
  description: () => string,
  attempt: () => Promise<Value | undefined>,
  milliseconds = WAIT_MILLISECONDS,
): Promise<Value> {
  const deadline = Date.now() + milliseconds;
  for (;;) {
    const value = await attempt();
    if (value !== undefined) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${description()}`);
    }
    await new Promise(resolve => setTimeout(resolve, POLL_MILLISECONDS));
  }
}

/** The port the editor chose, from the file it writes in the launch's user-data folder. */
async function debuggingPort(): Promise<number> {
  const file = path.join(variable('HARNESS_USER_DATA'), 'DevToolsActivePort');
  return settled(
    () => `the editor's debugging port in ${file}`,
    () => {
      const port = existsSync(file)
        ? Number.parseInt(readFileSync(file, 'utf8').split('\n')[0] ?? '', 10)
        : Number.NaN;
      return Promise.resolve(Number.isInteger(port) ? port : undefined);
    },
  );
}

/** What a window reports of itself for the page choice: its folders, and the remote it is on. */
export interface PageState {
  folders: readonly string[];
  remoteName: string | null;
  /** The window's workspace file, or null (or absent) for a folder window. */
  workspaceFile?: string | null;
}

/** The window title's part of a folder: its name in the last path part, decoded from the URI's percent-encoding. */
function folderName(folder: string): string {
  const encoded = path.basename(folder);
  try {
    return decodeURIComponent(encoded);
  } catch {
    // A name with a stray percent sign has no decoding.
    return encoded;
  }
}

/**
 * The name core gives a workspace window in its title, `<file name without .code-workspace> (Workspace)`, and
 * `Untitled (Workspace)` for one that isn't saved ([oss] `src/vs/platform/workspace/common/workspace.ts`).
 */
function workspaceTitleName(workspaceFile: string): string {
  if (workspaceFile.startsWith('untitled:')) {
    return 'Untitled (Workspace)';
  }
  return `${folderName(workspaceFile).replace(/\.code-workspace$/, '')} (Workspace)`;
}

/** The test of a title for a window of this state: the workspace's name, the folder name in brackets (a remote window's followed by its remote name), or `[]`. */
function titleMatcher(state: PageState): (title: string) => boolean {
  const folder = state.folders[0];
  const workspaceFile = state.workspaceFile ?? null;
  const bracketed =
    workspaceFile !== null
      ? workspaceTitleName(workspaceFile)
      : folder === undefined
        ? undefined
        : folderName(folder);
  return title =>
    bracketed === undefined
      ? state.remoteName === null
        ? title === '[]'
        : title.startsWith('[]') && title !== '[]'
      : title === `[${bracketed}]` ||
        title.startsWith(`[${bracketed} [`) ||
        (state.remoteName !== null && title.startsWith(`[${bracketed}]`));
}

/**
 * The title of the page of a window with this state among `titles`: the workspace's name for a workspace window, else
 * the folder name in brackets, `[]` for a local window with no folder, and `[]` plus the remote name for a remote one.
 * It fails when two titles match, naming both. Pages with the same title are told apart by `pageAmong`.
 */
export function pageTitleFor(
  state: PageState,
  titles: readonly string[],
): string | undefined {
  const matching = titles.filter(titleMatcher(state));
  if (matching.length > 1) {
    throw new Error(
      `two pages match the window's state: ${JSON.stringify(matching)}`,
    );
  }
  return matching[0];
}

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

/** The id of the page each window's name was last found by, while the window lives. */
const REMEMBERED_PAGES = new Map<string, string>();

/** The pages of the renderer, from the debugging port's list. */
async function pages(): Promise<DebugTarget[]> {
  const answer = await fetch(
    `http://127.0.0.1:${String(await debuggingPort())}/json/list`,
  );
  const targets = (await answer.json()) as DebugTarget[];
  return targets.filter(target => target.type === 'page');
}

/** The number of renderer pages, one per open window: a window that reloads in place keeps its page count. */
export async function pageCount(): Promise<number> {
  return (await pages()).length;
}

/**
 * The one title among `titles` that window `name`'s folder name gives, `[<name>]` or `[<name> [...`, `[]` for `local`;
 * none when no title or more than one fits. It needs nothing from the window's agent, so it finds the page of a window
 * whose agent is busy, for example with a command that waits on a modal dialog.
 */
export function pageTitleByName(
  name: string,
  titles: readonly string[],
): string | undefined {
  const matching = titles.filter(title =>
    name === 'local'
      ? title === '[]'
      : title === `[${name}]` || title.startsWith(`[${name} [`),
  );
  return matching.length === 1 ? matching[0] : undefined;
}

/**
 * The state of window `name` for the page choice, or `undefined` when it doesn't arrive within `remaining`
 * milliseconds: a window that never reports a page of its own fails with the titles, not the agent's wait.
 */
async function stateForPage(
  name: string,
  remaining: number,
): Promise<Awaited<ReturnType<typeof windowState>> | undefined> {
  const state = windowState(name);
  state.catch(() => undefined);
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      state,
      new Promise<undefined>(resolve => {
        timer = setTimeout(resolve, remaining, undefined);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The protocol address of window `name`'s page: the one page its name gives a title to, or else the one page that
 * carries the title its state gives it (a folder-less window, or a folder name the title decodes).
 */
export async function pageOf(
  name: string,
  milliseconds = WAIT_MILLISECONDS,
): Promise<string> {
  let titles: string[] = [];
  const started = Date.now();
  return settled(
    () => `one page of window ${name} among ${JSON.stringify(titles)}`,
    async () => {
      const found = await pages();
      titles = found.map(page => page.title);
      const named = pageTitleByName(name, titles);
      if (named !== undefined) {
        const page = found.find(each => each.title === named);
        if (page !== undefined) {
          REMEMBERED_PAGES.set(name, page.id);
        }
        return page?.webSocketDebuggerUrl;
      }
      const remembered = found.find(
        page => page.id === REMEMBERED_PAGES.get(name),
      );
      if (remembered !== undefined && isOpen(name)) {
        return remembered.webSocketDebuggerUrl;
      }
      const state = await stateForPage(
        name,
        milliseconds - (Date.now() - started),
      );
      if (state === undefined) {
        return undefined;
      }
      const matches = titleMatcher({
        folders: state.folders,
        remoteName: state.remoteName,
        workspaceFile: state.workspaceFile,
      });
      const candidates = found.filter(page => matches(page.title));
      const chosen = pageAmong(candidates, name, REMEMBERED_PAGES, isOpen);
      if (chosen === undefined && candidates.length > 1) {
        throw new Error(
          `two pages match the window's state: ${JSON.stringify(candidates.map(page => page.title))}`,
        );
      }
      if (chosen !== undefined) {
        REMEMBERED_PAGES.set(name, chosen.id);
      }
      return chosen?.webSocketDebuggerUrl;
    },
    milliseconds,
  );
}

/**
 * Remembers the page window `name` has now, so that a later window with the same title, a further folder-less local
 * one, is told apart from it. A suite that opens such a window calls it for `local` before the first one opens.
 */
export async function rememberPage(name: string): Promise<void> {
  await pageOf(name);
}

/** Evaluates `expression` in the page at protocol address `address` and returns its value; `owner` names the page in a failure. */
async function evaluateAt<Value>(
  address: string,
  owner: string,
  expression: string,
): Promise<Value> {
  const socket = new WebSocket(address);
  try {
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => {
        resolve();
      });
      socket.addEventListener('error', () => {
        reject(new Error(`no protocol connection to ${owner}`));
      });
    });
    const answer = await new Promise<EvaluateAnswer>(resolve => {
      socket.addEventListener('message', event => {
        resolve(JSON.parse(String(event.data)) as EvaluateAnswer);
      });
      socket.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: {expression, returnByValue: true, awaitPromise: true},
        }),
      );
    });
    const failure =
      answer.error?.message ??
      answer.result?.exceptionDetails?.exception?.description ??
      answer.result?.exceptionDetails?.text;
    if (failure !== undefined) {
      throw new Error(`${owner}: ${failure}`);
    }
    return answer.result?.result?.value as Value;
  } finally {
    socket.close();
  }
}

/** Evaluates `expression` in window `name`'s page and returns its value; a thrown error fails with its text. */
async function evaluate<Value>(
  name: string,
  expression: string,
): Promise<Value> {
  return evaluateAt(await pageOf(name), `window ${name}`, expression);
}

/** How many terminals' text areas window `name`'s page holds and the titles of its terminal tabs. */
export interface TerminalPageFacts {
  rows: number;
  tabs: string[];
}

/** How long the page may take to answer a read of its terminals, in milliseconds. */
const PAGE_FACTS_MILLISECONDS = 10_000;

/** What window `name`'s page holds of terminals, or `unavailable` when it does not answer within 10 s. */
export async function terminalPageFacts(
  name: string,
): Promise<TerminalPageFacts | 'unavailable'> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<'unavailable'>(resolve => {
    timer = setTimeout(() => {
      resolve('unavailable');
    }, PAGE_FACTS_MILLISECONDS);
  });
  try {
    return await Promise.race([
      evaluate<TerminalPageFacts>(
        name,
        `({
          rows: document.querySelectorAll('.xterm-rows').length,
          tabs: [...document.querySelectorAll('.terminal-tabs-entry')].map(each => (each.textContent ?? '').trim()),
        })`,
      ),
      expired,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** The page-side lookup of a view's pane by its header title; `undefined` when no pane has it. */
function paneExpression(viewName: string): string {
  return `[...document.querySelectorAll('.pane')].find(pane => pane.querySelector('.pane-header .title')?.textContent === ${JSON.stringify(viewName)})`;
}

/** A row of a view as the list renders it now, with the size of the set it belongs to. */
export interface RenderedRow {
  label: string;
  description: string;
  level: number;
  setSize: number;
}

/**
 * The rows view `viewName` of window `name` renders now, without scrolling: a virtualized list's viewport only, each
 * with its `aria-setsize`, which counts the rows of its set also when they are off screen; none when the view isn't
 * there.
 */
export async function renderedRows(
  name: string,
  viewName: string,
): Promise<RenderedRow[]> {
  return evaluate<RenderedRow[]>(
    name,
    `(() => {
      const pane = ${paneExpression(viewName)};
      return [...(pane?.querySelectorAll('[role="treeitem"]') ?? [])]
        .filter(row => row.getAttribute('aria-level') !== null)
        .map(row => ({
          label: row.querySelector('.label-name')?.textContent ?? '',
          description: row.querySelector('.label-description')?.textContent ?? '',
          level: Number(row.getAttribute('aria-level')),
          setSize: Number(row.getAttribute('aria-setsize')),
        }));
    })()`,
  );
}

/**
 * The rows of view `viewName` in window `name`, in the order shown; `undefined` when the window has no such view. A
 * virtualized list keeps only the rows of its viewport in the DOM, so a list that overflows its container is read by
 * wheel-scrolling the container in steps and collecting every row it shows, then wheeling it back to where it was for
 * the next user action. The wheel's sign that scrolls the list down varies with the build, so it is probed, and a list
 * that overflows moves for exactly one of the two.
 */
export async function viewRows(
  name: string,
  viewName: string,
): Promise<ViewRow[] | undefined> {
  const rows = await evaluate<Array<
    Omit<ViewRow, 'expanded'> & {expanded: boolean | null}
  > | null>(
    name,
    `(async () => {
      const pane = ${paneExpression(viewName)};
      if (pane === undefined) {
        return null;
      }
      const read = () =>
        [...pane.querySelectorAll('[role="treeitem"]')]
          .filter(row => row.getAttribute('aria-level') !== null)
          .map(row => ({
            label: row.querySelector('.label-name')?.textContent ?? '',
            description: row.querySelector('.label-description')?.textContent ?? '',
            level: Number(row.getAttribute('aria-level')),
            // null across the protocol: a row without the attribute is not expanded.
            expanded: row.hasAttribute('aria-expanded') ? row.getAttribute('aria-expanded') === 'true' : null,
          }));
      const overflow = [...pane.querySelectorAll('*')].filter(el =>
        el.scrollHeight > el.clientHeight + 1 &&
        el.querySelector('[role="treeitem"]') !== null
      );
      const list = overflow.find(el =>
        overflow.every(other => other === el || !other.contains(el))
      );
      if (list === undefined) {
        return read();
      }
      const seen = new Map();
      const order = [];
      const collect = () => {
        for (const row of read()) {
          const key = String(row.level) + ':' + row.label;
          // The first reading wins: the read starts at the list's top, so a header the scrolled view
          // pins again keeps the values of its first reading.
          if (!seen.has(key)) {
            order.push(key);
            seen.set(key, row);
          }
        }
      };
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      // The first and the last rendered rows: a list that overflows by less than a row moves its last row in while the
      // first stays, so the first alone does not tell that the list moved.
      const first = () => {
        const rows = [...pane.querySelectorAll('[role="treeitem"]')];
        const label = row => row?.querySelector('.label-name')?.textContent ?? '';
        return label(rows[0]) + '\u0000' + label(rows.at(-1));
      };
      // A wheel moves the list with a smooth scroll, so the next wheel waits for the move to settle.
      const move = async delta => {
        const before = first();
        list.dispatchEvent(
          new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            deltaY: delta,
            deltaMode: 0,
          })
        );
        await wait(600);
        return first() !== before;
      };
      const topFirst = first();
      collect();
      let down = 0;
      if (await move(-400)) {
        down = -400;
        collect();
      } else if (await move(400)) {
        down = 400;
        collect();
      }
      let steps = 0;
      while (down !== 0 && steps < 200) {
        if (!(await move(down))) {
          break;
        }
        collect();
        steps += 1;
      }
      while (down !== 0 && steps < 200) {
        await move(-down);
        if (first() === topFirst) {
          break;
        }
        steps += 1;
      }
      await wait(200);
      collect();
      return order.map(key => seen.get(key));
    })()`,
  );
  // The protocol returns values as JSON, where `expanded: undefined` would drop: read it back as it is.
  return (
    rows?.map(each => ({
      ...each,
      expanded: each.expanded ?? undefined,
    })) ?? undefined
  );
}

/**
 * Clicks the action titled `actionTitle` in the part of view `viewName` that `scope` finds, as a user's click. It fails
 * naming what it did not find.
 */
async function clickAction(
  name: string,
  viewName: string,
  scope: string,
  actionTitle: string,
): Promise<void> {
  const missing = await evaluate<string | null>(
    name,
    `(() => {
      const pane = ${paneExpression(viewName)};
      if (pane === undefined) {
        return 'no view ' + ${JSON.stringify(viewName)};
      }
      const scopes = ${scope};
      if (scopes.length !== 1) {
        return scopes.length + ' places for the action';
      }
      const action = [...scopes[0].querySelectorAll('.actions .action-label')].find(
        label => label.getAttribute('aria-label') === ${JSON.stringify(actionTitle)},
      );
      if (action === undefined) {
        return 'no action ' + ${JSON.stringify(actionTitle)};
      }
      action.click();
      return null;
    })()`,
  );
  if (missing !== null) {
    throw new Error(`window ${name}, view ${viewName}: ${missing}`);
  }
}

/** Clicks the inline action `actionTitle` of the one row labelled `rowLabel` in view `viewName` of window `name`. */
export async function rowAction(
  name: string,
  viewName: string,
  rowLabel: string,
  actionTitle: string,
): Promise<void> {
  await clickAction(
    name,
    viewName,
    `[...pane.querySelectorAll('[role="treeitem"]')].filter(row => row.querySelector('.label-name')?.textContent === ${JSON.stringify(rowLabel)})`,
    actionTitle,
  );
}

/** The titles of the title actions of view `viewName` in window `name`, in the order shown; none when the view is not there. */
export async function titleActions(
  name: string,
  viewName: string,
): Promise<string[]> {
  return evaluate<string[]>(
    name,
    `(() => {
      const pane = ${paneExpression(viewName)};
      return pane === undefined
        ? []
        : [...pane.querySelectorAll('.pane-header .actions .action-label')].map(label => label.getAttribute('aria-label') ?? '');
    })()`,
  );
}

/** Clicks the title action `actionTitle` of view `viewName` in window `name`. */
export async function titleAction(
  name: string,
  viewName: string,
  actionTitle: string,
): Promise<void> {
  await clickAction(
    name,
    viewName,
    `[...pane.querySelectorAll('.pane-header')]`,
    actionTitle,
  );
}

/** Clicks the twistie of the one row labelled `rowLabel` in view `viewName` of window `name`, which collapses or expands it. */
export async function toggleRow(
  name: string,
  viewName: string,
  rowLabel: string,
): Promise<void> {
  const missing = await evaluate<string | null>(
    name,
    `(() => {
      const pane = ${paneExpression(viewName)};
      if (pane === undefined) {
        return 'no view ' + ${JSON.stringify(viewName)};
      }
      const rows = [...pane.querySelectorAll('[role="treeitem"]')].filter(row => row.querySelector('.label-name')?.textContent === ${JSON.stringify(rowLabel)});
      if (rows.length !== 1) {
        return rows.length + ' rows labelled ' + ${JSON.stringify(JSON.stringify(rowLabel))};
      }
      rows[0].querySelector('.monaco-tl-twistie').click();
      return null;
    })()`,
  );
  if (missing !== null) {
    throw new Error(`window ${name}, view ${viewName}: ${missing}`);
  }
}

/**
 * The labels of the context menu that a right click on the row `rowLabel` of view `viewName` in window `name` opens, in
 * order; none when it opens no menu. The menu is closed again. It fails naming the row when the view has none by that
 * label.
 */
export async function rowContextMenu(
  name: string,
  viewName: string,
  rowLabel: string,
): Promise<string[]> {
  const menu = await evaluate<string[] | null>(
    name,
    `(async () => {
      const pane = ${paneExpression(viewName)};
      const rows = [...(pane?.querySelectorAll('[role="treeitem"]') ?? [])].filter(row => row.querySelector('.label-name')?.textContent === ${JSON.stringify(rowLabel)});
      if (rows.length !== 1) {
        return null;
      }
      const box = rows[0].getBoundingClientRect();
      rows[0].dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true, button: 2, clientX: box.left + 20, clientY: box.top + 5}));
      await new Promise(resolve => setTimeout(resolve, 800));
      const labels = [...document.querySelectorAll('.context-view .monaco-menu .action-label')].map(label => label.textContent ?? '');
      for (const type of ['keydown', 'keyup']) {
        (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent(type, {key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true}));
      }
      return labels;
    })()`,
  );
  if (menu === null) {
    throw new Error(
      `window ${name}, view ${viewName}: not one row labelled ${JSON.stringify(rowLabel)}`,
    );
  }
  return menu;
}

/** One section of the Extensions view: its title and the display names of its entries. */
export interface ExtensionsSection {
  title: string;
  entries: string[];
}

/** The sections of the Extensions view of window `name`, in order, with the entries each lists. */
export async function extensionsViewSections(
  name: string,
): Promise<ExtensionsSection[]> {
  return evaluate<ExtensionsSection[]>(
    name,
    `[...document.querySelectorAll('.extensions-viewlet .split-view-view')].map(pane => ({
      title: pane.querySelector('.pane-header .title')?.textContent ?? '',
      entries: [...pane.querySelectorAll('.extension-list-item .name')].map(entry => entry.textContent ?? ''),
    }))`,
  );
}

/**
 * The labels of the context menu that a right click on the entry `displayName` of the Extensions view in window `name`
 * opens, in order. The menu is closed again. It fails naming the entry when the view lists it not once.
 */
export async function extensionContextMenu(
  name: string,
  displayName: string,
): Promise<string[]> {
  const menu = await evaluate<string[] | null>(
    name,
    `(async () => {
      const rows = [...document.querySelectorAll('.extensions-viewlet .extension-list-item')].filter(row => row.querySelector('.name')?.textContent === ${JSON.stringify(displayName)});
      if (rows.length !== 1) {
        return null;
      }
      const box = rows[0].getBoundingClientRect();
      rows[0].dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true, button: 2, clientX: box.left + 20, clientY: box.top + 5}));
      await new Promise(resolve => setTimeout(resolve, 800));
      const labels = [...document.querySelectorAll('.context-view .monaco-menu .action-label')].map(label => label.textContent ?? '').filter(label => label !== '');
      for (const type of ['keydown', 'keyup']) {
        (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent(type, {key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true}));
      }
      return labels;
    })()`,
  );
  if (menu === null) {
    throw new Error(
      `window ${name}: not one Extensions entry named ${JSON.stringify(displayName)}`,
    );
  }
  return menu;
}

/**
 * Whether the entry `displayName` of the Extensions view in window `name` shows its status marker, the icon core puts
 * on an extension that Restricted Mode limits or disables; `undefined` when the view lists no such entry.
 */
export async function extensionStatusShown(
  name: string,
  displayName: string,
): Promise<boolean | undefined> {
  return evaluate<boolean | undefined>(
    name,
    `(() => {
      const row = [...document.querySelectorAll('.extensions-viewlet .extension-list-item')].find(each => each.querySelector('.name')?.textContent === ${JSON.stringify(displayName)});
      const status = row?.querySelector('.extension-status');
      return status === undefined || status === null ? undefined : !status.classList.contains('hide');
    })()`,
  );
}

/** One row of core's Ports view. */
export interface PortsRow {
  /** The Port column as shown: `<label> (<port or key>)`, or the port or key alone. */
  port: string;
  forwardedAddress: string;
  runningProcess: string;
  origin: string;
  /** The row icon's codicon class, e.g. `codicon-ports-forwarded-with-process-icon`. */
  icon: string;
  /** The row's hover, non-breaking spaces read as spaces, as `statusItem` reads a hover. */
  tooltip: string;
}

/** The page-side lookup of the rows of core's Ports view, without its "Add Port" row, as each row's cells. */
const PORTS_ROWS_EXPRESSION = `(() => {
  const pane = ${paneExpression('Ports')};
  return [...(pane?.querySelectorAll('.monaco-table-tr') ?? [])]
    .map(row => ({
      row,
      cells: [...row.querySelectorAll('.monaco-table-td')].map(cell => (cell.textContent ?? '').replaceAll('\\u00a0', ' ').trim()),
    }))
    .filter(entry => entry.cells[1] !== 'Add Port');
})()`;

/**
 * The rows of core's Ports view in window `name`, in the order shown. A table that overflows its container keeps only
 * the rows of its viewport in the DOM, so it is read from its top, a viewport at a time, and scrolled back after.
 */
export async function portsRows(name: string): Promise<PortsRow[]> {
  const rows = await evaluate<PortsRow[] | string>(
    name,
    `(async () => {
      const pane = ${paneExpression('Ports')};
      if (pane === undefined || pane.querySelector('.monaco-table') === null) {
        return 'no Ports table';
      }
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const seen = new Map();
      const order = [];
      const readRow = async ({row, cells}) => {
        const icon = [...(row.querySelector('.codicon')?.classList ?? [])].find(each => each.startsWith('codicon-') && each !== 'codicon-modifier-spin') ?? '';
        const target = row.querySelectorAll('.monaco-table-td')[1].querySelector('.monaco-icon-label');
        for (const type of ['mouseenter', 'mouseover', 'mousemove']) {
          target.dispatchEvent(new MouseEvent(type, {bubbles: true, clientX: target.getBoundingClientRect().left + 5, clientY: target.getBoundingClientRect().top + 5}));
        }
        let hover = '';
        for (let tries = 0; tries < 30 && hover === ''; tries += 1) {
          await wait(100);
          hover = (document.querySelector('.workbench-hover, .monaco-hover')?.textContent ?? '').replaceAll('\\u00a0', ' ').trim();
        }
        for (const type of ['mouseleave', 'mouseout']) {
          target.dispatchEvent(new MouseEvent(type, {bubbles: true}));
        }
        for (let tries = 0; tries < 20 && document.querySelector('.workbench-hover') !== null; tries += 1) {
          await wait(100);
        }
        return {port: cells[1] ?? '', forwardedAddress: cells[2] ?? '', runningProcess: cells[3] ?? '', origin: cells[4] ?? '', icon, tooltip: hover};
      };
      const collect = async () => {
        for (const entry of ${PORTS_ROWS_EXPRESSION}) {
          const key = entry.cells[1] + '|' + entry.cells[4];
          if (!seen.has(key)) {
            seen.set(key, await readRow(entry));
            order.push(key);
          }
        }
      };
      const list = pane.querySelector('.monaco-table .monaco-list');
      const first = () => (${PORTS_ROWS_EXPRESSION}[0]?.cells[1] ?? '');
      // A wheel moves the list with a smooth scroll, so the next one waits for the move to settle; a step stays under
      // the rows of a viewport so that no row passes unseen. The wheel's sign that scrolls down varies with the build.
      const move = async delta => {
        const before = first();
        pane.querySelector('.monaco-table-tr').dispatchEvent(new WheelEvent('wheel', {bubbles: true, cancelable: true, deltaY: delta, deltaMode: 0}));
        await wait(600);
        return first() !== before;
      };
      // The rows come after the table: a read of no row at all is no position to scroll back to.
      for (let tries = 0; tries < 30 && first() === ''; tries += 1) {
        await wait(100);
      }
      const step = Math.max(44, Math.floor(list.clientHeight / 2));
      const topFirst = first();
      await collect();
      let down = 0;
      if (await move(-step)) {
        down = -step;
      } else if (await move(step)) {
        down = step;
      }
      let steps = 0;
      while (down !== 0 && steps < 100) {
        await collect();
        if (!(await move(down))) {
          break;
        }
        steps += 1;
      }
      await collect();
      while (down !== 0 && steps < 200 && first() !== topFirst) {
        await move(-down);
        steps += 1;
      }
      return order.map(key => seen.get(key));
    })()`,
  );
  if (typeof rows === 'string') {
    throw new Error(`window ${name}: ${rows}`);
  }
  return rows;
}

/** The titles of row `port`'s inline actions on hover, and of its context menu's items, in order. */
export async function portRowActions(
  name: string,
  port: string,
): Promise<{inline: string[]; menu: string[]}> {
  const found = await evaluate<{inline: string[]; menu: string[]} | null>(
    name,
    `(async () => {
      const entries = ${PORTS_ROWS_EXPRESSION};
      const entry = entries.find(each => each.cells[1] === ${JSON.stringify(port)});
      if (entry === undefined) {
        return null;
      }
      entry.row.dispatchEvent(new MouseEvent('mouseover', {bubbles: true}));
      await new Promise(resolve => setTimeout(resolve, 500));
      const inline = [...entry.row.querySelectorAll('.actions-container .action-label')].map(label => (label.getAttribute('aria-label') ?? label.getAttribute('title') ?? label.textContent ?? '').replace(/ \\([^)]*\\)$/, ''));
      const box = entry.row.getBoundingClientRect();
      entry.row.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true, button: 2, clientX: box.left + 20, clientY: box.top + 5}));
      for (let tries = 0; tries < 30 && document.querySelector('.context-view .monaco-menu .action-label') === null; tries += 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      await new Promise(resolve => setTimeout(resolve, 300));
      const menu = [...document.querySelectorAll('.context-view .monaco-menu .action-label')].map(label => label.textContent ?? '').filter(label => label !== '');
      for (const type of ['keydown', 'keyup']) {
        (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent(type, {key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true}));
      }
      entry.row.dispatchEvent(new MouseEvent('mouseout', {bubbles: true}));
      return {inline, menu};
    })()`,
  );
  if (found === null) {
    throw new Error(`window ${name}: no Ports row for ${JSON.stringify(port)}`);
  }
  return found;
}

/** Clicks the inline action `title` of row `port` of core's Ports view, as a user's click on its icon. */
export async function portRowAction(
  name: string,
  port: string,
  title: string,
): Promise<void> {
  const missing = await evaluate<string | null>(
    name,
    `(() => {
      const entry = ${PORTS_ROWS_EXPRESSION}.find(each => each.cells[1] === ${JSON.stringify(port)});
      if (entry === undefined) {
        return 'no Ports row for ' + ${JSON.stringify(port)};
      }
      const action = [...entry.row.querySelectorAll('.actions-container .action-label')].find(
        label => (label.getAttribute('aria-label') ?? '').replace(/ \\([^)]*\\)$/, '') === ${JSON.stringify(title)},
      );
      if (action === undefined) {
        return 'no action ' + ${JSON.stringify(title)};
      }
      action.click();
      return null;
    })()`,
  );
  if (missing !== null) {
    throw new Error(`window ${name}: ${missing}`);
  }
}

/** Opens the Command Palette of window `name` with F1, types `text`, and gives the labels of its rows once they stop changing. */
async function openedPalette(name: string, text: string): Promise<string[]> {
  await pressStroke(await pageOf(name), name, {
    key: 'F1',
    code: 'F1',
    windowsVirtualKeyCode: 112,
    nativeVirtualKeyCode: 112,
  });
  // The palette starts with `>`, which is what makes it list commands.
  await keyInFolderDialog(name, undefined, `>${text}`);
  let labels: string[] = [];
  let steady = 0;
  for (let attempt = 0; attempt < 40 && steady < 3; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 250));
    const now = (await quickPickRows(name)).map(each => each.label);
    steady = JSON.stringify(now) === JSON.stringify(labels) ? steady + 1 : 0;
    labels = now;
  }
  return labels;
}

/** The labels of the rows the Command Palette of window `name` lists for `text`; the palette is closed again with Escape. */
export async function paletteRows(
  name: string,
  text: string,
): Promise<string[]> {
  const labels = await openedPalette(name, text);
  await pressEscape(name);
  return labels;
}

/** Runs the first command the Command Palette of window `name` lists for `text`, as Enter on it does. */
export async function paletteRun(name: string, text: string): Promise<void> {
  await openedPalette(name, text);
  await pressKey(await pageOf(name), name, 'Enter');
}

/** Types `text` into the input box a command of window `name` shows, and accepts it. */
export function answerInputBox(name: string, text: string): Promise<void> {
  return keyInFolderDialog(name, 'Enter', text);
}

/** One problem of the Problems panel, with the file it is listed under. */
export interface Problem {
  /** The file's folder and name, `.devcontainer/devcontainer.json`, or the name alone for a file at the root. */
  file: string;
  message: string;
  code: string;
  /** The link the code carries, or an empty string. */
  target: string;
  /** `error`, `warning` or `info`. */
  severity: string;
  line: number;
}

/** The windows whose Problems panel `problemsOf` maximized, so that it shows many rows at once. */
const maximizedPanels = new Set<string>();

/** Focuses the Problems panel of window `name`, maximized, and reads its problems in the order shown. */
export async function problemsOf(name: string): Promise<Problem[]> {
  await paletteRun(name, 'Problems: Focus on Problems View');
  if (!maximizedPanels.has(name)) {
    maximizedPanels.add(name);
    await paletteRun(name, 'View: Toggle Maximized Panel');
  }
  return evaluate<Problem[]>(
    name,
    `(() => {
      const problems = [];
      let file = '';
      for (const row of document.querySelectorAll('.markers-panel [role="treeitem"]')) {
        if (row.getAttribute('aria-level') === '1') {
          const folder = row.querySelector('.label-description')?.textContent ?? '';
          const label = row.querySelector('.label-name')?.textContent ?? '';
          file = folder === '' ? label : folder + '/' + label;
          continue;
        }
        const line = row.querySelector('.marker-line')?.textContent ?? '';
        problems.push({
          file,
          message: row.querySelector('.marker-message')?.textContent ?? '',
          code: row.querySelector('.marker-code')?.textContent ?? '',
          target: row.querySelector('a.monaco-link')?.getAttribute('href') ?? '',
          severity: row.querySelector('.marker-icon')?.classList.contains('error')
            ? 'error'
            : row.querySelector('.marker-icon')?.classList.contains('warning')
              ? 'warning'
              : 'info',
          line: Number(/Ln (\\d+)/.exec(line)?.[1] ?? 0),
        });
      }
      return problems;
    })()`,
  );
}

/** What a row of a view shows beyond its text: its icon and the accessible label that carries its tooltip. */
export interface RowDetails {
  label: string;
  description: string;
  /** The tooltip core gives a screen reader: the row's label, description and state. */
  ariaLabel: string;
  /** The codicon of the row (`vm-running`), or the file name of its own icon (`vm-active.svg`). */
  icon: string;
}

/** The rows of view `viewName` in window `name` with their icons and accessible labels; `undefined` when no pane has the view. */
export async function rowDetails(
  name: string,
  viewName: string,
): Promise<RowDetails[] | undefined> {
  return (
    (await evaluate<RowDetails[] | null>(
      name,
      `(() => {
      const pane = ${paneExpression(viewName)};
      if (pane === undefined) {
        return null;
      }
      return [...pane.querySelectorAll('[role="treeitem"]')].map(row => {
        const icon = row.querySelector('.custom-view-tree-node-item-icon');
        const image = icon?.style.backgroundImage.match(/([^/]+\\.svg)/)?.[1];
        const codicon = [...(icon?.classList ?? [])].find(each => each.startsWith('codicon-') && each !== 'codicon-colored');
        return {
          label: row.querySelector('.label-name')?.textContent ?? '',
          description: row.querySelector('.label-description')?.textContent ?? '',
          ariaLabel: row.getAttribute('aria-label') ?? '',
          icon: image ?? codicon?.slice('codicon-'.length) ?? '',
        };
      });
    })()`,
    )) ?? undefined
  );
}

/**
 * Whether the label of the row `label` of view `viewName` in window `name` is cut: its text is wider than the space the
 * row gives it, so core shows it with an ellipsis. Throws when the view has no such row.
 */
export async function labelCut(
  name: string,
  viewName: string,
  label: string,
): Promise<boolean> {
  const overflowing = await evaluate<boolean | null>(
    name,
    `(() => {
      const pane = ${paneExpression(viewName)};
      const row = [...(pane?.querySelectorAll('[role="treeitem"]') ?? [])].find(
        each => each.querySelector('.label-name')?.textContent === ${JSON.stringify(label)},
      );
      const container = row?.querySelector('.monaco-icon-label-container');
      return container === undefined || container === null
        ? null
        : container.scrollWidth > container.clientWidth;
    })()`,
  );
  if (overflowing === null) {
    throw new Error(`window ${name} shows no row ${label} in ${viewName}`);
  }
  return overflowing;
}

/**
 * The welcome text view `viewName` shows in window `name`, with its links as their words and a line break between its
 * blocks, as the user reads it; `undefined` when it shows none or an empty one.
 */
export async function welcomeText(
  name: string,
  viewName: string,
): Promise<string | undefined> {
  return (
    (await evaluate<string | null>(
      name,
      `(() => {
      const pane = ${paneExpression(viewName)};
      return pane?.querySelector('.welcome-view-content')?.innerText || null;
    })()`,
    )) ?? undefined
  );
}

/** The words of the links in the welcome text of view `viewName` in window `name`, in order; none when it shows none. */
export async function welcomeLinks(
  name: string,
  viewName: string,
): Promise<string[]> {
  return evaluate<string[]>(
    name,
    `(() => {
      const pane = ${paneExpression(viewName)};
      return [...(pane?.querySelectorAll('.welcome-view-content a') ?? [])].map(link => link.textContent ?? '');
    })()`,
  );
}

/** What the Extensions view shows of one extension's card. */
export interface ExtensionCard {
  name: string;
  publisher: string;
  description: string;
  /** The address of the card's icon image, empty when it shows core's default icon. */
  iconSource: string;
  /** The activation time core shows on the card (`12ms`); none when it shows none. */
  badge: string | undefined;
}

/** The card of the Extensions entry `displayName` in window `name`; it fails when the view lists it not once. */
export async function extensionCard(
  name: string,
  displayName: string,
): Promise<ExtensionCard> {
  const card = await evaluate<ExtensionCard | null>(
    name,
    `(() => {
      const rows = [...document.querySelectorAll('.extensions-viewlet .extension-list-item')].filter(row => row.querySelector('.name')?.textContent === ${JSON.stringify(displayName)});
      if (rows.length !== 1) {
        return null;
      }
      const row = rows[0];
      const icon = row.querySelector('img.icon');
      return {
        name: row.querySelector('.name')?.textContent ?? '',
        publisher: row.querySelector('.publisher-name')?.textContent ?? '',
        description: row.querySelector('.description')?.textContent ?? '',
        iconSource: icon !== null && icon.style.display !== 'none' ? icon.getAttribute('src') ?? '' : '',
        badge: row.querySelector('.activationTime')?.textContent ?? undefined,
      };
    })()`,
  );
  if (card === null) {
    throw new Error(
      `window ${name}: not one Extensions entry named ${JSON.stringify(displayName)}`,
    );
  }
  return card;
}

/** Clicks the link of the welcome text of view `viewName` whose words are `linkText`; it fails naming what it did not find. */
export async function welcomeLink(
  name: string,
  viewName: string,
  linkText: string,
): Promise<void> {
  const missing = await evaluate<string | null>(
    name,
    `(() => {
      const pane = ${paneExpression(viewName)};
      if (pane === undefined) {
        return 'no view ' + ${JSON.stringify(viewName)};
      }
      const links = [...pane.querySelectorAll('.welcome-view-content a')];
      const link = links.find(each => each.textContent === ${JSON.stringify(linkText)});
      if (link === undefined) {
        return 'no link ' + ${JSON.stringify(JSON.stringify(linkText))} + ' among ' + JSON.stringify(links.map(each => each.textContent));
      }
      link.click();
      return null;
    })()`,
  );
  if (missing !== null) {
    throw new Error(`window ${name}, view ${viewName}: ${missing}`);
  }
}

/** The options of the Remote Explorer's "Switch Remote" dropdown of window `name`, in order. */
export async function remoteExplorerOptions(name: string): Promise<string[]> {
  return evaluate<string[]>(
    name,
    `[...document.querySelectorAll('select[aria-label="Switch Remote"] option')].map(each => each.textContent ?? '')`,
  );
}

/** The option the Switch Remote dropdown shows as selected, or nothing when the window has no such dropdown. */
export async function selectedRemote(
  name: string,
): Promise<string | undefined> {
  return (
    (await evaluate<string | null>(
      name,
      `document.querySelector('select[aria-label="Switch Remote"]')?.value ?? null`,
    )) ?? undefined
  );
}

/** The titles of the sections of the Remote Explorer that are on screen, from the top. */
export async function remoteExplorerSections(name: string): Promise<string[]> {
  return evaluate<string[]>(
    name,
    `[...document.querySelectorAll('.pane')]
      .filter(pane => pane.offsetParent !== null && pane.getBoundingClientRect().height > 0)
      .map(pane => pane.querySelector('.pane-header .title')?.textContent ?? '')
      .filter(title => title !== '')`,
  );
}

/** Chooses `option` in the "Switch Remote" dropdown of window `name`, as a user's choice. */
export async function selectRemote(
  name: string,
  option: string,
): Promise<void> {
  const missing = await evaluate<string | null>(
    name,
    `(() => {
      const select = document.querySelector('select[aria-label="Switch Remote"]');
      if (select === null) {
        return 'no Switch Remote dropdown';
      }
      select.value = ${JSON.stringify(option)};
      if (select.value !== ${JSON.stringify(option)}) {
        return 'no option ' + ${JSON.stringify(JSON.stringify(option))};
      }
      select.dispatchEvent(new Event('change', {bubbles: true}));
      return null;
    })()`,
  );
  if (missing !== null) {
    throw new Error(`window ${name}: ${missing}`);
  }
}

/** The box of core's open dialog, and its buttons inside it ([oss] `src/vs/base/browser/ui/dialog/dialog.ts`). */
const DIALOG_BOX = '.monaco-dialog-box';

const DIALOG_BUTTONS = '.dialog-buttons .monaco-button';

/** The page-side reading of the open dialog: `null` when none is open. */
const DIALOG_EXPRESSION = `(() => {
  const box = document.querySelector('${DIALOG_BOX}');
  if (box === null) {
    return null;
  }
  return {
    message: box.querySelector('.dialog-message-text')?.textContent ?? '',
    details: box.querySelector('.dialog-message-detail')?.textContent ?? '',
    buttons: [...box.querySelectorAll('${DIALOG_BUTTONS}')].map(button => button.textContent ?? ''),
  };
})()`;

/**
 * The text of each notification toast of window `name`, in the order shown: the toasts on screen only, with the
 * notification centre closed (card coverage-25a §2.3).
 */
export async function notifications(name: string): Promise<string[]> {
  return evaluate<string[]>(
    name,
    `[...document.querySelectorAll('.notifications-toasts .notification-list-item-message')].map(each => each.textContent ?? '')`,
  );
}

/** The state of a toast's progress bar, read in the page: core draws `infinite` on an indeterminate bar's `.monaco-progress-container` ([oss] `src/vs/base/browser/ui/progressbar/progressbar.ts`). */
const TOAST_PROGRESS = `(() => {
    const bar = item.parentElement?.querySelector('.monaco-progress-container') ?? null;
    const shown = bar !== null && bar.classList.contains('active') && !bar.classList.contains('done');
    return !shown ? 'none' : bar.classList.contains('infinite') ? 'infinite' : 'discrete';
  })()`;

/** The state of a toast's progress bar: `infinite` or `discrete`, or `none` when it shows no progress. */
type ToastProgress = 'infinite' | 'discrete' | 'none';

/** The connecting toast of a window: its message and its bar. */
export interface ConnectingToast {
  message: string;
  progress: ToastProgress;
}

/** The toast of window `name` whose message starts with `messageStart`, with the state of its progress bar, or nothing when there is none. */
export async function notificationProgress(
  name: string,
  messageStart: string,
): Promise<ConnectingToast | undefined> {
  return evaluate<ConnectingToast | null>(
    name,
    `(() => {
  const item = [...document.querySelectorAll('.notifications-toasts .notification-list-item')].find(each => (each.querySelector('.notification-list-item-message')?.textContent ?? '').startsWith(${JSON.stringify(messageStart)}));
  if (item === undefined) {
    return null;
  }
  return {
    message: item.querySelector('.notification-list-item-message')?.textContent ?? '',
    progress: ${TOAST_PROGRESS},
  };
})()`,
  ).then(found => found ?? undefined);
}

/** Puts the keyboard focus on the toast list of window `name`, as "Notifications: Focus Notification Toast" does; false when no toast is shown. */
export async function focusToasts(name: string): Promise<boolean> {
  return evaluate<boolean>(
    name,
    `(() => {
  const list = document.querySelector('.notifications-toasts .monaco-list');
  list?.focus();
  return list !== null;
})()`,
  );
}

/** Presses Delete in window `name` wherever its page has the focus, as the keyboard does. */
export async function pressDelete(name: string): Promise<void> {
  await pressKey(await pageOf(name), name, 'Delete');
}

/** The text of the status bar item `itemId` of window `name`, read at once with no hover; empty when there is none. */
export async function statusBarText(
  name: string,
  itemId: string,
): Promise<string> {
  return evaluate<string>(
    name,
    `(document.getElementById(${JSON.stringify(itemId)})?.textContent ?? '').trim()`,
  );
}

/** One notification toast as the window shows it: its text, links, buttons, toolbar actions and progress bar. */
export interface ToastDetails extends ConnectingToast {
  /** The words and the address of each link in the message. */
  links: NotificationLink[];
  /** The labels of the buttons. */
  buttons: string[];
  /** The accessible names of the toolbar's actions. */
  toolbar: string[];
}

/** The toasts on screen of window `name` in the order shown, each with what a user sees and can click on it. */
export async function toastDetails(name: string): Promise<ToastDetails[]> {
  return evaluate<ToastDetails[]>(
    name,
    `[...document.querySelectorAll('.notifications-toasts .notification-list-item')].map(item => ({
  message: item.querySelector('.notification-list-item-message')?.textContent ?? '',
  links: [...item.querySelectorAll('.notification-list-item-message a')].map(each => ({text: each.textContent ?? '', href: each.getAttribute('href') ?? each.getAttribute('data-href') ?? ''})),
  buttons: [...item.querySelectorAll('.notification-list-item-buttons-container .monaco-button')].map(each => each.textContent ?? ''),
  toolbar: [...item.querySelectorAll('.notification-list-item-toolbar-container .action-label')].map(each => each.getAttribute('aria-label') ?? each.getAttribute('title') ?? ''),
  progress: ${TOAST_PROGRESS},
}))`,
  );
}

/** The notification centre once open, and the status bar's bell that opens it ([oss] `src/vs/workbench/browser/parts/notifications/`). */
const OPEN_CENTRE = '.notifications-center.visible';

const CENTRE_BELL = '[id="status.notifications"] a';

/**
 * The text of each notification of window `name`, newest first, read in the notification centre, which this opens
 * when it is closed. Unlike the toasts, the centre holds a notification core did not raise as a toast.
 */
export async function notificationCentre(name: string): Promise<string[]> {
  return settled(
    () => `the notification centre of window ${name}`,
    async () =>
      (await evaluate<string[] | null>(
        name,
        `(() => {
  const centre = document.querySelector('${OPEN_CENTRE}');
  if (centre === null) {
    document.querySelector('${CENTRE_BELL}')?.click();
    return null;
  }
  return [...centre.querySelectorAll('.notification-list-item-message')].map(each => each.textContent ?? '');
})()`,
      )) ?? undefined,
  );
}

/** A link inside a notification's message: its words and the address it opens. */
export interface NotificationLink {
  text: string;
  href: string;
}

/** The links in the message of the notification of window `name` that starts with `messageStart`, read in the notification centre, which this opens. */
export async function notificationLinks(
  name: string,
  messageStart: string,
): Promise<NotificationLink[]> {
  return settled(
    () => `the notification "${messageStart}" in window ${name}`,
    async () =>
      (await evaluate<NotificationLink[] | null>(
        name,
        `(() => {
  const centre = document.querySelector('${OPEN_CENTRE}');
  if (centre === null) {
    document.querySelector('${CENTRE_BELL}')?.click();
    return null;
  }
  const item = [...centre.querySelectorAll('.notification-list-item')].find(each => (each.querySelector('.notification-list-item-message')?.textContent ?? '').startsWith(${JSON.stringify(messageStart)}));
  return item === undefined ? null : [...item.querySelectorAll('.notification-list-item-message a')].map(each => ({text: each.textContent ?? '', href: each.getAttribute('href') ?? each.getAttribute('data-href') ?? ''}));
})()`,
      )) ?? undefined,
  );
}

/**
 * Clicks the button labelled `label` of the notification of window `name` whose message starts with `messageStart`,
 * found in the notification centre, which this opens. It fails naming the notifications or the buttons it found.
 */
export async function answerNotification(
  name: string,
  messageStart: string,
  label: string,
): Promise<void> {
  let found = '';
  await settled(
    () =>
      `the notification "${messageStart}" with "${label}" in window ${name} (${found})`,
    async () => {
      found = await evaluate<string>(
        name,
        `(() => {
  const centre = document.querySelector('${OPEN_CENTRE}');
  if (centre === null) {
    document.querySelector('${CENTRE_BELL}')?.click();
    return 'the centre is closed';
  }
  const items = [...centre.querySelectorAll('.notification-list-item')];
  const item = items.find(each => (each.querySelector('.notification-list-item-message')?.textContent ?? '').startsWith(${JSON.stringify(messageStart)}));
  if (item === undefined) {
    return 'notifications: ' + JSON.stringify(items.map(each => each.querySelector('.notification-list-item-message')?.textContent));
  }
  const buttons = [...item.querySelectorAll('.monaco-button')];
  const button = buttons.find(each => each.textContent === ${JSON.stringify(label)});
  if (button === undefined) {
    return 'buttons: ' + JSON.stringify(buttons.map(each => each.textContent));
  }
  button.click();
  return 'clicked';
})()`,
      );
      return found === 'clicked' ? true : undefined;
    },
  );
}

/** The labels of the buttons of window `name`'s notification whose message starts with `messageStart`, from the centre. */
export async function notificationButtons(
  name: string,
  messageStart: string,
): Promise<string[]> {
  return settled(
    () => `the notification "${messageStart}" in window ${name}`,
    async () =>
      (await evaluate<string[] | null>(
        name,
        `(() => {
  const centre = document.querySelector('${OPEN_CENTRE}');
  if (centre === null) {
    document.querySelector('${CENTRE_BELL}')?.click();
    return null;
  }
  const item = [...centre.querySelectorAll('.notification-list-item')].find(each => (each.querySelector('.notification-list-item-message')?.textContent ?? '').startsWith(${JSON.stringify(messageStart)}));
  return item === undefined ? null : [...item.querySelectorAll('.monaco-button')].map(each => each.textContent ?? '');
})()`,
      )) ?? undefined,
  );
}

/** Window `name`'s title, as its page has it. */
export async function windowTitle(name: string): Promise<string> {
  return evaluate<string>(name, 'document.title');
}

/** What a status bar item shows: its visible label, its accessible label, and the text of its hover. */
export interface StatusItem {
  text: string;
  ariaLabel: string;
  hover: string;
}

/** How long a row waits for the remote indicator to read the container once the window is connected. */
export const INDICATOR_MILLISECONDS = 30_000;

/**
 * The text of the status bar item `itemId` of window `name` once it reads `expected`, or its last text after
 * `milliseconds`: core updates the remote indicator a moment after the window connects, and on a loaded machine that
 * moment is longer than a row's read.
 */
export async function statusItemText(
  name: string,
  itemId: string,
  expected: string,
  milliseconds: number,
): Promise<string> {
  const deadline = Date.now() + milliseconds;
  let text = (await statusItem(name, itemId)).text;
  while (text !== expected && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 300));
    text = (await statusItem(name, itemId)).text;
  }
  return text;
}

/**
 * The status bar item of window `name` whose DOM id is `itemId` (core's remote indicator is `status.host`). The hover
 * is read by moving the pointer onto the item and back off, with its non-breaking spaces read as spaces. It fails
 * naming the window and the item when there's none.
 */
export async function statusItem(
  name: string,
  itemId: string,
): Promise<StatusItem> {
  const found = await evaluate<StatusItem | null>(
    name,
    `(async () => {
  const item = document.getElementById(${JSON.stringify(itemId)});
  if (item === null) {
    return null;
  }
  const link = item.querySelector('a') ?? item;
  const text = (link.textContent ?? '').trim();
  const ariaLabel = link.getAttribute('aria-label') ?? item.getAttribute('aria-label') ?? '';
  link.dispatchEvent(new MouseEvent('mouseenter', {bubbles: true}));
  link.dispatchEvent(new MouseEvent('mouseover', {bubbles: true}));
  let hover = '';
  for (let tries = 0; tries < 20 && hover === ''; tries += 1) {
    await new Promise(resolve => setTimeout(resolve, 100));
    hover = (document.querySelector('.workbench-hover, .monaco-hover')?.textContent ?? '').replaceAll('\u00a0', ' ').trim();
  }
  link.dispatchEvent(new MouseEvent('mouseleave', {bubbles: true}));
  link.dispatchEvent(new MouseEvent('mouseout', {bubbles: true}));
  return {text, ariaLabel, hover};
})()`,
  );
  if (found === null) {
    throw new Error(`window ${name} has no status bar item ${itemId}`);
  }
  return found;
}

/** The dialog open in window `name`, or `undefined` when none is. */
export async function dialogOf(name: string): Promise<ShownDialog | undefined> {
  return (
    (await evaluate<ShownDialog | null>(name, DIALOG_EXPRESSION)) ?? undefined
  );
}

/** The kind of the open dialog, as its icon says ([oss] `src/vs/base/browser/ui/dialog/dialog.ts`): the icon element carries `codicon-dialog-<kind>`. */
export type DialogKind = 'info' | 'warning' | 'error';

/** The kind of the dialog open in window `name`, or `undefined` when none is open or its icon names no kind. */
export async function dialogKindOf(
  name: string,
): Promise<DialogKind | undefined> {
  return (
    (await evaluate<DialogKind | null>(
      name,
      `(() => {
  const icon = document.querySelector('${DIALOG_BOX} .dialog-icon');
  const kind = /codicon-dialog-(info|warning|error)/.exec(icon?.className ?? '');
  return kind === null ? null : kind[1];
})()`,
    )) ?? undefined
  );
}

/** The whole text of the dialog open in window `name`, the markdown details included, or `undefined` when none is. */
export async function dialogText(name: string): Promise<string | undefined> {
  return (
    (await evaluate<string | null>(
      name,
      `document.querySelector('${DIALOG_BOX}')?.textContent ?? null`,
    )) ?? undefined
  );
}

/** Waits until window `name` shows a dialog and returns it; it fails naming the window and every page's open dialog. */
export async function waitForDialog(
  name: string,
  milliseconds = WAIT_MILLISECONDS,
): Promise<ShownDialog> {
  try {
    return await settled(
      () => `a dialog in window ${name}`,
      () => dialogOf(name),
      milliseconds,
    );
  } catch (caught) {
    const shown = await Promise.all(
      (await pages()).map(async page => {
        const open =
          page.webSocketDebuggerUrl === undefined
            ? null
            : await evaluateAt<ShownDialog | null>(
                page.webSocketDebuggerUrl,
                `page ${page.title}`,
                DIALOG_EXPRESSION,
              );
        return `${page.title}: ${open?.message ?? 'none'}`;
      }),
    );
    throw new Error(
      `${caught instanceof Error ? caught.message : String(caught)}; open dialogs: ${shown.join('; ')}`,
      {cause: caught},
    );
  }
}

/** Clicks the button labelled exactly `label` of the dialog open in window `name`; it fails naming what it found. */
export async function answerDialog(name: string, label: string): Promise<void> {
  const missing = await evaluate<string | null>(
    name,
    `(() => {
      const box = document.querySelector('${DIALOG_BOX}');
      if (box === null) {
        return 'no dialog open';
      }
      const buttons = [...box.querySelectorAll('${DIALOG_BUTTONS}')];
      const button = buttons.find(each => each.textContent === ${JSON.stringify(label)});
      if (button === undefined) {
        return 'no button ' + ${JSON.stringify(JSON.stringify(label))} + ' among ' + JSON.stringify(buttons.map(each => each.textContent));
      }
      button.click();
      return null;
    })()`,
  );
  if (missing !== null) {
    throw new Error(`window ${name}: ${missing}`);
  }
}

/** Presses Escape in window `name`: a key event on the element that has focus, as the keyboard sends it. */
export async function pressEscape(name: string): Promise<void> {
  await evaluate<null>(
    name,
    `(() => {
      const target = document.activeElement ?? document.body;
      for (const type of ['keydown', 'keyup']) {
        target.dispatchEvent(new KeyboardEvent(type, {key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true}));
      }
      return null;
    })()`,
  );
}

/**
 * The lines of the detail of the dialog open in window `name`, as the dialog draws them: core renders a line break of
 * the detail as an element, which the detail's `textContent` leaves out. Empty when no dialog is open.
 */
export async function dialogDetailLines(name: string): Promise<string[]> {
  return evaluate<string[]>(
    name,
    `(() => {
  const detail = document.querySelector('${DIALOG_BOX} .dialog-message-detail');
  return detail === null ? [] : detail.innerText.split('\\n');
})()`,
  );
}

/**
 * The label of the dialog's primary button in window `name`, the one the custom dialog draws without the secondary
 * style and activates on Enter; `undefined` when no dialog is open or no one button is primary.
 */
export async function primaryButtonOf(
  name: string,
): Promise<string | undefined> {
  return (
    (await evaluate<string | null>(
      name,
      `(() => {
  const box = document.querySelector('${DIALOG_BOX}');
  const primary = [...(box?.querySelectorAll('${DIALOG_BUTTONS}') ?? [])].filter(button => !button.classList.contains('secondary'));
  return primary.length === 1 ? (primary[0].textContent ?? '') : null;
})()`,
    )) ?? undefined
  );
}

/** The quick pick the window shows ([oss] `src/vs/platform/quickinput/browser/`): its widget, its input and its rows. */
const QUICK_WIDGET = '.quick-input-widget';

/** What a quick pick shows: the input's placeholder, and the label of each row in order. */
export interface ShownQuickPick {
  placeholder: string;
  items: string[];
}

const QUICK_PICK_EXPRESSION = `(() => {
  const widget = document.querySelector('${QUICK_WIDGET}');
  if (widget === null || widget.style.display === 'none') {
    return null;
  }
  return {
    placeholder: widget.querySelector('.quick-input-box input')?.getAttribute('placeholder') ?? '',
    items: [...widget.querySelectorAll('.quick-input-list .monaco-list-row')].map(row => row.querySelector('.label-name')?.textContent ?? ''),
  };
})()`;

/** The quick pick open in window `name`, or `undefined` when none is. */
export async function quickPickOf(
  name: string,
): Promise<ShownQuickPick | undefined> {
  return (
    (await evaluate<ShownQuickPick | null>(name, QUICK_PICK_EXPRESSION)) ??
    undefined
  );
}

/** One row of a quick pick: its label, its description, the buttons beside it, and whether the list has it focused. */
export interface QuickPickRow {
  label: string;
  description: string;
  buttons: string[];
  focused: boolean;
}

/** A row of a quick pick as {@link detailedQuickPickRows} reads it: also its second line and its codicons. */
export interface DetailedQuickPickRow extends QuickPickRow {
  /** The second line of the row, the hover text the pick shows beside the label. */
  detail: string;
  /** The codicon classes the row carries, such as `codicon-verified`. */
  icons: string[];
}

/** The rows of the quick pick open in window `name`, with what each shows; none when no quick pick is open. */
export async function quickPickRows(name: string): Promise<QuickPickRow[]> {
  return evaluate<QuickPickRow[]>(
    name,
    `[...document.querySelectorAll('${QUICK_WIDGET} .quick-input-list .monaco-list-row')].map(row => ({
      label: row.querySelector('.label-name')?.textContent ?? '',
      description: row.querySelector('.label-description')?.textContent ?? '',
      buttons: [...row.querySelectorAll('.quick-input-list-entry .action-label')].map(each => each.getAttribute('aria-label') ?? each.getAttribute('title') ?? ''),
      focused: row.classList.contains('focused'),
    }))`,
  );
}

/** The rows of the quick pick open in window `name` with their second lines and codicons as well; none when no quick pick is open. */
export async function detailedQuickPickRows(
  name: string,
): Promise<DetailedQuickPickRow[]> {
  return evaluate<DetailedQuickPickRow[]>(
    name,
    `[...document.querySelectorAll('${QUICK_WIDGET} .quick-input-list .monaco-list-row')].map(row => ({
      label: row.querySelector('.label-name')?.textContent ?? '',
      description: row.querySelector('.label-description')?.textContent ?? '',
      detail: row.querySelector('.quick-input-list-label-meta')?.textContent ?? '',
      icons: [...row.querySelectorAll('.codicon')].flatMap(each => [...each.classList].filter(name => name.startsWith('codicon-'))),
      buttons: [...row.querySelectorAll('.quick-input-list-entry .action-label')].map(each => each.getAttribute('aria-label') ?? each.getAttribute('title') ?? ''),
      focused: row.classList.contains('focused'),
    }))`,
  );
}

/** Presses the button `button` beside the row labelled `label` of the quick pick open in window `name`. */
export async function pressQuickPickRowButton(
  name: string,
  label: string,
  button: string,
): Promise<void> {
  const pressed = await evaluate<boolean>(
    name,
    `(() => {
      const rows = [...document.querySelectorAll('${QUICK_WIDGET} .quick-input-list .monaco-list-row')];
      const row = rows.find(each => each.querySelector('.label-name')?.textContent === ${JSON.stringify(label)});
      const target = [...(row?.querySelectorAll('.quick-input-list-entry .action-label') ?? [])].find(each => (each.getAttribute('aria-label') ?? each.getAttribute('title')) === ${JSON.stringify(button)});
      if (target === undefined) {
        return false;
      }
      target.dispatchEvent(new MouseEvent('click', {bubbles: true}));
      return true;
    })()`,
  );
  if (!pressed) {
    throw new Error(
      `window ${name}: no button ${JSON.stringify(button)} on the row ${JSON.stringify(label)}`,
    );
  }
}

/** Waits until window `name` shows a quick pick and returns it. */
export async function waitForQuickPick(
  name: string,
  milliseconds = WAIT_MILLISECONDS,
): Promise<ShownQuickPick> {
  return settled(
    () => `a quick pick in window ${name}`,
    async () => {
      const shown = await quickPickOf(name);
      return shown === undefined || shown.items.length === 0
        ? undefined
        : shown;
    },
    milliseconds,
  );
}

/**
 * Chooses the item labelled `label` of the quick pick open in window `name`: it types the label into the pick's input,
 * which leaves that item alone and active, and presses Enter. It fails naming the items when the pick lacks the label.
 */
export async function chooseQuickPickItem(
  name: string,
  label: string,
): Promise<void> {
  const shown = await waitForQuickPick(name, 30_000);
  if (!shown.items.includes(label)) {
    throw new Error(
      `window ${name}: no item ${JSON.stringify(label)} among ${JSON.stringify(shown.items)}`,
    );
  }
  await typeInQuickPick(name, label);
  await pressKey(await pageOf(name), name, 'Enter');
}

/**
 * Chooses the row labelled `label` of the quick pick open in window `name` by the keys a user presses: the arrow keys
 * from the focused row to it, then Enter. Unlike {@link chooseQuickPickItem} it types no filter, so every row stays.
 */
export async function chooseQuickPickRow(
  name: string,
  label: string,
): Promise<void> {
  await waitForQuickPick(name, 30_000);
  const address = await pageOf(name);
  for (let presses = 0; presses < 100; presses += 1) {
    const rows = await quickPickRows(name);
    const target = rows.findIndex(entry => entry.label === label);
    if (target === -1) {
      throw new Error(
        `window ${name}: no row ${JSON.stringify(label)} among ${JSON.stringify(rows.map(entry => entry.label))}`,
      );
    }
    const focused = rows.findIndex(entry => entry.focused);
    if (focused === target) {
      await pressKey(address, name, 'Enter');
      return;
    }
    await pressKey(address, name, focused < target ? 'ArrowDown' : 'ArrowUp');
  }
  throw new Error(
    `window ${name}: the row ${JSON.stringify(label)} never got the focus`,
  );
}

/** What the frame of a quick pick shows: its title, its placeholder, the title-bar buttons and whether it picks several. */
export interface QuickPickFacts {
  title: string;
  placeholder: string;
  titleButtons: string[];
  multiSelect: boolean;
}

/** The frame of the quick pick open in window `name`; `undefined` when none is. */
export async function quickPickFacts(
  name: string,
): Promise<QuickPickFacts | undefined> {
  return (
    (await evaluate<QuickPickFacts | null>(
      name,
      `(() => {
        const widget = document.querySelector('${QUICK_WIDGET}');
        if (widget === null || widget.style.display === 'none') {
          return null;
        }
        return {
          title: widget.querySelector('.quick-input-title')?.textContent ?? '',
          placeholder: widget.querySelector('.quick-input-box input')?.getAttribute('placeholder') ?? '',
          titleButtons: [...widget.querySelectorAll('.quick-input-titlebar .action-label')].map(each => each.getAttribute('aria-label') ?? each.getAttribute('title') ?? ''),
          multiSelect: widget.querySelector('.quick-input-check-all') !== null,
        };
      })()`,
    )) ?? undefined
  );
}

/** What the input of the quick pick open in window `name` holds. */
export async function quickPickValue(name: string): Promise<string> {
  return evaluate<string>(
    name,
    `document.querySelector('${QUICK_WIDGET} .quick-input-box input')?.value ?? ''`,
  );
}

/** Presses the arrow key `key` in window `name`, which moves the focus of the quick pick that is open. */
export async function moveQuickPickFocus(
  name: string,
  key: 'ArrowUp' | 'ArrowDown',
): Promise<void> {
  await pressKey(await pageOf(name), name, key);
}

/** Types `text` into the input of the quick pick open in window `name`, replacing what is there, and leaves it open. */
export async function typeInQuickPick(
  name: string,
  text: string,
): Promise<void> {
  await waitForQuickPick(name, 30_000);
  await evaluate<null>(
    name,
    `(() => {
      const input = document.querySelector('${QUICK_WIDGET} .quick-input-box input');
      input.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(text)});
      input.dispatchEvent(new Event('input', {bubbles: true}));
      return null;
    })()`,
  );
}

/** Presses Enter in window `name`, which accepts the active item of the quick pick that is open. */
export async function acceptQuickPick(name: string): Promise<void> {
  await pressKey(await pageOf(name), name, 'Enter');
}

/** One editor tab: its label, whether it is the active one, and whether it is a preview (shown in italics until kept). */
export interface EditorTab {
  label: string;
  active: boolean;
  preview: boolean;
}

/** The editor tabs of window `name`, in the order shown; read from the page, so it works while a modal dialog is open. */
export async function editorTabs(name: string): Promise<EditorTab[]> {
  return evaluate<EditorTab[]>(
    name,
    `[...document.querySelectorAll('.editor-group-container .tabs-container .tab')].map(tab => ({
      label: tab.querySelector('.label-name')?.textContent ?? '',
      active: tab.classList.contains('active'),
      preview: tab.querySelector('.monaco-icon-label')?.classList.contains('italic') ?? false,
    }))`,
  );
}

/** Whether the status bar of window `name` has an item whose DOM id is `itemId`. */
export async function hasStatusItem(
  name: string,
  itemId: string,
): Promise<boolean> {
  return evaluate<boolean>(
    name,
    `document.getElementById(${JSON.stringify(itemId)}) !== null`,
  );
}

/** The text of the window `name`'s page, as a reader sees it: the editors, the views and the status bar. */
export async function pageText(name: string): Promise<string> {
  return evaluate<string>(name, 'document.body.innerText');
}

/**
 * Clicks the button of an editor of window `name` whose text is exactly `label`: a button of an editor's page, which
 * `answerDialog` does not reach since that one is a dialog's. It fails naming what it found.
 */
export async function clickButton(name: string, label: string): Promise<void> {
  const missing = await evaluate<string | null>(
    name,
    `(() => {
      const buttons = [...document.querySelectorAll('.editor-instance .monaco-button')];
      const button = buttons.find(each => each.textContent?.trim() === ${JSON.stringify(label)});
      if (button === undefined) {
        return 'no button ' + ${JSON.stringify(JSON.stringify(label))} + ' among ' + JSON.stringify(buttons.map(each => each.textContent));
      }
      button.click();
      return null;
    })()`,
  );
  if (missing !== null) {
    throw new Error(`window ${name}: ${missing}`);
  }
}

/** The input of the in-window folder dialog (`files.simpleDialog.enable`) in the page, or `null` when none is open. */
const FOLDER_DIALOG_INPUT =
  'document.querySelector(\'.quick-input-widget:not([style*="display: none"]) input.input\')';

/** Whether the in-window folder dialog is open in window `name`. */
export async function folderDialogOpen(name: string): Promise<boolean> {
  return evaluate<boolean>(name, `${FOLDER_DIALOG_INPUT} !== null`);
}

/**
 * Has window `name`'s in-window folder dialog take `key` (`Enter` or `Escape`), with `typed` in its input first when
 * given; with no key it only types. It waits for the dialog to open, and fails when none does.
 */
async function keyInFolderDialog(
  name: string,
  key: 'Enter' | 'Escape' | undefined,
  typed?: string,
): Promise<void> {
  await settled(
    () => `the folder dialog of window ${name}`,
    async () => ((await folderDialogOpen(name)) ? true : undefined),
  );
  await evaluate<null>(
    name,
    `(() => {
      const input = ${FOLDER_DIALOG_INPUT};
      input.focus();
      if (${JSON.stringify(typed ?? null)} !== null) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, ${JSON.stringify(typed ?? '')});
        input.dispatchEvent(new Event('input', {bubbles: true}));
      }
      return null;
    })()`,
  );
  if (key !== undefined) {
    await pressKey(await pageOf(name), name, key);
  }
}

/**
 * One key as the protocol's `Input.dispatchKeyEvent` takes it; `text` is what its key down inserts, when the key types
 * one, and `modifiers` the held modifier keys (2 is Control).
 */
interface KeyStroke {
  key: string;
  code: string;
  windowsVirtualKeyCode: number;
  nativeVirtualKeyCode: number;
  text?: string;
  modifiers?: number;
}

/** Presses the `stroke` in the page at protocol address `address`, as the keyboard does, with its key down and up. */
async function pressStroke(
  address: string,
  owner: string,
  stroke: KeyStroke,
): Promise<void> {
  const socket = new WebSocket(address);
  try {
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => {
        resolve();
      });
      socket.addEventListener('error', () => {
        reject(new Error(`no protocol connection to window ${owner}`));
      });
    });
    for (const [index, type] of ['keyDown', 'keyUp'].entries()) {
      const answered = new Promise<void>(resolve => {
        socket.addEventListener('message', function listener() {
          socket.removeEventListener('message', listener);
          resolve();
        });
      });
      socket.send(
        JSON.stringify({
          id: index + 1,
          method: 'Input.dispatchKeyEvent',
          params: {
            type,
            ...stroke,
            ...(type === 'keyDown' && stroke.text !== undefined
              ? {text: stroke.text}
              : {}),
          },
        }),
      );
      await answered;
    }
  } finally {
    socket.close();
  }
}

/** The protocol virtual key codes of the keys the helpers press. */
const VIRTUAL_KEY_CODES: Record<
  'Enter' | 'Escape' | 'Backspace' | 'Delete' | 'ArrowUp' | 'ArrowDown',
  number
> = {
  ArrowUp: 38,
  ArrowDown: 40,
  Enter: 13,
  Escape: 27,
  Backspace: 8,
  Delete: 46,
};

/** Presses `key` in the page at protocol address `address`, as the keyboard does, with its key down and up. */
async function pressKey(
  address: string,
  owner: string,
  key: keyof typeof VIRTUAL_KEY_CODES,
): Promise<void> {
  await pressStroke(address, owner, {
    key,
    code: key,
    windowsVirtualKeyCode: VIRTUAL_KEY_CODES[key],
    nativeVirtualKeyCode: VIRTUAL_KEY_CODES[key],
    ...(key === 'Enter' ? {text: '\r'} : {}),
  });
}

/** The key that types the printable `character`, as the protocol takes it. */
function characterStroke(character: string): KeyStroke {
  const upper = character.toUpperCase();
  const virtualKeyCode =
    (upper >= 'A' && upper <= 'Z') || (character >= '0' && character <= '9')
      ? upper.charCodeAt(0)
      : 0;
  return {
    key: character,
    code:
      upper >= 'A' && upper <= 'Z'
        ? `Key${upper}`
        : character >= '0' && character <= '9'
          ? `Digit${character}`
          : character,
    windowsVirtualKeyCode: virtualKeyCode,
    nativeVirtualKeyCode: virtualKeyCode,
    text: character,
  };
}

/** Presses the printable `character` in the page at protocol address `address`, as the keyboard does. */
async function pressCharacter(
  address: string,
  owner: string,
  character: string,
): Promise<void> {
  await pressStroke(address, owner, characterStroke(character));
}

/** The modifier bits of the protocol's key events. */
const ALT_AND_CONTROL = 3;

/** Presses Ctrl+Alt+`character` in window `name`, as the keyboard does, so that a keybinding on it runs its command. */
export async function pressControlAlt(
  name: string,
  character: string,
): Promise<void> {
  const upper = character.toUpperCase();
  await pressStroke(await pageOf(name), name, {
    key: character,
    code: `Key${upper}`,
    windowsVirtualKeyCode: upper.charCodeAt(0),
    nativeVirtualKeyCode: upper.charCodeAt(0),
    modifiers: ALT_AND_CONTROL,
  });
}

/** The label of the activity bar item that is checked in window `name`, the side bar in front; empty when none is. */
export async function activeSideBar(name: string): Promise<string> {
  return evaluate<string>(
    name,
    `document.querySelector('.activitybar .action-item.checked .action-label')?.getAttribute('aria-label') ?? ''`,
  );
}

/** Types `folder` into window `name`'s folder dialog and confirms it, as Enter does with no item focused. */
export function answerFolderDialog(
  name: string,
  folder: string,
): Promise<void> {
  return keyInFolderDialog(name, 'Enter', folder);
}

/** Closes window `name`'s folder dialog with Escape. */
export function cancelFolderDialog(name: string): Promise<void> {
  return keyInFolderDialog(name, 'Escape');
}

/** The page's terminal text rows: the one terminal of the launches these helpers serve, xterm's visible rows. */
const TERMINAL_ROWS = "document.querySelector('.xterm-rows')";

/** Whether window `name` has a terminal on its page. */
async function terminalPresent(name: string): Promise<boolean> {
  return evaluate<boolean>(name, `${TERMINAL_ROWS} !== null`);
}

/**
 * The visible text of window `name`'s active terminal, scrolled to its bottom so the cursor's row is in view. xterm
 * renders only the viewport into its rows, so a read at the top misses the prompt the input rows type into; the launch's
 * active terminal is the last of the page's, and its cursor's row is the last once its viewport is scrolled down.
 */
export async function terminalText(name: string): Promise<string> {
  await evaluate<string>(
    name,
    `(() => {
      const viewports = document.querySelectorAll('.xterm-viewport');
      const viewport = viewports[viewports.length - 1];
      if (viewport !== undefined) {
        viewport.scrollTop = viewport.scrollHeight;
      }
      return 'scrolled';
    })()`,
  );
  await new Promise(resolve => setTimeout(resolve, POLL_MILLISECONDS));
  return evaluate<string>(
    name,
    `(() => {
      const rows = document.querySelectorAll('.xterm-rows');
      const target = rows[rows.length - 1];
      return target?.innerText ?? '';
    })()`,
  );
}

/** A run of text in the active terminal, with the number of the palette colour it is drawn in; none for the default. */
export interface TerminalSpan {
  text: string;
  foreground: number | undefined;
}

/** The runs of text of window `name`'s active terminal, in order, each with the palette colour xterm gave its cell. */
export async function terminalSpans(name: string): Promise<TerminalSpan[]> {
  return evaluate<TerminalSpan[]>(
    name,
    `(() => {
      const rows = document.querySelectorAll('.xterm-rows');
      const target = rows[rows.length - 1];
      return [...(target?.querySelectorAll('span') ?? [])].map(span => {
        const colour = /xterm-fg-(\\d+)/.exec(span.className);
        return {
          text: span.textContent ?? '',
          foreground: colour === null ? undefined : Number(colour[1]),
        };
      });
    })()`,
  );
}

/**
 * Gives window `name`'s active terminal the keyboard focus, as a click on it does: once a connect ends, its window's
 * editor holds the focus, and the input rows type into whatever has it.
 */
export async function focusTerminal(name: string): Promise<void> {
  await evaluate<string>(
    name,
    `(() => {
      const terms = document.querySelectorAll('.xterm');
      const term = terms[terms.length - 1];
      if (term === undefined) {
        return 'no-terminal';
      }
      const input = term.querySelector('.xterm-helper-textarea');
      (input ?? term).focus();
      return 'focused';
    })()`,
  );
}

/** Presses Ctrl+C in window `name`, wherever its page has focus, as the keyboard does: a `c` with Control held. */
export async function pressControlC(name: string): Promise<void> {
  await pressStroke(await pageOf(name), name, {
    key: 'c',
    code: 'KeyC',
    windowsVirtualKeyCode: 67,
    nativeVirtualKeyCode: 67,
    modifiers: 2,
    text: '\u0003',
  });
}

/**
 * Types `text` into window `name`, as the keyboard does, wherever its page has focus: a character at a time, `Enter`
 * for a newline, `Backspace` for a DEL, and `Delete` for an ESC (the delete key's stroke begins with it). The callers
 * arrange the focus, which a terminal takes when it opens.
 */
export async function typeInTerminal(
  name: string,
  text: string,
): Promise<void> {
  await settled(
    () => `the terminal of window ${name}`,
    async () => ((await terminalPresent(name)) ? true : undefined),
  );
  const address = await pageOf(name);
  for (const character of text) {
    if (character === '\n') {
      await pressKey(address, name, 'Enter');
    } else if (character === '\x7f') {
      await pressKey(address, name, 'Backspace');
    } else if (character === '\x1b') {
      await pressKey(address, name, 'Delete');
    } else {
      await pressCharacter(address, name, character);
    }
  }
}
