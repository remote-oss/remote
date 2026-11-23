/**
 * @fileoverview What the editor shows when the extension pack or one of its members is uninstalled in a window of the
 * launch (card #3037, F-9102): the actions run through core's commands, and every row puts the launch's installed set
 * back through the command-line launcher before it ends. The file runs last of the suite, after the rows that read the
 * installed pack.
 */

import {deepStrictEqual} from 'node:assert';
import {existsSync, mkdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {closeWindow, inWindow, variable, waitFor} from '../windows/harness.ts';
import {
  dialogOf,
  extensionsViewSections,
  notifications,
} from '../windows/renderer.ts';
import {installing, launcher, PACK_ID} from './pack-support.ts';

/** The pack's display name. */
const PACK = 'Remote Development';

/** The extensions the launch installs, in the order it installs them: what a row puts back. */
const LAUNCH_SET = [
  'remote-oss.remote-ssh-edit',
  'remote-oss.remote-containers',
  'remote-oss.remote-ssh',
  PACK_ID,
];

/** The launch's own profile, for the command-line launcher. */
function launchProfile() {
  return {
    extensions: variable('HARNESS_EXTENSIONS_FOLDER'),
    userData: variable('HARNESS_USER_DATA'),
    logs: path.join(variable('HARNESS_RUN_FOLDER'), 'extensionpack-uninstall'),
  };
}

/** The extension folders core has marked for deletion at its next start. */
function obsoleteFolders(): string[] {
  const file = path.join(variable('HARNESS_EXTENSIONS_FOLDER'), '.obsolete');
  return existsSync(file)
    ? Object.keys(JSON.parse(readFileSync(file, 'utf8')) as object).toSorted()
    : [];
}

/** Puts the launch's installed set back from the VSIX files, whatever a row uninstalled. */
function restoredLaunchSet(): void {
  launcher(launchProfile(), installing(LAUNCH_SET));
}

describe('uninstalling the extension pack and its members in a window (card #3037, F-9102)', function () {
  this.timeout(300_000);

  let window = '';

  beforeEach(async () => {
    const folder = path.join(
      variable('HARNESS_RUN_FOLDER'),
      'extensionpack-uninstall',
    );
    mkdirSync(folder, {recursive: true});
    window = await openFolderWindow(folder);
    await inWindow(window, 'workbench.view.extensions');
    await waitFor(
      'the Extensions view to list the pack',
      async () =>
        (await extensionsViewSections(window)).some(section =>
          section.entries.includes(PACK),
        ),
      30_000,
    );
  });

  afterEach(async () => {
    try {
      await closeWindow(window);
    } finally {
      restoredLaunchSet();
    }
  });

  it('F-9102 AC-2 (c3037-no-dialog): uninstalling the pack shows no dialog, confirmation or notification', async () => {
    await inWindow(window, 'workbench.extensions.uninstallExtension', PACK_ID);
    await waitFor(
      'the pack to be marked for deletion',
      () => obsoleteFolders().some(folder => folder.startsWith(`${PACK_ID}-`)),
      30_000,
    );
    const during = {
      dialog: await dialogOf(window),
      notifications: await notifications(window),
    };
    await new Promise(resolve => setTimeout(resolve, 3000));
    deepStrictEqual(
      [
        during,
        {
          dialog: await dialogOf(window),
          notifications: await notifications(window),
        },
      ],
      [
        {dialog: undefined, notifications: []},
        {dialog: undefined, notifications: []},
      ],
    );
  });

  it('F-9102 AC-14 (c3037-member): uninstalling one member on its own leaves the pack and the other members installed, with no notification', async () => {
    const markedBefore = obsoleteFolders();
    await inWindow(
      window,
      'workbench.extensions.uninstallExtension',
      'remote-oss.remote-containers',
    );
    await waitFor(
      'Dev Containers to be marked for deletion',
      () => obsoleteFolders().length > markedBefore.length,
      30_000,
    );
    await new Promise(resolve => setTimeout(resolve, 3000));
    deepStrictEqual(
      {
        marked: obsoleteFolders()
          .filter(folder => !markedBefore.includes(folder))
          .map(folder => folder.split('-0.')[0]),
        listed: launcher(launchProfile(), ['--list-extensions'])
          .stdout.filter(line => line !== 'remote-oss.acceptance-window-agent')
          .toSorted(),
        notifications: await notifications(window),
        dialog: await dialogOf(window),
      },
      {
        marked: ['remote-oss.remote-containers'],
        listed: [
          'remote-oss.remote-ssh',
          'remote-oss.remote-ssh-edit',
          PACK_ID,
        ],
        notifications: [],
        dialog: undefined,
      },
    );
  });
});
