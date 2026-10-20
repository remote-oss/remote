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
import {variable, windowState} from './harness.ts';

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

/** The port the editor chose, from the file it writes in the run's user-data folder. */
async function debuggingPort(): Promise<number> {
  const file = path.join(
    variable('HARNESS_RUN_FOLDER'),
    'user-data',
    'DevToolsActivePort',
  );
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

/**
 * The title of the page of a window with this state among `titles`: the workspace's name for a workspace window, else
 * the folder name in brackets, `[]` for a local window with no folder, and `[]` plus the remote name for a remote one.
 * It fails when two titles match, naming both: two folder-less windows of one kind can't be told apart, and the gate
 * rows never have two.
 */
export function pageTitleFor(
  state: PageState,
  titles: readonly string[],
): string | undefined {
  const folder = state.folders[0];
  const workspaceFile = state.workspaceFile ?? null;
  const bracketed =
    workspaceFile !== null
      ? workspaceTitleName(workspaceFile)
      : folder === undefined
        ? undefined
        : folderName(folder);
  const matching = titles.filter(title =>
    bracketed === undefined
      ? state.remoteName === null
        ? title === '[]'
        : title.startsWith('[]') && title !== '[]'
      : title === `[${bracketed}]` || title.startsWith(`[${bracketed} [`),
  );
  if (matching.length > 1) {
    throw new Error(
      `two pages match the window's state: ${JSON.stringify(matching)}`,
    );
  }
  return matching[0];
}

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
  return Promise.race([
    state,
    new Promise<undefined>(resolve => {
      setTimeout(resolve, remaining, undefined);
    }),
  ]);
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
        return found.find(page => page.title === named)?.webSocketDebuggerUrl;
      }
      const state = await stateForPage(
        name,
        milliseconds - (Date.now() - started),
      );
      const title =
        state === undefined
          ? undefined
          : pageTitleFor(
              {
                folders: state.folders,
                remoteName: state.remoteName,
                workspaceFile: state.workspaceFile,
              },
              titles,
            );
      const chosen =
        title === undefined
          ? undefined
          : found.find(page => page.title === title);
      return chosen?.webSocketDebuggerUrl;
    },
    milliseconds,
  );
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

/** The page-side lookup of a view's pane by its header title; `undefined` when no pane has it. */
function paneExpression(viewName: string): string {
  return `[...document.querySelectorAll('.pane')].find(pane => pane.querySelector('.pane-header .title')?.textContent === ${JSON.stringify(viewName)})`;
}

/** The rows of view `viewName` in window `name`, in the order shown; `undefined` when the window has no such view. */
export async function viewRows(
  name: string,
  viewName: string,
): Promise<ViewRow[] | undefined> {
  const rows = await evaluate<ViewRow[] | null>(
    name,
    `(() => {
      const pane = ${paneExpression(viewName)};
      if (pane === undefined) {
        return null;
      }
      return [...pane.querySelectorAll('[role="treeitem"]')].map(row => ({
        label: row.querySelector('.label-name')?.textContent ?? '',
        description: row.querySelector('.label-description')?.textContent ?? '',
        level: Number(row.getAttribute('aria-level')),
        expanded: row.hasAttribute('aria-expanded') ? row.getAttribute('aria-expanded') === 'true' : undefined,
      }));
    })()`,
  );
  return rows ?? undefined;
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

/** The connecting toast of a window: its message and its bar, which core draws as `infinite` or `discrete`. */
export interface ConnectingToast {
  message: string;
  progress: 'infinite' | 'discrete' | 'none';
}

/**
 * The toast of window `name` whose message starts with `messageStart`, with the state of its progress bar, or nothing
 * when there is none. Core draws an indeterminate bar with the class `infinite` on the toast's `.monaco-progress-container`
 * and a determinate one without it ([oss] `src/vs/base/browser/ui/progressbar/progressbar.ts`).
 */
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
  const bar = item.parentElement?.querySelector('.monaco-progress-container') ?? null;
  const shown = bar !== null && bar.classList.contains('active') && !bar.classList.contains('done');
  return {
    message: item.querySelector('.notification-list-item-message')?.textContent ?? '',
    progress: !shown ? 'none' : bar.classList.contains('infinite') ? 'infinite' : 'discrete',
  };
})()`,
  ).then(found => found ?? undefined);
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
  await evaluate<null>(
    name,
    `(() => {
      const input = document.querySelector('${QUICK_WIDGET} .quick-input-box input');
      input.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(label)});
      input.dispatchEvent(new Event('input', {bubbles: true}));
      return null;
    })()`,
  );
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
 * given. It waits for the dialog to open, and fails when none does.
 */
async function keyInFolderDialog(
  name: string,
  key: 'Enter' | 'Escape',
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
  await pressKey(await pageOf(name), name, key);
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
  'Enter' | 'Escape' | 'Backspace' | 'Delete',
  number
> = {
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
