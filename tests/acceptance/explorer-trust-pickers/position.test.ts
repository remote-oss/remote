/**
 * @fileoverview The readers of a long list by position (card tooling-122): the Remotes view's SSH group and the picker
 * of Connect to Host, for a file of 2000 hosts, in a window in Restricted Mode with real pickers.
 */

import {deepStrictEqual} from 'node:assert';
import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {systemHosts} from '../windows/explorer-home.ts';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {
  closeWindow,
  inWindow,
  isTrusted,
  startInWindow,
  userSettings,
  variable,
  readUserSettings,
  restoreUserSettings,
} from '../windows/harness.ts';
import {VIEW} from '../windows/explorer-rows.ts';
import {
  allQuickPickRows,
  pressEscape,
  quickPickRowAt,
  viewRowAt,
} from '../windows/renderer.ts';

/** How many hosts the file holds, and the positions the row reads. */
const HOSTS = 2000;
const POSITIONS = [1, 1000, HOSTS];

/** The command of the picker of Connect to Host. */
const CONNECT = 'opensshremotes.openEmptyWindow';

/** The most a single read of a position may take. */
const READ_MILLISECONDS = 30_000;

describe('the readers of a long list by position (card tooling-122)', function () {
  this.timeout(600_000);
  let savedSettings: string | undefined;
  let sshFolder = '';

  before(() => {
    savedSettings = readUserSettings();
    sshFolder = path.join(variable('HARNESS_RUN_FOLDER'), 'home', '.ssh');
    mkdirSync(sshFolder, {recursive: true});
    writeFileSync(
      path.join(sshFolder, 'config'),
      `${[...Array(HOSTS).keys()]
        .map(index => `Host mt-${String(index + 1)}`)
        .join('\n')}\n`,
    );
  });

  after(() => {
    restoreUserSettings(savedSettings);
    rmSync(sshFolder, {recursive: true, force: true});
  });

  it('the view and the picker give the same names at the first, the thousandth and the last of 2000 hosts, in Restricted Mode, each read within 30 s', async () => {
    await userSettings({'remote.SSH.configFile': ''});
    const folder = path.join(variable('HARNESS_RUN_FOLDER'), 'positions');
    mkdirSync(folder, {recursive: true});
    const window = await openFolderWindow(folder);
    try {
      const trusted = await isTrusted(window);
      await inWindow(window, 'workbench.view.remote');
      const fromView: Array<{label: string; size: number; took: boolean}> = [];
      for (const position of POSITIONS) {
        const started = Date.now();
        const reading = await viewRowAt(window, VIEW, position);
        fromView.push({
          label: reading.label,
          size: reading.size,
          took: Date.now() - started <= READ_MILLISECONDS,
        });
      }
      await startInWindow(window, CONNECT);
      const entries = await allQuickPickRows(window);
      const aboveHosts = entries.findIndex(entry =>
        entry.label.trim().startsWith('mt-'),
      );
      const fromPicker: Array<{label: string; took: boolean}> = [];
      for (const position of POSITIONS) {
        const started = Date.now();
        const reading = await quickPickRowAt(window, position + aboveHosts);
        fromPicker.push({
          label: reading.label.trim(),
          took: Date.now() - started <= READ_MILLISECONDS,
        });
      }
      await pressEscape(window);
      const names = POSITIONS.map(position => `mt-${String(position)}`);
      deepStrictEqual(
        [trusted, fromView, fromPicker],
        [
          false,
          // The system file's hosts follow the user file's, in the group and in the picker.
          names.map(label => ({
            label,
            size: HOSTS + systemHosts().length,
            took: true,
          })),
          names.map(label => ({label, took: true})),
        ],
      );
    } finally {
      await closeWindow(window);
    }
  });
});
