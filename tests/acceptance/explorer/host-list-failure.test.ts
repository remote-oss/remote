/**
 * @fileoverview The host list of the Remotes view when the configured file can't be read: a refresh keeps the names
 * last read from the same source, and a window that opens with the file already unparsable shows the group without
 * host rows, each with no notification (card connect-83, #1170).
 */

import {deepStrictEqual} from 'node:assert';
import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {
  closeWindow,
  inWindow,
  readUserSettings,
  restoreUserSettings,
  userSettings,
  variable,
  windowEvents,
} from '../windows/harness.ts';
import {notifications, titleAction} from '../windows/renderer.ts';
import {rowsOf, rowsSettled, VIEW} from '../windows/explorer-rows.ts';
import {reloadedWindow} from './reloaded-window.ts';

/** The run-local configuration file the rows point `remote.SSH.configFile` at. */
const FILE = path.join(variable('HARNESS_RUN_FOLDER'), 'hosts-35');

/** The folder the unparsable-start window opens, which is also the window's name. */
const START = 'hosts-start';

const REFRESH = 'Refresh';

/** Polls until the window's agent has activated, for up to a minute. */
async function windowActive(name: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (!windowEvents(name).some(each => each.event === 'activated')) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for window ${name}`);
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}

describe('the host list when the configuration file can’t be read (card connect-83, #1170)', function () {
  this.timeout(180_000);

  /** The reloaded local window of the launch, found or made before the rows. */
  let reloaded = '';

  before(async () => {
    reloaded = await reloadedWindow();
  });

  it('F-5102 AC-35 (unparsable-refresh): a refresh with the file now unparsable keeps the names last read from it, and no notification shows', async () => {
    writeFileSync(FILE, 'Host keep-a\nHost keep-b\n');
    const saved = readUserSettings();
    try {
      await userSettings({'remote.SSH.configFile': FILE});
      await inWindow(reloaded, 'remoteTargets.focus');
      await titleAction(reloaded, VIEW, REFRESH);
      await rowsSettled(reloaded, rowsOf(['keep-a', 'keep-b'], undefined));
      writeFileSync(FILE, 'Host "unterminated\n');
      await titleAction(reloaded, VIEW, REFRESH);
      await rowsSettled(reloaded, rowsOf(['keep-a', 'keep-b'], undefined));
      deepStrictEqual(await notifications(reloaded), []);
    } finally {
      restoreUserSettings(saved);
    }
  });

  it('F-5102 AC-35 (unparsable-start): a window opened with the file already unparsable shows the group without host rows, and no notification shows', async () => {
    writeFileSync(FILE, 'Host "unterminated\n');
    const saved = readUserSettings();
    try {
      await userSettings({'remote.SSH.configFile': FILE});
      const folder = path.join(variable('HARNESS_RUN_FOLDER'), START);
      mkdirSync(folder, {recursive: true});
      await inWindow(
        reloaded,
        'acceptance.agent.openWindow',
        pathToFileURL(folder).href,
      );
      try {
        await windowActive(START);
        await inWindow(START, 'remoteTargets.focus');
        await rowsSettled(START, rowsOf([], undefined));
        deepStrictEqual(await notifications(START), []);
      } finally {
        await closeWindow(START);
      }
    } finally {
      restoreUserSettings(saved);
      rmSync(FILE, {force: true});
    }
  });
});
