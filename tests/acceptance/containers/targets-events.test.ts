import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  closeWindow,
  devContainerFolder,
  inWindow,
  reopenInContainer,
  runLabelArguments,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {rowsWhen, VIEW} from '../windows/dev-containers-view.ts';
import {
  openFolderWindow,
  clearEarlierRows,
  setUserSetting,
} from '../windows/folder-windows.ts';
import {
  notificationCentre,
  toggleRow,
  viewRows,
  welcomeText,
} from '../windows/renderer.ts';

const execFileAsync = promisify(execFile);

/** How soon after a change of Docker the view follows it, in milliseconds (F-0901 AC-56). */
const FOLLOW_MILLISECONDS = 5_000;

/** The start of the notification F-0402 shows in a local window whose folder holds a configuration; it is not the view's. */
const REOPEN_NOTIFICATION =
  'Folder contains a Dev Container configuration file.';

/** Runs a plain container of the run named `containerName`. */
async function runContainer(containerName: string): Promise<void> {
  await execFileAsync('docker', [
    'run',
    '-d',
    '--name',
    containerName,
    ...runLabelArguments(),
    variable('HARNESS_DEVCONTAINER_IMAGE'),
    'sleep',
    '600',
  ]);
}

/** Removes the container `containerName`. */
async function removeContainer(containerName: string): Promise<void> {
  await execFileAsync('docker', ['rm', '-f', containerName]);
}

/** Whether view rows of window `name` hold a row whose description is `containerName`. */
async function lists(name: string, containerName: string): Promise<boolean> {
  try {
    return ((await viewRows(name, VIEW)) ?? []).some(
      each => each.description === containerName,
    );
  } catch {
    return false;
  }
}

/**
 * Starts a plain container, so that the view has a row to show (on an engine with no container it shows its welcome
 * text), then opens a local window on a new folder named `folderName` with its Dev Containers view showing rows.
 */
async function windowWithRows(folderName: string): Promise<string> {
  await runContainer(`${folderName}-seed`);
  const name = await openFolderWindow(devContainerFolder(folderName));
  await inWindow(name, 'workbench.view.remote');
  await rowsWhen(name, rows => rows.length > 0);
  return name;
}

describe('the Dev Containers view follows Docker (card containers-31)', function () {
  this.timeout(600_000);

  beforeEach(clearEarlierRows);

  it('F-0901 AC-56 (gate-row-14): a container started from the command line gets its row, and one removed loses it, each within 5 s and with no Refresh', async () => {
    const name = await windowWithRows('events-one');
    await runContainer('events-one-c');
    await waitFor(
      'the row of the started container',
      () => lists(name, 'events-one-c'),
      FOLLOW_MILLISECONDS,
    );
    await removeContainer('events-one-c');
    await waitFor(
      'the row of the removed container to go',
      async () => !(await lists(name, 'events-one-c')),
      FOLLOW_MILLISECONDS,
    );
    await closeWindow(name);
  });

  it('F-0901 AC-44: in a local window a dockerPath that names no program gives the Docker welcome within 5 s, with no notification, and the old one brings the rows back', async () => {
    const name = await windowWithRows('events-two');
    await setUserSetting(
      'dev.containers.dockerPath',
      path.join(variable('HARNESS_RUN_FOLDER'), 'no-such-docker'),
    );
    try {
      let shown: string | undefined;
      await waitFor(
        'the Docker welcome',
        async () => {
          try {
            shown = await welcomeText(name, VIEW);
          } catch {
            return false;
          }
          return shown !== undefined;
        },
        FOLLOW_MILLISECONDS,
      );
      deepStrictEqual(
        [
          shown?.startsWith(
            'Get started with containers by installing Docker or by visiting the help view.',
          ),
          (await notificationCentre(name)).filter(
            text => !text.startsWith(REOPEN_NOTIFICATION),
          ),
        ],
        [true, []],
      );
    } finally {
      await setUserSetting('dev.containers.dockerPath', undefined);
    }
    await rowsWhen(name, rows => rows.length > 0, FOLLOW_MILLISECONDS * 3);
    await closeWindow(name);
  });

  it('F-0901 AC-45: in a dev container window a dockerPath that names no program changes nothing, and a container started afterwards still gets its row, with no welcome', async () => {
    const folder = devContainerFolder('events-three');
    const name = await openFolderWindow(folder);
    await reopenInContainer(name);
    await inWindow(name, 'workbench.view.remote');
    await rowsWhen(name, rows => rows.length > 0);
    await setUserSetting(
      'dev.containers.dockerPath',
      path.join(variable('HARNESS_RUN_FOLDER'), 'no-such-docker'),
    );
    try {
      await runContainer('events-three-c');
      await waitFor(
        'the row of the container started after the change',
        () => lists(name, 'events-three-c'),
        FOLLOW_MILLISECONDS,
      );
      deepStrictEqual(await welcomeText(name, VIEW), undefined);
    } finally {
      await setUserSetting('dev.containers.dockerPath', undefined);
    }
    await closeWindow(name);
  });

  it('F-0901 AC-57: a header the user collapsed stays collapsed when a new container makes the view rebuild', async () => {
    const name = await windowWithRows('events-four');
    await toggleRow(name, VIEW, 'Other Containers');
    await runContainer('events-four-c');
    await new Promise(resolve => setTimeout(resolve, 3_000));
    const header = ((await viewRows(name, VIEW)) ?? []).find(
      each => each.label === 'Other Containers',
    );
    deepStrictEqual(header?.expanded, false);
    await closeWindow(name);
  });
});
