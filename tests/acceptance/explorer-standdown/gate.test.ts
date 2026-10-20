/**
 * @fileoverview The recorded gate row 7 of explorer slice 1 (card coverage-25b, #645): beside the stand-in that carries
 * the other Remote Explorer extension's id, the explorer shows the coexistence warning, lists no SSH row, and its Refresh is not found.
 */

import {deepStrictEqual} from 'node:assert';
import {inWindow, waitFor} from '../windows/harness.ts';
import {notifications, viewRows} from '../windows/renderer.ts';

/** The launch's first window and the view it shows. */
const LOCAL = 'local';
const VIEW = 'Remotes (Tunnels/SSH)';

/** The coexistence warning the explorer shows beside the stand-in, as explorer-03b publishes it. */
const STAND_DOWN_WARNING =
  'Remote Explorer stays inactive in this window because another Remote Explorer extension is enabled. Both use the same commands, settings and views. Disable one of the two and reload the window.';

describe('the gate row of explorer slice 1 in the explorer-standdown launch (card coverage-25b, row 7)', function () {
  this.timeout(180_000);

  it('F-5001.AC-19, F-5901.AC-4: beside the stand-in the explorer shows the coexistence warning, lists no SSH row, and refresh is not found', async () => {
    await inWindow(LOCAL, 'remoteTargets.focus');
    let shown: string[] = [];
    await waitFor(
      `the coexistence warning in window ${LOCAL}`,
      async () => {
        shown = await notifications(LOCAL);
        return shown.includes(STAND_DOWN_WARNING);
      },
      30_000,
    );
    await waitFor(
      `the ${VIEW} pane of window ${LOCAL}`,
      async () => (await viewRows(LOCAL, VIEW)) !== undefined,
      15_000,
    );
    let refreshError: unknown;
    try {
      await inWindow(LOCAL, 'remote-explorer.refresh');
    } catch (caught) {
      refreshError = caught;
    }
    deepStrictEqual(
      {
        warning: shown.includes(STAND_DOWN_WARNING),
        sshRows:
          (await viewRows(LOCAL, VIEW))?.filter(each => each.label === 'SSH') ??
          [],
        refreshNotFound:
          refreshError instanceof Error &&
          refreshError.message.includes('not found'),
      },
      {warning: true, sshRows: [], refreshNotFound: true},
    );
  });
});
