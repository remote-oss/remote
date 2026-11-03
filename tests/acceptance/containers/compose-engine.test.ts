import {deepStrictEqual} from 'node:assert';
import {existsSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {
  closeWindow,
  devContainersOf,
  inWindow,
  reopenInContainer,
  variable,
  windowState,
} from '../windows/harness.ts';
import {openFolderWindow, setUserSetting} from '../windows/folder-windows.ts';
import {answerDialog, dialogOf, waitForDialog} from '../windows/renderer.ts';
import {
  composeContainersOfRun,
  composeFolder,
  containerNamesOf,
  dockerWithoutPlugin,
  openedCompose,
  removeComposeContainers,
  scriptAt,
  standaloneCompose,
  standaloneLines,
  volumeNamesOf,
} from './compose-support.ts';

const DOCKER_PATH = 'dev.containers.dockerPath';
const COMPOSE_PATH = 'dev.containers.dockerComposePath';

/** Runs Reopen in Container in window `name`, reads the dialog it shows, and answers Cancel. */
async function dialogOfReopen(
  name: string,
): Promise<{message: string; details: string; buttons: string[]}> {
  const running = inWindow(name, 'remote-containers.reopenInContainer');
  running.catch(() => undefined);
  const dialog = await waitForDialog(name, 60_000);
  const shown = {
    message: dialog.message,
    details: dialog.details,
    buttons: dialog.buttons,
  };
  await answerDialog(name, 'Cancel');
  await running.catch(() => undefined);
  return shown;
}

describe('the Compose that a connect runs with (card containers-143, part B)', function () {
  this.timeout(300_000);

  afterEach(async () => {
    await setUserSetting(DOCKER_PATH, undefined);
    await setUserSetting(COMPOSE_PATH, undefined);
    await removeComposeContainers();
  });

  it('F-0201 AC-5 (c143-plugin): the Docker plugin is used and the setting’s program is never run; the project, its container and its volume are named after the folder', async () => {
    const marker = path.join(variable('HARNESS_RUN_FOLDER'), 'c143-marker');
    await setUserSetting(
      COMPOSE_PATH,
      standaloneCompose('dc-unused', '1.29.0', marker),
    );
    const folder = composeFolder({
      name: 'c143-plugin',
      place: 'devcontainer',
      namedVolume: 'data',
    });
    const {name, project} = await openedCompose(folder);
    const result = {
      project,
      containers: await containerNamesOf(project),
      volumes: (await volumeNamesOf(project)).filter(each =>
        each.endsWith('_data'),
      ),
      settingRun: existsSync(marker),
    };
    await closeWindow(name);
    deepStrictEqual(result, {
      project: 'c143-plugin_devcontainer',
      containers: [
        'c143-plugin_devcontainer-app-1',
        'c143-plugin_devcontainer-db-1',
      ],
      volumes: ['c143-plugin_devcontainer_data'],
      settingRun: false,
    });
  });

  it('F-0201 AC-44, AC-6, AC-45, AC-51 (c143-dialogs): with no plugin, the default program missing shows the single line, another missing program is named as written, one that cannot run shows S135, and no container, volume or window change follows', async () => {
    await setUserSetting(DOCKER_PATH, dockerWithoutPlugin());
    const folder = composeFolder({name: 'c143-dialogs', place: 'devcontainer'});
    const name = await openFolderWindow(folder);
    const notExecutable = path.join(
      variable('HARNESS_RUN_FOLDER'),
      'c143-plain-file',
    );
    writeFileSync(notExecutable, 'not a program');
    const shown: Array<[string, string, string, string[]]> = [];
    for (const value of [
      undefined,
      '/nowhere/dc',
      notExecutable,
      '~/bin/dc',
      '$HOME/bin/dc',
      `${notExecutable} --verbose`,
      'dc-only-in-the-folder',
    ]) {
      await setUserSetting(COMPOSE_PATH, value);
      const dialog = await dialogOfReopen(name);
      shown.push([
        String(value),
        dialog.message,
        dialog.details,
        dialog.buttons,
      ]);
    }
    const afterwards = {
      remote: (await windowState(name).catch(() => undefined))?.remoteName,
      containers: await composeContainersOfRun(),
    };
    await closeWindow(name);
    deepStrictEqual(
      [
        shown.map(([, message, details, buttons]) => [
          [message, details].filter(line => line !== ''),
          buttons,
        ]),
        afterwards,
      ],
      [
        [
          [['Docker Compose required'], ['Cancel', 'Documentation']],
          [
            ['Docker Compose required', "Command not found: '/nowhere/dc'."],
            ['Cancel', 'Documentation'],
          ],
          [['Docker Compose returned an error.'], ['Cancel', 'Show Log']],
          [
            ['Docker Compose required', "Command not found: '~/bin/dc'."],
            ['Cancel', 'Documentation'],
          ],
          [
            ['Docker Compose required', "Command not found: '$HOME/bin/dc'."],
            ['Cancel', 'Documentation'],
          ],
          [
            [
              'Docker Compose required',
              `Command not found: '${notExecutable} --verbose'.`,
            ],
            ['Cancel', 'Documentation'],
          ],
          [
            [
              'Docker Compose required',
              "Command not found: 'dc-only-in-the-folder'.",
            ],
            ['Cancel', 'Documentation'],
          ],
        ],
        {remote: null, containers: []},
      ],
    );
  });

  it('F-0201 AC-11, AC-29 (c143-standalone): with no plugin a standalone Compose runs the project with no version dialog, and a version below 1.21 names it with letters and digits only', async () => {
    await setUserSetting(DOCKER_PATH, dockerWithoutPlugin());
    const seen: Array<[string, string, string[]]> = [];
    for (const [folderName, version] of [
      ['F-0201-AC11-1', '1.0.0'],
      ['F-0201-AC11-4', '1.21.0'],
      ['F-0201-AC11-5', 'not-a-version'],
    ] as const) {
      await setUserSetting(
        COMPOSE_PATH,
        standaloneCompose(`dc-${version}`, version),
      );
      const folder = composeFolder({
        name: folderName,
        place: 'devcontainer',
        namedVolume: 'data',
      });
      const {name, project} = await openedCompose(folder);
      seen.push([
        folderName,
        project,
        (await volumeNamesOf(project)).filter(each => each.endsWith('_data')),
      ]);
      await closeWindow(name);
      await removeComposeContainers();
    }
    deepStrictEqual(seen, [
      [
        'F-0201-AC11-1',
        'f0201ac111devcontainer',
        ['f0201ac111devcontainer_data'],
      ],
      [
        'F-0201-AC11-4',
        'f-0201-ac11-4_devcontainer',
        ['f-0201-ac11-4_devcontainer_data'],
      ],
      [
        'F-0201-AC11-5',
        'f-0201-ac11-5_devcontainer',
        ['f-0201-ac11-5_devcontainer_data'],
      ],
    ]);
  });

  it('F-0413 AC-20 (c143-plugin-bad-setting): with the plugin present, a setting that names a missing program changes nothing: the connect works and no dialog shows', async () => {
    await setUserSetting(COMPOSE_PATH, '/nowhere/dc');
    const folder = composeFolder({
      name: 'c143-bad-setting',
      place: 'devcontainer',
    });
    const {name, containerId} = await openedCompose(folder);
    const result = [containerId !== '', await dialogOf(name)];
    await closeWindow(name);
    deepStrictEqual(result, [true, undefined]);
  });

  it('F-0201 AC-30, AC-33 (c143-fixed): after the dialog for a missing program, the program appearing where the setting names it, or the setting changed to a working one, connects on the next Reopen with no restart', async () => {
    await setUserSetting(DOCKER_PATH, dockerWithoutPlugin());
    const later = path.join(variable('HARNESS_RUN_FOLDER'), 'c143-later', 'dc');
    await setUserSetting(COMPOSE_PATH, later);
    const folder = composeFolder({name: 'c143-fixed', place: 'devcontainer'});
    const name = await openFolderWindow(folder);
    const first = await dialogOfReopen(name);
    scriptAt(later, standaloneLines('1.29.0'));
    await reopenInContainer(name);
    const afterAppearing = (await devContainersOf(folder)).length > 0;
    await closeWindow(name);
    await removeComposeContainers();
    await setUserSetting(COMPOSE_PATH, '/nowhere/dc');
    const second = await openFolderWindow(folder);
    const next = await dialogOfReopen(second);
    await setUserSetting(COMPOSE_PATH, standaloneCompose('dc-fixed', '1.29.0'));
    await reopenInContainer(second);
    const afterChanging = (await devContainersOf(folder)).length > 0;
    await closeWindow(second);
    deepStrictEqual(
      [first.details, afterAppearing, next.details, afterChanging],
      [
        [`Command not found: '${later}'.`][0],
        true,
        "Command not found: '/nowhere/dc'.",
        true,
      ],
    );
  });

  it('F-0201 AC-51 (c143-relative): a path inside the folder, with or without ./, runs the Compose calls', async () => {
    await setUserSetting(DOCKER_PATH, dockerWithoutPlugin());
    const connected: boolean[] = [];
    for (const written of ['tools/dc', './tools/dc']) {
      const folder = composeFolder({
        name: 'c143-relative',
        place: 'devcontainer',
      });
      scriptAt(path.join(folder, 'tools', 'dc'), standaloneLines('1.29.0'));
      await setUserSetting(COMPOSE_PATH, written);
      const {name, containerId} = await openedCompose(folder);
      connected.push(containerId !== '');
      await closeWindow(name);
      await removeComposeContainers();
    }
    deepStrictEqual(connected, [true, true]);
  });
});
