import {deepStrictEqual} from 'node:assert';
import {existsSync, mkdirSync, rmSync} from 'node:fs';
import path from 'node:path';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {closeWindow, inWindow, variable} from '../windows/harness.ts';
import {
  dialogText,
  pressEscape,
  quickPickOf,
  waitForDialog,
} from '../windows/renderer.ts';

const COMMAND = 'remote-containers.createDevContainerFile';

/** Which way the launch's catalogue fails: `broken` is an index that does not parse, `down` a dropped connection. */
const CASE = variable('HARNESS_INDEX_CASE');

/** The modal the wizard shows when the catalogue cannot be had, and what the window shows besides it, for an empty folder. */
async function failureOf(
  name: string,
): Promise<{said: string | undefined; pick: unknown; written: boolean}> {
  const folder = path.join(variable('HARNESS_RUN_FOLDER'), 'authoring', name);
  rmSync(folder, {recursive: true, force: true});
  mkdirSync(folder, {recursive: true});
  const window = await openFolderWindow(folder);
  try {
    inWindow(window, COMMAND).catch(() => undefined);
    await waitForDialog(window, 120_000);
    const said = await dialogText(window);
    const pick = await quickPickOf(window);
    await pressEscape(window);
    return {
      said,
      pick,
      written: existsSync(path.join(folder, '.devcontainer')),
    };
  } finally {
    await closeWindow(window).catch(() => undefined);
  }
}

describe('the wizard when the template catalogue cannot be had (card containers-80)', function () {
  this.timeout(600_000);

  if (CASE === 'down') {
    it('F-0801 AC-35 (index-down): an index whose connection is dropped shows the modal with the cause, no screen, and writes nothing', async () => {
      const failed = await failureOf('index-down');
      deepStrictEqual(
        [
          failed.said?.includes(
            "The list of dev container templates couldn't be downloaded: ",
          ),
          failed.pick,
          failed.written,
        ],
        [true, undefined, false],
      );
    });
  }

  if (CASE === 'broken') {
    it('F-0801 AC-36 (index-broken): an index that does not parse shows the modal with the cause, no screen, and writes nothing', async () => {
      const failed = await failureOf('index-broken');
      deepStrictEqual(
        [
          failed.said?.includes(
            "The list of dev container templates couldn't be downloaded: ",
          ),
          failed.pick,
          failed.written,
        ],
        [true, undefined, false],
      );
    });
  }
});
