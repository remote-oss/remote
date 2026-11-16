/**
 * @fileoverview How long the host's server outlives a window that closed its connection normally (card #2651, F-2413
 * 6.3): the window's remote extension host ends at once, and the server itself exits five minutes after the close. The
 * row waits that long, so it is a file of its own, as the parts table counts files.
 */

import {deepStrictEqual} from 'node:assert';
import {
  appendScript,
  connectedWithin,
  inWindow,
  onHost,
  openWindow,
  readUserSettings,
  restoreUserSettings,
  userSettings,
} from '../windows/harness.ts';
import {
  closeAllButLocal,
  DATA_FOLDER,
  dismissals,
} from '../windows/maintenance.ts';
import {PLATFORMS} from '../windows/tunnel-support.ts';

/** Whether a process of the host's server whose command line holds `pattern` runs. */
function runs(pattern: string): Promise<boolean> {
  return onHost('pgrep', '-u', 'harness', '-f', pattern).then(
    () => true,
    () => false,
  );
}

describe('the lifetime of the server after a window closed (card #2651, F-2413)', function () {
  this.timeout(900_000);
  let saved: string | undefined;

  before(() => {
    saved = readUserSettings();
  });

  afterEach(async () => {
    restoreUserSettings(saved);
    await closeAllButLocal();
  });

  it('F-2413 AC-11 (c2651-close-lifetime): with one connected window and no other connection, Remote: Close Remote Connection ends the window’s remote extension host at once and the server exits five minutes after the close', async () => {
    await onHost('pkill', '-u', 'harness', '-f', `${DATA_FOLDER}/`).catch(
      () => undefined,
    );
    await userSettings({...PLATFORMS});
    const name = 'c2651-close';
    appendScript(dismissals(name));
    await openWindow('harness', name);
    await connectedWithin(name, 180_000);
    await new Promise(resolve => setTimeout(resolve, 5000));
    const closedAt = Date.now();
    void inWindow(name, 'workbench.action.remote.close').catch(() => undefined);
    await new Promise(resolve => setTimeout(resolve, 5000));
    const extensionHostGone = !(await runs('--type=extensionHost'));
    let exitedAfter = -1;
    while (Date.now() - closedAt < 480_000 && exitedAfter < 0) {
      if (!(await runs(`${DATA_FOLDER}/bin/.*/out/server-main.js`))) {
        exitedAfter = Math.round((Date.now() - closedAt) / 1000);
      } else {
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    deepStrictEqual(
      {
        extensionHostGone,
        exitsAboutFiveMinutesAfter: exitedAfter >= 270 && exitedAfter <= 330,
      },
      {extensionHostGone: true, exitsAboutFiveMinutesAfter: true},
      `the server exited ${String(exitedAfter)} s after the close`,
    );
  });
});
