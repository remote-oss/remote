/**
 * @fileoverview A configuration file whose name is not a well-known location (F-0207 7.E5, card #3080): a plain dotless
 * `devcontainer.json` at the folder root is no configuration, so the folder gets no reopen notification and Reopen in
 * Container starts the F-0801 wizard and creates no container, while a configuration in the root dotfile or in a
 * subfolder of `.devcontainer` gets the notification and resolves a container as usual.
 */

import {deepStrictEqual} from 'node:assert';
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {
  closeWindow,
  devContainersOf,
  reopenInContainer,
  runLabelArguments,
  startInWindow,
  variable,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';
import {noticesOnceSettled, quickPickFacts} from '../windows/renderer.ts';
import {
  closeScreen,
  rowsOf,
  WORKSPACE_ROW,
  USER_DATA_ROW,
} from '../windows/authoring-support.ts';

/** The start of the reopen notification's message (F-0402). */
const NOTICE_START = 'Folder contains a Dev Container configuration file.';

/** The command "Reopen in Container". */
const REOPEN_IN_CONTAINER = 'remote-containers.reopenInContainer';

/** The folder `name` of the run, made empty, with the file `relative` holding a configuration on the run's image. */
function folderWith(name: string, relative: string): string {
  const folder = path.join(variable('HARNESS_RUN_FOLDER'), 'c3080', name);
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
  return folder;
}

/** Whether the notices window `window` shows hold the reopen notification. */
async function noticeShown(window: string): Promise<boolean> {
  return (await noticesOnceSettled(window).catch(() => [])).some(text =>
    text.startsWith(NOTICE_START),
  );
}

/** Opens a folder with its configuration at `relative` and checks the notification and a normal Reopen in Container. */
async function resolvedWith(name: string, relative: string): Promise<void> {
  const folder = folderWith(name, relative);
  const window = await openFolderWindow(folder);
  try {
    const noticed = await noticeShown(window);
    await reopenInContainer(window);
    deepStrictEqual(
      {
        noticed,
        containers: (await devContainersOf(folder)).length,
        remote: (await windowState(window)).remoteName,
      },
      {noticed: true, containers: 1, remote: 'dev-container'},
    );
  } finally {
    await closeWindow(window).catch(() => undefined);
    await removeContainers(folder);
  }
}

describe('a configuration file that is not at a well-known location (card #3080, F-0207 7.E5)', function () {
  this.timeout(900_000);

  it('F-0207 AC-18 (c3080-dotless): a plain dotless devcontainer.json at the folder root gets no reopen notification, and Reopen in Container starts the wizard with the two location rows and creates no container', async () => {
    const folder = folderWith('c3080-dotless', 'devcontainer.json');
    const window = await openFolderWindow(folder);
    try {
      const noticed = await noticeShown(window);
      await startInWindow(window, REOPEN_IN_CONTAINER);
      await waitFor(
        'the wizard’s location pick',
        async () =>
          (await quickPickFacts(window))?.placeholder ===
          'Where would you like to create your container configuration?',
        120_000,
      );
      const facts = await quickPickFacts(window);
      const rows = (await rowsOf(window)).map(entry => entry[0]);
      await closeScreen(window);
      deepStrictEqual(
        {
          noticed,
          title: facts?.title,
          rows,
          containers: await devContainersOf(folder),
          remote: (await windowState(window)).remoteName,
        },
        {
          noticed: false,
          title: 'Add Dev Container Configuration Files',
          rows: [WORKSPACE_ROW, USER_DATA_ROW],
          containers: [],
          remote: null,
        },
      );
    } finally {
      await closeWindow(window).catch(() => undefined);
      await removeContainers(folder);
    }
  });

  it('F-0207 AC-18 (c3080-dotfile): a configuration in .devcontainer.json gets the reopen notification, and Reopen in Container resolves the container with no wizard', async () => {
    await resolvedWith('c3080-dotfile', '.devcontainer.json');
  });

  it('F-0207 AC-18 (c3080-subfolder): a configuration in .devcontainer/service/devcontainer.json gets the reopen notification, and Reopen in Container resolves the container with no wizard', async () => {
    await resolvedWith(
      'c3080-subfolder',
      '.devcontainer/service/devcontainer.json',
    );
  });
});
