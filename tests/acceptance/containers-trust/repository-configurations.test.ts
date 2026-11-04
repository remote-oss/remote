/**
 * @fileoverview The configurations outside a repository in an untrusted folder (card containers-161, F-0302 AC-17,
 * BR-6): nothing is looked up, the `git` read included, until the folder is trusted.
 */

import {deepStrictEqual} from 'node:assert';
import {execFileSync} from 'node:child_process';
import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {openFolderWindow, setUserSetting} from '../windows/folder-windows.ts';
import {
  closeWindow,
  containersLog,
  inWindow,
  runLabelArguments,
  variable,
} from '../windows/harness.ts';
import {
  answerDialog,
  notificationCentre,
  pressEscape,
  quickPickRows,
  waitForDialog,
  waitForQuickPick,
} from '../windows/renderer.ts';

const SETTING = 'dev.containers.repositoryConfigurationPaths';
const REOPEN = 'remote-containers.reopenInContainer';
const EXTERNAL_NOTICE_START =
  'There is a Dev Container configuration available for this repository.';
const MAIN = '.devcontainer/devcontainer.json';

/** Writes a configuration named `name` at `relative` below `folder`. */
function configurationAt(folder: string, relative: string, name: string): void {
  const file = path.join(folder, relative);
  mkdirSync(path.dirname(file), {recursive: true});
  writeFileSync(
    file,
    JSON.stringify({
      name,
      image: variable('HARNESS_DEVCONTAINER_IMAGE'),
      runArgs: runLabelArguments(),
    }),
  );
}

describe('configurations outside the repository in an untrusted folder (card containers-161, F-0302)', function () {
  this.timeout(900_000);

  afterEach(async () => {
    await setUserSetting(SETTING, undefined);
  });

  it('F-0302 AC-17 (c161-trust): in an untrusted folder the reopen notification of a mirrored file does not show and nothing is looked up or logged; after the trust dialog’s Cancel still nothing, and after trust the pick lists the mirrored files', async () => {
    const name = 'c161-trust';
    const folder = path.join(variable('HARNESS_RUN_FOLDER'), name);
    rmSync(folder, {recursive: true, force: true});
    mkdirSync(folder, {recursive: true});
    execFileSync('git', ['init', '-q', folder]);
    execFileSync('git', [
      '-C',
      folder,
      'remote',
      'add',
      'origin',
      `https://github.com/o/${name}.git`,
    ]);
    const first = path.join(variable('HARNESS_RUN_FOLDER'), `${name}-one`);
    const second = path.join(variable('HARNESS_RUN_FOLDER'), `${name}-two`);
    for (const [root, title] of [
      [first, 'One'],
      [second, 'Two'],
    ] as const) {
      rmSync(root, {recursive: true, force: true});
      configurationAt(root, path.join('github.com', 'o', name, MAIN), title);
    }
    await setUserSetting(SETTING, [first, second]);
    const mark = containersLog().length;
    const window = await openFolderWindow(folder);
    try {
      await new Promise(resolve => setTimeout(resolve, 12_000));
      function lookups(): string[] {
        return containersLog()
          .slice(mark)
          .filter(line => line.includes('looking for a configuration in'));
      }
      const beforeCommand = [
        (await notificationCentre(window)).filter(text =>
          text.startsWith(EXTERNAL_NOTICE_START),
        ),
        lookups(),
      ];
      inWindow(window, REOPEN).catch(() => undefined);
      await waitForDialog(window, 60_000);
      await answerDialog(window, 'Cancel');
      await new Promise(resolve => setTimeout(resolve, 3000));
      const afterCancel = lookups();
      inWindow(window, REOPEN).catch(() => undefined);
      await waitForDialog(window, 60_000);
      await answerDialog(window, 'Trust Folder & Continue');
      await waitForQuickPick(window, 180_000);
      const rows = (await quickPickRows(window)).map(entry => entry.label);
      await pressEscape(window);
      deepStrictEqual(
        [beforeCommand, afterCancel, rows, lookups().length > 0],
        [[[], []], [], ['One', 'Two'], true],
      );
    } finally {
      await closeWindow(window).catch(() => undefined);
    }
  });
});
