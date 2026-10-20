/**
 * @fileoverview What the explorer rows share: the view's name, the rows it shows for a list of hosts, a wait for them,
 * and the check that nothing failed in a window.
 */

import {deepStrictEqual, strictEqual} from 'node:assert';
import {recordLines, waitFor, windowEvents} from '../windows/harness.ts';
import {notifications, viewRows, type ViewRow} from '../windows/renderer.ts';

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

/** Polls the view's rows of `name` until they equal `expected`, then asserts them once. */
export async function rowsSettled(
  name: string,
  expected: ViewRow[],
): Promise<void> {
  await waitFor(
    `the ${VIEW} rows of window ${name}`,
    async () => {
      try {
        deepStrictEqual(await viewRows(name, VIEW), expected);
        return true;
      } catch {
        return false;
      }
    },
    15_000,
  );
  deepStrictEqual(await viewRows(name, VIEW), expected);
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
