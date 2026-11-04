/**
 * @fileoverview The Remotes view against the picker of Connect to Host for a long file (card coverage-102, #1809, part
 * 3i): 2000 `Host` lines of two names each, listed in the picker's order, in a window in Restricted Mode.
 */

import {deepStrictEqual} from 'node:assert';
import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {closePick, pickShown} from '../windows/explorer-home.ts';
import {VIEW} from '../windows/explorer-rows.ts';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {
  closeWindow,
  inWindow,
  isTrusted,
  readUserSettings,
  restoreUserSettings,
  startInWindow,
  userSettings,
  variable,
} from '../windows/harness.ts';
import {
  allQuickPickRows,
  quickPickRowAt,
  viewRowAt,
} from '../windows/renderer.ts';

/** The lines of the file: each host has two names, `mt-<n>` and `mt-<n>-alt`. */
const HOSTS = 2000;

/** The positions the row reads, in the order it reads them: the first rows, the middle, and the last of the file. */
const POSITIONS = [1, 2, 3, 1999, 2000, 2001, 3999, 4000];

/** The command of the picker of Connect to Host. */
const CONNECT = 'opensshremotes.openEmptyWindow';

/** The most a single read of a position may take. */
const READ_MILLISECONDS = 60_000;

/** The name at 1-based `position` of the file, in file order. */
function nameAt(position: number): string {
  const host = Math.ceil(position / 2);
  return position % 2 === 1 ? `mt-${String(host)}` : `mt-${String(host)}-alt`;
}

describe('the group and the picker for a long file (card coverage-102, part 3i)', function () {
  this.timeout(900_000);
  let savedSettings: string | undefined;
  let sshFolder = '';

  before(() => {
    savedSettings = readUserSettings();
    sshFolder = path.join(variable('HARNESS_RUN_FOLDER'), 'home', '.ssh');
    mkdirSync(sshFolder, {recursive: true});
    writeFileSync(
      path.join(sshFolder, 'config'),
      `${[...Array(HOSTS).keys()]
        .map(
          index => `Host mt-${String(index + 1)} mt-${String(index + 1)}-alt`,
        )
        .join('\n')}\n`,
    );
  });

  after(() => {
    restoreUserSettings(savedSettings);
    rmSync(sshFolder, {recursive: true, force: true});
  });

  it('F-2202 AC-20 (order): in Restricted Mode the group lists one row per entry in the picker’s order, at its first rows, around the middle and at the last of the file', async () => {
    await userSettings({'remote.SSH.configFile': ''});
    const folder = path.join(variable('HARNESS_RUN_FOLDER'), 'order-window');
    mkdirSync(folder, {recursive: true});
    const window = await openFolderWindow(folder);
    try {
      const trusted = await isTrusted(window);
      await inWindow(window, 'workbench.view.remote');
      const fromView: Array<[number, string, boolean]> = [];
      for (const position of POSITIONS) {
        const started = Date.now();
        const reading = await viewRowAt(window, VIEW, position);
        fromView.push([
          position,
          reading.label,
          Date.now() - started <= READ_MILLISECONDS,
        ]);
      }
      await startInWindow(window, CONNECT);
      await pickShown(window);
      const aboveHosts = (await allQuickPickRows(window)).findIndex(entry =>
        entry.label.trim().startsWith('mt-'),
      );
      const fromPicker: Array<[number, string, boolean]> = [];
      for (const position of POSITIONS) {
        const started = Date.now();
        const reading = await quickPickRowAt(window, position + aboveHosts);
        fromPicker.push([
          position,
          reading.label.trim(),
          Date.now() - started <= READ_MILLISECONDS,
        ]);
      }
      await closePick(window);
      const expected = POSITIONS.map((position): [number, string, boolean] => [
        position,
        nameAt(position),
        true,
      ]);
      deepStrictEqual(
        [trusted, fromView, fromPicker],
        [false, expected, expected],
      );
    } finally {
      await closeWindow(window);
    }
  });
});
