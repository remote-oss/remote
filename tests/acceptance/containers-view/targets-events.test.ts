import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  closeWindow,
  devContainerFolder,
  inWindow,
  devContainersOf,
  reloadWindow,
  reopenInContainer,
  runLabelArguments,
  runScopedName,
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
  rowContextMenu,
  titleAction,
  titleActions,
  toggleRow,
  viewRows,
  welcomeText,
} from '../windows/renderer.ts';

const execFileAsync = promisify(execFile);

/** The headers of the groups of the view, in order. */
const GROUPS = ['Dev Containers', 'Other Containers'];

/** How soon after a change of Docker the view follows it, in milliseconds (F-0901 AC-56). */
const FOLLOW_MILLISECONDS = 5_000;

/** The start of the notification F-0402 shows in a local window whose folder holds a configuration; it is not the view's. */
const REOPEN_NOTIFICATION =
  'Folder contains a Dev Container configuration file.';

/** The title actions of the view while it lists containers: Refresh, the one this release builds (F-0901 BR-6). */
const TITLE_ACTIONS = ['Refresh'];

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
  await runContainer(runScopedName(`${folderName}-seed`));
  const name = await openFolderWindow(devContainerFolder(folderName));
  await inWindow(name, 'workbench.view.remote');
  await rowsWhen(name, rows => rows.length > 0);
  return name;
}

describe('the Dev Containers view follows Docker (card containers-31)', function () {
  this.timeout(600_000);

  beforeEach(clearEarlierRows);

  it('F-0901 AC-56 (gate-row-14): a container started from the command line gets its row, and one removed loses it, each within 5 s and with no Refresh', async () => {
    const started = runScopedName('events-one-c');
    const name = await windowWithRows('events-one');
    await runContainer(started);
    await waitFor(
      'the row of the started container',
      () => lists(name, started),
      FOLLOW_MILLISECONDS,
    );
    await removeContainer(started);
    await waitFor(
      'the row of the removed container to go',
      async () => !(await lists(name, started)),
      FOLLOW_MILLISECONDS,
    );
    await closeWindow(name);
  });

  it('F-0901 AC-44: in a local window a dockerPath that names no program gives the Docker welcome within 5 s, with no title actions and no notification, and the old one brings the rows and the title actions back', async () => {
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
          await titleActions(name, VIEW),
        ],
        [true, [], []],
      );
    } finally {
      await setUserSetting('dev.containers.dockerPath', undefined);
    }
    await rowsWhen(name, rows => rows.length > 0, FOLLOW_MILLISECONDS * 3);
    await waitFor(
      'the title actions to return',
      async () =>
        (await titleActions(name, VIEW)).join() === TITLE_ACTIONS.join(),
      FOLLOW_MILLISECONDS,
    );
    await closeWindow(name);
  });

  it('F-0901 AC-45: in a dev container window a dockerPath that names no program changes nothing (the groups and the title actions stay), and a container started afterwards still gets its row, with no welcome', async () => {
    const later = runScopedName('events-three-c');
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
      await runContainer(later);
      await waitFor(
        'the row of the container started after the change',
        () => lists(name, later),
        FOLLOW_MILLISECONDS,
      );
      deepStrictEqual(
        [
          await welcomeText(name, VIEW),
          await titleActions(name, VIEW),
          ((await viewRows(name, VIEW)) ?? []).some(
            each => each.label === 'Dev Containers',
          ),
        ],
        [undefined, TITLE_ACTIONS, true],
      );
    } finally {
      await setUserSetting('dev.containers.dockerPath', undefined);
    }
    await closeWindow(name);
  });

  /** Whether each group header of window `name`'s view is expanded; undefined for a header that is not shown. */
  async function headerStates(
    name: string,
  ): Promise<Record<string, boolean | undefined>> {
    const rows = (await viewRows(name, VIEW)) ?? [];
    return Object.fromEntries(
      GROUPS.map(label => [
        label,
        rows.find(each => each.label === label)?.expanded,
      ]),
    );
  }

  /** Lets the view follow Docker: its events come within a second. */
  function settled(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 3_000));
  }

  it('F-0901 AC-57 (collapse): a collapsed header stays collapsed through a Refresh and every start, run and stop; a group that empties comes back expanded; a reload expands both; a header has no context menu', async () => {
    const running = runScopedName('events-five-a');
    const stopped = runScopedName('events-five-stopped');
    const startedLater = runScopedName('events-five-b');
    const afterEmptied = runScopedName('events-five-c');
    const folder = devContainerFolder('events-five', {name: 'Events Five'});
    const own = await openFolderWindow(folder);
    await reopenInContainer(own);
    await inWindow(own, 'workbench.view.remote');
    await rowsWhen(own, rows => rows.length > 0);
    // The row of the window's own dev container has a menu; a header, by the same right click, has none.
    const ownMenu = await rowContextMenu(own, VIEW, 'events-five');
    await closeWindow(own);
    await runContainer(running);
    await execFileAsync('docker', [
      'create',
      '--name',
      stopped,
      ...runLabelArguments(),
      variable('HARNESS_DEVCONTAINER_IMAGE'),
      'sleep',
      '600',
    ]);
    const name = await openFolderWindow(devContainerFolder('events-five-from'));
    await inWindow(name, 'workbench.view.remote');
    await rowsWhen(name, rows =>
      GROUPS.every(group => rows.some(each => each.label === group)),
    );
    await toggleRow(name, VIEW, 'Other Containers');
    const steps: Array<Record<string, boolean | undefined>> = [
      await headerStates(name),
    ];
    async function afterEach(): Promise<void> {
      await settled();
      steps.push(await headerStates(name));
    }
    await titleAction(name, VIEW, 'Refresh');
    await afterEach();
    await execFileAsync('docker', ['start', stopped]);
    await afterEach();
    await runContainer(startedLater);
    await afterEach();
    const [devId] = await devContainersOf(folder);
    await execFileAsync('docker', ['stop', devId ?? '']);
    await afterEach();
    const menus = [
      await rowContextMenu(name, VIEW, 'Other Containers'),
      await rowContextMenu(name, VIEW, 'Dev Containers'),
    ];
    for (const plain of [running, stopped, startedLater]) {
      await removeContainer(plain);
    }
    await settled();
    const emptied = (await headerStates(name))['Other Containers'];
    await runContainer(afterEmptied);
    await settled();
    const returned = await headerStates(name);
    await toggleRow(name, VIEW, 'Other Containers');
    await toggleRow(name, VIEW, 'Dev Containers');
    const collapsed = await headerStates(name);
    await reloadWindow(name);
    await inWindow(name, 'workbench.view.remote');
    await rowsWhen(name, rows =>
      GROUPS.every(group => rows.some(each => each.label === group)),
    );
    const reloaded = await headerStates(name);
    deepStrictEqual(
      {
        steps,
        ownMenuHasRebuild: ownMenu.includes('Rebuild Container'),
        menus,
        emptied,
        returned,
        collapsed,
        reloaded,
      },
      {
        steps: [
          {'Dev Containers': true, 'Other Containers': false},
          {'Dev Containers': true, 'Other Containers': false},
          {'Dev Containers': true, 'Other Containers': false},
          {'Dev Containers': true, 'Other Containers': false},
          {'Dev Containers': true, 'Other Containers': false},
        ],
        ownMenuHasRebuild: true,
        menus: [[], []],
        emptied: undefined,
        returned: {'Dev Containers': true, 'Other Containers': true},
        collapsed: {'Dev Containers': false, 'Other Containers': false},
        reloaded: {'Dev Containers': true, 'Other Containers': true},
      },
    );
    await closeWindow(name);
  });
});
