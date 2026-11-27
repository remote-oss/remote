/**
 * @fileoverview A window opened while the connection helper of its host ends (card #2687, F-2102 BR-3): the helper
 * lingers 2 to 6 s after the last window closes, and a window whose connect meets it at its exit connects, on the
 * helper that is ending or on a fresh one. The offsets are the band in which the window's own start-up puts its
 * connect at the exit; the rate of the failure there was 3 in 100 before the helper refused leases once ending.
 */

import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  connectedWithin,
  connectionLog,
  connectionHelpers,
  onHost,
  openWindow,
  waitFor,
} from './harness.ts';
import {closeAllButLocal, DATA_FOLDER} from './maintenance.ts';

/** The seconds after a window closes at which the next opens, in milliseconds. */
const OFFSETS = [1400, 1500, 1600, 1700, 1800];

/** How many rounds each offset has. */
const ROUNDS = 3;

function pause(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

describe('a window that opens while the helper of its host ends (card #2687, F-2102 BR-3)', function () {
  this.timeout(1_800_000);

  beforeEach(closeAllButLocal);

  /** The round at `offset`: whether the window connected, and the log lines of a failed connect it showed. */
  async function round(
    offset: number,
    repeat: number,
  ): Promise<{offset: number; connected: boolean; failures: string[]}> {
    const first = `lg-a-${String(offset)}-${String(repeat)}`;
    const second = `lg-b-${String(offset)}-${String(repeat)}`;
    await openWindow('harness', first);
    await connectedWithin(first, 120_000);
    await pause(1000);
    await closeWindow(first);
    await pause(offset);
    const mark = connectionLog().length;
    await onHost(
      'sh',
      '-c',
      `pkill -u harness -f 'server-mai[n].js'; rm -rf '${DATA_FOLDER}/bin'; true`,
    ).catch(() => undefined);
    await openWindow('harness', second);
    let connected = true;
    try {
      await connectedWithin(second, 40_000);
    } catch {
      connected = false;
    }
    const failures = connectionLog()
      .slice(mark)
      .filter(
        line =>
          line.includes('connect failed') ||
          line.includes('the helper is gone'),
      );
    await closeWindow(second).catch(() => undefined);
    await waitFor(
      'the helper to be gone',
      async () => (await connectionHelpers()).length === 0,
      30_000,
    ).catch(() => undefined);
    return {offset, connected, failures};
  }

  it('card #2687 (c2687-join-during-exit): a window opened 1.4 to 1.8 s after the last one closed connects, with no failed connect in its log', async () => {
    const rounds: Array<{
      offset: number;
      connected: boolean;
      failures: string[];
    }> = [];
    for (let repeat = 0; repeat < ROUNDS; repeat += 1) {
      for (const offset of OFFSETS) {
        rounds.push(await round(offset, repeat));
      }
    }
    deepStrictEqual(
      rounds.filter(found => !found.connected || found.failures.length > 0),
      [],
    );
  });
});
