/**
 * @fileoverview The recorded gate row 6 of explorer slice 1 (card coverage-25b, #645): with the SSH companion absent,
 * the Remotes view is empty before and after Refresh, and nothing fails.
 */

import {deepStrictEqual, strictEqual} from 'node:assert';
import {
  inWindow,
  recordLines,
  waitFor,
  windowEvents,
} from '../windows/harness.ts';
import {
  notifications,
  titleAction,
  viewRows,
  type ViewRow,
} from '../windows/renderer.ts';

/** The launch's first window and the view with its Refresh action. */
const LOCAL = 'local';
const VIEW = 'Remotes (Tunnels/SSH)';
const REFRESH = 'Refresh';

/** Polls the view's rows of `local` until they equal `expected`, then asserts them once. */
async function rowsSettled(expected: ViewRow[]): Promise<void> {
  await waitFor(
    `the ${VIEW} rows of window ${LOCAL}`,
    async () => {
      try {
        deepStrictEqual(await viewRows(LOCAL, VIEW), expected);
        return true;
      } catch {
        return false;
      }
    },
    15_000,
  );
  deepStrictEqual(await viewRows(LOCAL, VIEW), expected);
}

/** Nothing failed in `local`: no toast that holds an error word, no notice line of the record, no failed command. */
async function nothingFails(): Promise<void> {
  const toasts = await notifications(LOCAL);
  for (const toast of toasts) {
    for (const word of ['Error', 'error', 'not found', 'failed']) {
      strictEqual(
        toast.includes(word),
        false,
        `window ${LOCAL} holds a failing toast: ${toast}`,
      );
    }
  }
  deepStrictEqual(recordLines('notice', LOCAL), []);
  deepStrictEqual(
    windowEvents(LOCAL).filter(each => each.event === 'failed'),
    [],
  );
}

describe('the gate row of explorer slice 1 in the explorer-alone launch (card coverage-25b, row 6)', function () {
  this.timeout(180_000);

  it('F-5101.AC-12, F-5902.AC-2: without the companion the view is empty before and after Refresh, and nothing fails', async () => {
    await inWindow(LOCAL, 'remoteTargets.focus');
    await rowsSettled([]);
    await titleAction(LOCAL, VIEW, REFRESH);
    await rowsSettled([]);
    await nothingFails();
  });
});
