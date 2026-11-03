/**
 * @fileoverview Configure Container Features in the states of the window and the files around it (card containers-150,
 * part E): a configuration with unsaved changes, the choice among several files, the file in the user data folder, and an
 * unsaved workspace of several folders.
 */

import {deepStrictEqual} from 'node:assert';
import {mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {
  closeWindow,
  inWindow,
  variable,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {
  acceptQuickPick,
  answerDialog,
  editorTabs,
  notificationCentre,
  pageText,
  pressEscape,
  pressQuickPickTitleButton,
  quickPickChecks,
  quickPickFacts,
  rememberPage,
  toggleQuickPickRow,
  typeInQuickPick,
  waitForDialog,
} from '../windows/renderer.ts';
import {
  FEATURES_PLACEHOLDER,
  screenWith,
  storeRoot,
} from '../windows/authoring-support.ts';

const COMMAND = 'remote-containers.configureContainerFeatures';
const PLAIN = 'Lab Plain';
const COMMON = 'Common Utilities';

/** A folder of the run named `label` with the files `contents` by relative path. */
function folderWith(
  label: string,
  contents: Readonly<Record<string, string>>,
): string {
  const folder = path.join(variable('HARNESS_RUN_FOLDER'), label);
  rmSync(folder, {recursive: true, force: true});
  mkdirSync(folder, {recursive: true});
  for (const [relative, text] of Object.entries(contents)) {
    const file = path.join(folder, relative);
    mkdirSync(path.dirname(file), {recursive: true});
    writeFileSync(file, text);
  }
  return folder;
}

/** The labels of the rows of the pick that are checked, without the owner the accessible label also holds. */
async function checkedLabels(window: string): Promise<string[]> {
  return (await quickPickChecks(window))
    .filter(each => each.checked)
    .map(each => each.label.split(', ')[0] ?? each.label);
}

describe('Configure Container Features around the window’s state (card containers-150, part E)', function () {
  this.timeout(600_000);

  it('F-0807 AC-37 (c150-dirty): a configuration open with unsaved changes gets the Feature on the disk, the editor keeps its buffer unsaved, and a save after it shows the conflict notification', async () => {
    const text = '{\n    "image": "x"\n}\n';
    const folder = folderWith('c150-dirty', {
      '.devcontainer/devcontainer.json': text,
    });
    const file = path.join(folder, '.devcontainer', 'devcontainer.json');
    const window = await openFolderWindow(folder);
    try {
      await inWindow(window, 'acceptance.agent.typeInto', file, '// unsaved\n');
      await waitFor(
        'the configuration to be unsaved',
        async () => (await editorTabs(window)).some(each => each.dirty),
        30_000,
      );
      inWindow(window, COMMAND).catch(() => undefined);
      await screenWith(window, FEATURES_PLACEHOLDER);
      await toggleQuickPickRow(window, PLAIN);
      await pressQuickPickTitleButton(window, 'Finish');
      await waitFor(
        'the Feature on the disk',
        () => readFileSync(file, 'utf8').includes('lab-plain'),
        60_000,
      );
      await new Promise(resolve => setTimeout(resolve, 3000));
      const shown = (await editorTabs(window)).find(each => each.active);
      await inWindow(window, 'workbench.action.files.save');
      await new Promise(resolve => setTimeout(resolve, 3000));
      deepStrictEqual(
        {
          dirty: shown?.dirty,
          buffer: (await pageText(window)).includes('unsaved'),
          conflict: (await notificationCentre(window)).some(message =>
            message.startsWith("Failed to save 'devcontainer.json'"),
          ),
        },
        {dirty: true, buffer: true, conflict: true},
      );
    } finally {
      // A window with unsaved changes asks about them when it closes.
      await inWindow(window, 'workbench.action.files.revert').catch(
        () => undefined,
      );
      await closeWindow(window).catch(() => undefined);
    }
  });

  it('F-0807 AC-24 (c150-pick-file): the Features checked are those of the file picked among several, and only that file is written', async () => {
    const dotfile = '{"features": {}}\n';
    const folder = folderWith('c150-pick-file', {
      '.devcontainer.json': dotfile,
      '.devcontainer/devcontainer.json': '{"name": "Main one"}\n',
    });
    const window = await openFolderWindow(folder);
    try {
      inWindow(window, COMMAND).catch(() => undefined);
      await waitFor(
        'the pick of the file',
        async () =>
          (await quickPickFacts(window))?.placeholder ===
          'Select a devcontainer.json file.',
        60_000,
      );
      await typeInQuickPick(window, 'Main one');
      await new Promise(resolve => setTimeout(resolve, 700));
      await acceptQuickPick(window);
      await screenWith(window, FEATURES_PLACEHOLDER);
      const checked = await checkedLabels(window);
      await toggleQuickPickRow(window, PLAIN);
      await pressQuickPickTitleButton(window, 'Finish');
      const main = path.join(folder, '.devcontainer', 'devcontainer.json');
      await waitFor(
        'the Feature in the picked file',
        () => readFileSync(main, 'utf8').includes('lab-plain'),
        60_000,
      );
      deepStrictEqual(
        [
          checked,
          readFileSync(path.join(folder, '.devcontainer.json'), 'utf8'),
        ],
        [[], dotfile],
      );
    } finally {
      await closeWindow(window).catch(() => undefined);
    }
  });

  it('F-0807 AC-42 (c150-user-data-checked): a folder with a configuration only in the user data folder opens the pick with the Features that file lists checked', async () => {
    const folder = folderWith('c150-user-data-checked', {'README.md': 'x\n'});
    const slot = path.join(
      storeRoot(),
      'c150-user-data-checked',
      '.devcontainer',
    );
    mkdirSync(slot, {recursive: true});
    writeFileSync(
      path.join(slot, 'devcontainer.json'),
      JSON.stringify({
        image: 'x',
        features: {'ghcr.io/devcontainers/features/common-utils:2': {}},
      }),
    );
    writeFileSync(
      path.join(slot, '.devcontainer-internal.json'),
      `// Maintained by the Dev Container extension\n${JSON.stringify({rootFolder: folder})}\n`,
    );
    const window = await openFolderWindow(folder);
    try {
      inWindow(window, COMMAND).catch(() => undefined);
      await screenWith(window, FEATURES_PLACEHOLDER);
      const checked = await checkedLabels(window);
      await pressEscape(window);
      deepStrictEqual(checked, [COMMON]);
    } finally {
      await closeWindow(window).catch(() => undefined);
      rmSync(path.dirname(slot), {recursive: true, force: true});
    }
  });

  it('F-0807 AC-50 (c150-untitled): in an unsaved workspace of several folders with no configuration, Add Files... shows the dialog that asks to save the workspace first', async () => {
    const first = folderWith('c150-untitled-a', {'README.md': 'x\n'});
    const second = folderWith('c150-untitled-b', {'README.md': 'x\n'});
    const window = await openFolderWindow(first);
    try {
      await inWindow(window, 'acceptance.agent.addFolder', second);
      await waitFor(
        `window ${window} to become an untitled workspace`,
        async () =>
          (
            await windowState(window).catch(() => undefined)
          )?.workspaceFile?.startsWith('untitled:') === true,
        60_000,
      );
      await rememberPage(window);
      inWindow(window, COMMAND).catch(() => undefined);
      await waitForDialog(window, 60_000);
      await answerDialog(window, 'Add Files...');
      const dialog = await waitForDialog(window, 60_000);
      await answerDialog(window, dialog.buttons[0] ?? 'OK');
      deepStrictEqual(
        dialog.details,
        'You need to first save your workspace in a folder containing all its workspace folders.',
      );
    } finally {
      await closeWindow(window).catch(() => undefined);
    }
  });
});
