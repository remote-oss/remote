/**
 * @fileoverview The killed-window rows of F-0417, one per launch: a kill ends the launch's editor and the editor
 * never comes back within a launch, so `containers-killed-23`, `containers-killed-35` and `containers-killed-43`
 * run this one suite with their case named in `HARNESS_KILLED_CASE`, and a launch registers only its own row —
 * the kill is its last act. After the kill a row reads only Docker and the host, never the agent again.
 */

import {deepStrictEqual, strictEqual} from 'node:assert';
import {killWindow} from '../windows/harness.ts';
import {
  connectedWindow,
  removeContainersOf,
  stoppedWithin,
  watched,
  type Outcome,
} from '../containers-shutdown/support.ts';

/** The case of this launch: `23`, `35` or `43`, one killed-window row per launch. */
const KILLED_CASE = process.env.HARNESS_KILLED_CASE ?? '';

/**
 * Opens `name`'s window on a new folder, reopens it in its container, kills the window with `reach` and
 * watches the container for 15 s from the kill; the container is removed either way.
 */
async function killedWindow(
  name: string,
  reach: 'processGroup' | 'mainProcess' | 'tree',
): Promise<Outcome> {
  const connected = await connectedWindow(name);
  try {
    const atKill = Date.now();
    await killWindow(connected.window, reach);
    return await watched(connected.containerId, 15, atKill);
  } finally {
    await removeContainersOf(connected.folder);
  }
}

/** The row of each case, registered by its launch. */
const ROWS: Record<string, () => void> = {
  '23': () =>
    it('F-0417 AC-23 (k23): a window whose process group is killed at once has its container stopped, Exited (0), 9 to 15 s after the kill', async () => {
      const outcome = await killedWindow('c70-k23', 'processGroup');
      deepStrictEqual(
        stoppedWithin(outcome, 0, {from: 9, until: 15}),
        true,
        JSON.stringify(outcome),
      );
    }),
  '35': () =>
    it('F-0417 AC-35 (k35): a window whose main process is killed has its container stopped, Exited (0), 9 to 15 s after the kill', async () => {
      const outcome = await killedWindow('c70-k35', 'mainProcess');
      deepStrictEqual(
        stoppedWithin(outcome, 0, {from: 9, until: 15}),
        true,
        JSON.stringify(outcome),
      );
    }),
  '43': () =>
    it('F-0417 AC-43 (k43): a window whose whole tree is killed on linux has its container stopped, Exited (0), within 15 s of the last process ending', async () => {
      const outcome = await killedWindow('c70-k43', 'tree');
      deepStrictEqual(
        stoppedWithin(outcome, 0, {from: 0, until: 15}),
        true,
        JSON.stringify(outcome),
      );
    }),
};

describe("the container stops when the window's processes are killed (card containers-70)", function () {
  this.timeout(300_000);

  it('containers-70: the launch names one of the killed cases', () => {
    strictEqual(KILLED_CASE in ROWS, true);
  });

  ROWS[KILLED_CASE]?.();
});
