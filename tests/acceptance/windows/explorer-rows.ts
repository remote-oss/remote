/**
 * @fileoverview What the explorer rows share: the view's name, the rows it shows for a list of hosts, a wait for them,
 * and the check that nothing failed in a window.
 */

import {deepStrictEqual, strictEqual} from 'node:assert';
import {recordLines, waitFor, windowEvents} from './harness.ts';
import {
  notifications,
  renderedRows,
  type RenderedRow,
  viewRows,
  type ViewRow,
} from './renderer.ts';

/** The view of the explorer's SSH group. */
export const VIEW = 'Remotes (Tunnels/SSH)';

/** The rows of the view: the SSH group, then `hosts` in order, with `marked` its connected description. */
export function rowsOf(hosts: string[], marked: string | undefined): ViewRow[] {
  const rows: ViewRow[] = [
    {label: 'SSH', description: '', level: 1, expanded: true},
  ];
  for (const host of hosts) {
    rows.push({
      label: host,
      description: host === marked ? 'connected' : '',
      level: 2,
      expanded: undefined,
    });
  }
  return rows;
}

/**
 * The rows down to the hosts, each host's own expansion left out: the folders under a host come from Remote - SSH's
 * folder history, which every earlier window of the run fills, in this launch or in one before it.
 */
function hostLevel(rows: ViewRow[] | undefined): ViewRow[] {
  return (rows ?? [])
    .filter(viewRow => viewRow.level <= 2)
    .map(viewRow =>
      viewRow.level === 2 ? {...viewRow, expanded: undefined} : viewRow,
    );
}

/**
 * Polls the view's rows of `name` down to the hosts until they equal `expected`, then asserts them once; when they
 * never do, the assertion names the rows the view shows.
 */
export async function rowsSettled(
  name: string,
  expected: ViewRow[],
): Promise<void> {
  await waitFor(
    `the ${VIEW} rows of window ${name}`,
    async () => {
      try {
        deepStrictEqual(hostLevel(await viewRows(name, VIEW)), expected);
        return true;
      } catch {
        return false;
      }
    },
    15_000,
  ).catch(() => undefined);
  deepStrictEqual(hostLevel(await viewRows(name, VIEW)), expected);
}

/** The labels of the group's host rows in `window`, in order. */
export async function hostLabels(window: string): Promise<string[]> {
  return ((await viewRows(window, VIEW)) ?? [])
    .filter(viewRow => viewRow.level === 2)
    .map(viewRow => viewRow.label);
}

/** Waits until `window` lists exactly `hosts` under the group; when it never does, the error names what it lists. */
export async function listing(
  window: string,
  hosts: readonly string[],
): Promise<void> {
  let seen: string[] = [];
  await waitFor(
    `window ${window} to list ${hosts.join(', ')}`,
    async () => {
      seen = await hostLabels(window);
      return JSON.stringify(seen) === JSON.stringify(hosts);
    },
    15_000,
  ).catch((error: unknown) => {
    throw new Error(
      `${String(error)}; it lists ${seen.join(', ') || 'no host'}`,
      {cause: error},
    );
  });
}

/**
 * Waits until the host rows `window` renders now meet `condition`, without scrolling the list: the timings of the view
 * are the view's, not the reading's.
 */
export async function rendering(
  window: string,
  condition: (rows: RenderedRow[]) => boolean,
): Promise<void> {
  await waitFor(
    `window ${window} to render its hosts`,
    async () =>
      condition(
        (await renderedRows(window, VIEW)).filter(
          rendered => rendered.level === 2,
        ),
      ),
    15_000,
  );
}

/** Nothing failed in `name`: no toast that holds an error word, no notice line of the record, no failed command. */
export async function nothingFails(name: string): Promise<void> {
  const toasts = await notifications(name);
  for (const toast of toasts) {
    for (const word of ['Error', 'error', 'not found', 'failed']) {
      strictEqual(
        toast.includes(word),
        false,
        `window ${name} holds a failing toast: ${toast}`,
      );
    }
  }
  deepStrictEqual(recordLines('notice', name), []);
  deepStrictEqual(
    windowEvents(name).filter(each => each.event === 'failed'),
    [],
  );
}
