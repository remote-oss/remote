/**
 * @fileoverview The renderer of a plainly started editor, read and clicked over the Chrome DevTools Protocol, as a user
 * sees and uses the window: a view's rows, and a click on a row's or a view's action. Only a launch with a debugging
 * port has it. The editor writes the port it chose into the user-data folder, and each window's title is its folder
 * name in brackets (the launch's `window.title`), so that a window is found by the name the agent gives it. The
 * selectors read the workbench of the run's pinned VSCodium build.
 */

import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {variable} from './harness.ts';

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

/** Whether a window's title, `[<root name>]`, belongs to the window the agent calls `name`. */
function isWindowTitled(title: string, name: string): boolean {
  return name === 'local'
    ? title === '[]'
    : title === `[${name}]` || title.startsWith(`[${name} [`);
}

/** The pages of the renderer, from the debugging port's list. */
async function pages(): Promise<DebugTarget[]> {
  const answer = await fetch(
    `http://127.0.0.1:${String(await debuggingPort())}/json/list`,
  );
  const targets = (await answer.json()) as DebugTarget[];
  return targets.filter(target => target.type === 'page');
}

/** The protocol address of window `name`'s page, once exactly one page carries its title. */
export async function pageOf(
  name: string,
  milliseconds = WAIT_MILLISECONDS,
): Promise<string> {
  let titles: string[] = [];
  return settled(
    () => `one page of window ${name} among ${JSON.stringify(titles)}`,
    async () => {
      const found = await pages();
      titles = found.map(page => page.title);
      const matching = found.filter(page => isWindowTitled(page.title, name));
      return matching.length === 1
        ? matching[0]?.webSocketDebuggerUrl
        : undefined;
    },
    milliseconds,
  );
}

/** Evaluates `expression` in window `name`'s page and returns its value; a thrown error fails with its text. */
async function evaluate<Value>(
  name: string,
  expression: string,
): Promise<Value> {
  const socket = new WebSocket(await pageOf(name));
  try {
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => {
        resolve();
      });
      socket.addEventListener('error', () => {
        reject(new Error(`no protocol connection to window ${name}`));
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
      throw new Error(`window ${name}: ${failure}`);
    }
    return answer.result?.result?.value as Value;
  } finally {
    socket.close();
  }
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
