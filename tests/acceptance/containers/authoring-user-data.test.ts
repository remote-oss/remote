import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {activations, openFolderWindow} from '../windows/folder-windows.ts';
import {
  closeWindow,
  variable,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {
  answerDialog,
  answerFolderDialog,
  chooseQuickPickRow,
  dialogOf,
  dialogText,
  detailedQuickPickRows,
  editorTabs,
  notificationCentre,
  notificationLinks,
  primaryButtonOf,
  quickPickFacts,
  quickPickOf,
  typeInQuickPick,
  waitForDialog,
  waitForQuickPick,
  acceptQuickPick,
} from '../windows/renderer.ts';
import {
  ALPINE_OPTION,
  CONFIGURATION,
  closeScreen,
  existing,
  startCommand,
  takeFeatureScreen,
  takeOptionScreen,
  USER_DATA_ROW,
  waitForPickAfterLocation,
  withWindow,
  WORKSPACE_ROW,
  written,
} from './authoring-support.ts';

const execFileAsync = promisify(execFile);

const MARKER = '.devcontainer/.devcontainer-internal.json';

const OPEN_FOLDER = 'remote-containers.openFolder';

const REOPEN = 'remote-containers.reopenInContainer';

/** The words of the pick, the second lines of its rows, and the description a row carries for an existing configuration. */
const LOCATION = {
  title: 'Add Dev Container Configuration Files',
  placeholder: 'Where would you like to create your container configuration?',
  workspaceDetail:
    'This allows you to share the configuration with others via source control',
  userDataDetail:
    'This avoids having outgoing changes in your workspace folder',
  exists: 'Configuration already exists',
};

/** The frame of the template pick, which follows the location pick. */
const TEMPLATE_PLACEHOLDER =
  'Select a container configuration template or enter a custom template id';

/** The start of the notification for a configuration in the store of user data, to find it by. */
const NOTICE_START =
  'There is a Dev Container configuration available for this repository.';

/** The page the notification's last link opens: the extension's introduction. */
const INTRODUCTION =
  'https://github.com/remote-oss/remote/blob/main/packages/remote-containers/README.md';

/** The store of the launch's profile: where the extension keeps the configurations that are not in a workspace. */
function storeRoot(): string {
  return path.join(
    variable('HARNESS_USER_DATA'),
    'User',
    'globalStorage',
    'remote-oss.remote-containers',
    'configs',
  );
}

/** The text of the marker of a slot that belongs to `folder`. */
function markerText(folder: string): string {
  return `// Maintained by the Dev Container extension\n${JSON.stringify({rootFolder: folder})}\n`;
}

/** The file with the home folder written as `~`, as the overwrite question names it. */
function tilde(file: string): string {
  const relative = path.relative(os.homedir(), file);
  return relative.startsWith('..') || path.isAbsolute(relative)
    ? file
    : path.join('~', relative);
}

/** Removes the slots of the run, so that a row starts with no configuration in the store. */
function emptyStore(): void {
  rmSync(storeRoot(), {recursive: true, force: true});
}

/** The names of the slots in the store. */
function slotNames(): string[] {
  return existsSync(storeRoot()) ? readdirSync(storeRoot()).sort() : [];
}

/** Starts the command in `window`, waits for the location pick and gives its rows. */
async function locationRowsOf(
  window: string,
): Promise<Array<[string, string, string, boolean]>> {
  await startCommand(window);
  await waitForQuickPick(window);
  return rowsOf(window);
}

/** The rows of the pick open in `window` as the rows of this card are compared: label, description, second line. */
async function rowsOf(
  window: string,
): Promise<Array<[string, string, string, boolean]>> {
  return (await detailedQuickPickRows(window)).map(each => [
    each.label,
    each.description,
    each.detail,
    each.focused,
  ]);
}

/** Answers the location pick of `window` with the user data row and waits for the pick that follows it. */
async function chooseUserData(window: string): Promise<void> {
  await waitForQuickPick(window);
  await chooseQuickPickRow(window, USER_DATA_ROW);
  await waitForPickAfterLocation(window);
}

/** Runs the command in `window` for the user data folder and picks the template labelled `label`. */
async function writeToStore(window: string, label = 'Alpine'): Promise<void> {
  await startCommand(window);
  await chooseUserData(window);
  await chooseQuickPickRow(window, label);
  await takeOptionScreen(window, ALPINE_OPTION);
  await takeFeatureScreen(window);
}

/** Picks the custom template `mini` of the run's registry in the pick open in `window`. */
async function chooseMini(window: string): Promise<void> {
  await waitForQuickPick(window);
  await typeInQuickPick(
    window,
    `${variable('HARNESS_TEMPLATE_REGISTRY')}/remote-oss-run/custom/mini`,
  );
  await waitFor(
    'the custom row',
    async () =>
      (await detailedQuickPickRows(window)).some(each =>
        each.label.startsWith("Use '"),
      ),
    10_000,
  );
  await acceptQuickPick(window);
  await takeOptionScreen(window, 'Greeting:');
  await takeFeatureScreen(window);
}

/**
 * The containers the engine made for `folder`. The template writes no run label into the configuration, so the run's
 * clean-up cannot find them, and `removeContainersOf` removes them.
 */
async function containersOf(folder: string): Promise<string[]> {
  const {stdout} = await execFileAsync('docker', [
    'ps',
    '--all',
    '--quiet',
    '--filter',
    `label=devcontainer.local_folder=${folder}`,
  ]);
  return stdout.split('\n').filter(line => line !== '');
}

/** Waits until the engine has made a container for `folder`, which is what the reload does by itself. */
function containerMade(folder: string): Promise<void> {
  return waitFor(
    `a container for ${folder}`,
    async () => (await containersOf(folder)).length > 0,
    240_000,
  );
}

/** Removes the containers the engine made for `folder`. */
async function removeContainersOf(folder: string): Promise<void> {
  const containers = await containersOf(folder);
  if (containers.length > 0) {
    await execFileAsync('docker', ['rm', '--force', ...containers]);
  }
}

/** The label `label` of the container of `folder`, read from the engine. */
async function labelOfContainer(
  folder: string,
  label: string,
): Promise<string> {
  const [container = ''] = await containersOf(folder);
  const {stdout} = await execFileAsync('docker', [
    'inspect',
    '-f',
    `{{index .Config.Labels "${label}"}}`,
    container,
  ]);
  return stdout.trim();
}

/** A folder named `name` below `parent` in the run's folder, made empty. */
function emptyFolder(parent: string, name: string): string {
  const folder = path.join(
    variable('HARNESS_RUN_FOLDER'),
    'authoring',
    parent,
    name,
  );
  rmSync(folder, {recursive: true, force: true});
  mkdirSync(folder, {recursive: true});
  return folder;
}

describe('the location pick and the store of user data (card containers-91)', function () {
  this.timeout(900_000);

  beforeEach(emptyStore);

  it('F-0801 AC-3 (u1): the command opens a non-modal pick with the title, the placeholder, the two rows with their second lines and no buttons, the first focused; Escape closes it and writes nothing', async () => {
    await withWindow('u1', {}, async (window, folder) => {
      await startCommand(window);
      await waitForQuickPick(window);
      const facts = await quickPickFacts(window);
      const rows = await rowsOf(window);
      const buttons = (await detailedQuickPickRows(window)).map(
        each => each.buttons,
      );
      await closeScreen(window);
      deepStrictEqual(
        [facts, rows, buttons, existing(folder, '.devcontainer'), slotNames()],
        [
          {
            title: LOCATION.title,
            placeholder: LOCATION.placeholder,
            titleButtons: [],
            multiSelect: false,
          },
          [
            [WORKSPACE_ROW, '', LOCATION.workspaceDetail, true],
            [USER_DATA_ROW, '', LOCATION.userDataDetail, false],
          ],
          [[], []],
          [],
          [],
        ],
      );
    });
  });

  it('F-0801 AC-5, F-0302 AC-4, AC-5 (u2): Alpine to the user data folder writes the configuration and its marker into the folder’s slot and nothing into the workspace, opens it in a preview and offers the reopen notification with both links, without a reload; run again, the row says the configuration exists and goes straight to the templates', async () => {
    await withWindow('u2', {}, async (window, folder) => {
      const activated = activations(window);
      await writeToStore(window);
      const slot = path.join(storeRoot(), 'u2');
      await written(path.join(slot, CONFIGURATION));
      await waitFor(
        'the reopen notification',
        async () =>
          (await notificationCentre(window)).some(text =>
            text.startsWith(NOTICE_START),
          ),
        30_000,
      );
      const notice = (await notificationCentre(window)).filter(text =>
        text.startsWith(NOTICE_START),
      );
      const links = await notificationLinks(window, NOTICE_START);
      const previewTab = (await editorTabs(window)).find(
        each => each.label === 'devcontainer',
      );
      const state = await windowState(window);
      const first = {
        alpine: readFileSync(path.join(slot, CONFIGURATION), 'utf8').includes(
          'base:alpine',
        ),
        marker: readFileSync(path.join(slot, MARKER), 'utf8'),
        workspace: existing(folder, '.devcontainer', '.devcontainer.json'),
        slots: slotNames(),
        notice,
        links,
        preview: previewTab?.preview,
        remoteName: state.remoteName,
        reloaded: activations(window) !== activated,
      };
      await startCommand(window);
      await waitForQuickPick(window);
      const again = await rowsOf(window);
      await chooseQuickPickRow(window, USER_DATA_ROW);
      await waitForPickAfterLocation(window);
      const next = (await quickPickFacts(window))?.placeholder;
      await closeScreen(window);
      deepStrictEqual(
        [first, again, next],
        [
          {
            alpine: true,
            marker: markerText(folder),
            workspace: [],
            slots: ['u2'],
            notice: [
              `${NOTICE_START} Reopen folder to develop in a container (learn more).`,
            ],
            links: [
              {
                text: 'Dev Container configuration',
                href: 'command:remote-containers.openDevContainerFile',
              },
              {text: 'learn more', href: INTRODUCTION},
            ],
            preview: true,
            remoteName: null,
            reloaded: false,
          },
          [
            [WORKSPACE_ROW, '', LOCATION.workspaceDetail, true],
            [USER_DATA_ROW, LOCATION.exists, LOCATION.userDataDetail, false],
          ],
          TEMPLATE_PLACEHOLDER,
        ],
      );
    });
  });

  it('F-0801 AC-17, F-0302 AC-15 (u3): a second folder named like the first gets configs/app-2, shows no existing configuration beforehand, and leaves the first folder’s marker as it was', async () => {
    const first = emptyFolder('u3a', 'app');
    const second = emptyFolder('u3b', 'app');
    const firstWindow = await openFolderWindow(first);
    await writeToStore(firstWindow);
    await written(path.join(storeRoot(), 'app', CONFIGURATION));
    await closeWindow(firstWindow);
    const secondWindow = await openFolderWindow(second);
    try {
      await startCommand(secondWindow);
      await waitForQuickPick(secondWindow);
      const before = await rowsOf(secondWindow);
      await chooseQuickPickRow(secondWindow, USER_DATA_ROW);
      await waitForPickAfterLocation(secondWindow);
      await chooseQuickPickRow(secondWindow, 'Alpine');
      await takeOptionScreen(secondWindow, ALPINE_OPTION);
      await takeFeatureScreen(secondWindow);
      await written(path.join(storeRoot(), 'app-2', CONFIGURATION));
      deepStrictEqual(
        [
          before.map(each => each[1]),
          slotNames(),
          readFileSync(path.join(storeRoot(), 'app', MARKER), 'utf8'),
          readFileSync(path.join(storeRoot(), 'app-2', MARKER), 'utf8'),
        ],
        [['', ''], ['app', 'app-2'], markerText(first), markerText(second)],
      );
    } finally {
      await closeWindow(secondWindow).catch(() => undefined);
    }
  });

  it('F-0302 AC-30 (u4): the workspace row carries "Configuration already exists" for a configuration of the folder, the user data row for a slot of the folder, both for both, and a configuration in a subfolder counts for neither', async () => {
    const cases: Array<[string, Record<string, string>, boolean, string[]]> = [
      ['u4-none', {}, false, ['', '']],
      ['u4-folder', {[CONFIGURATION]: '{}'}, false, [LOCATION.exists, '']],
      ['u4-dot', {'.devcontainer.json': '{}'}, false, [LOCATION.exists, '']],
      ['u4-slot', {}, true, ['', LOCATION.exists]],
      [
        'u4-both',
        {[CONFIGURATION]: '{}'},
        true,
        [LOCATION.exists, LOCATION.exists],
      ],
      [
        'u4-sub',
        {
          '.devcontainer/a/devcontainer.json': '{}',
          'sub/.devcontainer.json': '{}',
        },
        false,
        ['', ''],
      ],
    ];
    const seen: string[][] = [];
    for (const [name, contents, stored] of cases) {
      await withWindow(name, contents, async (window, folder) => {
        if (stored) {
          const marker = path.join(storeRoot(), name, MARKER);
          mkdirSync(path.dirname(marker), {recursive: true});
          writeFileSync(marker, markerText(folder));
        }
        const rows = await locationRowsOf(window);
        await closeScreen(window);
        seen.push(rows.map(each => each[1]));
      });
    }
    deepStrictEqual(
      seen,
      cases.map(([, , , expected]) => expected),
    );
  });

  it('F-0302 AC-35 (u5): choosing the user data folder again asks about the stored file by its path with ~; Overwrite replaces it in the same slot, Skip and Cancel leave it, and no second slot appears', async () => {
    await withWindow('u5', {}, async window => {
      await writeToStore(window);
      const stored = path.join(storeRoot(), 'u5', CONFIGURATION);
      await written(stored);
      const outcomes: unknown[] = [];
      for (const answer of ['Skip', 'Cancel', 'Overwrite'] as const) {
        writeFileSync(stored, 'mine');
        await writeToStore(window);
        const dialog = await waitForDialog(window);
        const said = await dialogText(window);
        const primary = await primaryButtonOf(window);
        await answerDialog(window, answer);
        await waitFor(
          'the wizard to end',
          async () =>
            (await dialogOf(window)) === undefined &&
            (await quickPickOf(window)) === undefined,
          30_000,
        );
        await new Promise(resolve => setTimeout(resolve, 3000));
        outcomes.push([
          said?.includes(`File '${tilde(stored)}' already exists, overwrite?`),
          dialog.buttons,
          primary,
          readFileSync(stored, 'utf8') === 'mine' ? 'mine' : 'replaced',
          slotNames(),
        ]);
      }
      deepStrictEqual(outcomes, [
        [true, ['Overwrite', 'Cancel', 'Skip'], 'Skip', 'mine', ['u5']],
        [true, ['Overwrite', 'Cancel', 'Skip'], 'Skip', 'mine', ['u5']],
        [true, ['Overwrite', 'Cancel', 'Skip'], 'Skip', 'replaced', ['u5']],
      ]);
    });
  });

  it('F-0403 AC-4 (u7): Open Folder in Container on an empty folder asks where, the user data folder leaves the folder unchanged, writes the configuration and a marker for it, and reloads into a container whose configuration label is the stored file', async () => {
    const target = emptyFolder('', 'u7-target');
    await withWindow('u7', {}, async window => {
      const running = startCommand(window, OPEN_FOLDER);
      await running;
      await answerFolderDialog(window, target);
      await waitFor(
        'the location pick',
        async () =>
          (await quickPickFacts(window))?.placeholder === LOCATION.placeholder,
        180_000,
      );
      const facts = await quickPickFacts(window);
      const rows = await rowsOf(window);
      await chooseQuickPickRow(window, USER_DATA_ROW);
      await waitForPickAfterLocation(window);
      await chooseMini(window);
      const stored = path.join(storeRoot(), 'u7-target', CONFIGURATION);
      await written(stored);
      await containerMade(target);
      deepStrictEqual(
        [
          facts,
          rows,
          existing(target, '.devcontainer', '.devcontainer.json'),
          readFileSync(path.join(storeRoot(), 'u7-target', MARKER), 'utf8'),
          await labelOfContainer(target, 'devcontainer.config_file'),
          await labelOfContainer(target, 'devcontainer.local_folder'),
        ],
        [
          {
            title: LOCATION.title,
            placeholder: LOCATION.placeholder,
            titleButtons: [],
            multiSelect: false,
          },
          [
            [WORKSPACE_ROW, '', LOCATION.workspaceDetail, true],
            [USER_DATA_ROW, '', LOCATION.userDataDetail, false],
          ],
          [],
          markerText(target),
          stored,
          target,
        ],
      );
      await closeWindow('u7-target');
      await removeContainersOf(target);
    });
  });

  it('F-0302 AC-11, AC-33 (u8): Reopen in Container on a folder with nothing shows no error and the location pick directly, and finishing it with either target goes on by itself to make the container on the written file', async () => {
    const seen: unknown[] = [];
    for (const [name, location] of [
      ['u8-workspace', WORKSPACE_ROW],
      ['u8-user-data', USER_DATA_ROW],
    ] as const) {
      const folder = emptyFolder('u8', name);
      const window = await openFolderWindow(folder);
      try {
        await startCommand(window, REOPEN);
        await waitForQuickPick(window, 180_000);
        const dialog = await dialogOf(window);
        const placeholder = (await quickPickFacts(window))?.placeholder;
        await chooseQuickPickRow(window, location);
        await waitForPickAfterLocation(window);
        await chooseMini(window);
        await containerMade(folder);
        seen.push([
          dialog,
          placeholder,
          await labelOfContainer(folder, 'devcontainer.config_file'),
          existing(folder, '.devcontainer').length,
          slotNames().includes(name),
        ]);
      } finally {
        await closeWindow(name).catch(() => undefined);
        await removeContainersOf(folder);
      }
    }
    deepStrictEqual(seen, [
      [
        undefined,
        LOCATION.placeholder,
        path.join(
          variable('HARNESS_RUN_FOLDER'),
          'authoring',
          'u8',
          'u8-workspace',
          CONFIGURATION,
        ),
        1,
        false,
      ],
      [
        undefined,
        LOCATION.placeholder,
        path.join(storeRoot(), 'u8-user-data', CONFIGURATION),
        0,
        true,
      ],
    ]);
  });
});
