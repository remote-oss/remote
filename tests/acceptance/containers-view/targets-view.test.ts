import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {
  closeWindow,
  connectedToContainer,
  devContainerFolder,
  inWindow,
  reopenInContainer,
  runLabelArguments,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {
  type RowDetails,
  titleActions,
  welcomeLink,
  welcomeText,
} from '../windows/renderer.ts';
import {
  openFolderWindow,
  clearEarlierRows,
  setUserSetting,
} from '../windows/folder-windows.ts';
import {dockerWrapper, rowsWhen, VIEW} from '../windows/dev-containers-view.ts';

const execFileAsync = promisify(execFile);

/** The words of the welcome text when the window has a folder and no container exists (F-0901 3.3 #2, with the links of unregistered commands as plain words). */
const WELCOME_WITH_FOLDER =
  "Get started with containers by running one of the Dev Containers commands. You can reopen the current folder in a container, or open another folder in a container. Open Folder in Container If you're new to containers and want to try a sample, there are several to choose from.";

/** The words of the welcome text when the window has no folder and no container exists (F-0901 3.3 #3: without the reopen clause and the sample link). */
const WELCOME_WITHOUT_FOLDER =
  "Get started with containers by running one of the Dev Containers commands. You can open an existing folder in a container. Open Folder in Container If you're new to containers and want to try a sample, there are several to choose from.";

/** A program for `dev.containers.dockerPath` that lists no container and passes every other call on to docker. */
function noContainersDocker(): string {
  return dockerWrapper(
    'no-containers',
    'if [ "$#" = 4 ] && [ "$1" = ps ] && [ "$2" = -a ]; then exit 0; fi',
  );
}

/** The welcome text of the view in window `name`, once it shows, with its blocks on one line. */
async function welcomeWords(name: string): Promise<string | undefined> {
  let shown: string | undefined;
  await waitFor(
    `the welcome text in window ${name}`,
    async () => {
      try {
        shown = await welcomeText(name, VIEW);
      } catch {
        return false;
      }
      return shown !== undefined;
    },
    60_000,
  );
  return shown?.replace(/\s+/g, ' ').trim();
}

/** The labels of rows, in order. */
function labelsOf(rows: readonly RowDetails[]): string[] {
  return rows.map(each => each.label);
}

describe('the Dev Containers view of the Remote Explorer (card containers-30)', function () {
  this.timeout(600_000);

  beforeEach(clearEarlierRows);

  it('F-0906 AC-1, F-0901 AC-7 (gate-row-13): the view lists the dev container of a reopened folder under Dev Containers by the folder name, and a plain container under Other Containers by its image; the dev container window shows its own row with vm-active and Connected (gate-row-16, F-0901 AC-4)', async () => {
    const image = variable('HARNESS_DEVCONTAINER_IMAGE');
    const folder = devContainerFolder('view-one', {name: 'View One'});
    const name = await openFolderWindow(folder);
    await reopenInContainer(name);
    await execFileAsync('docker', [
      'run',
      '-d',
      ...runLabelArguments(),
      image,
      'sleep',
      '600',
    ]);
    await inWindow('local', 'workbench.view.remote');
    const fromLocal = labelsOf(
      await rowsWhen(
        'local',
        rows =>
          rows.some(each => each.label === image) &&
          rows.some(each => each.label === 'view-one'),
      ),
    );
    await inWindow(name, 'workbench.view.remote');
    const own = (
      await rowsWhen(name, rows => rows.some(each => each.label === 'view-one'))
    ).find(each => each.label === 'view-one');
    deepStrictEqual(
      {
        order: [
          fromLocal.indexOf(VIEW),
          fromLocal.indexOf('view-one'),
          fromLocal.indexOf('Other Containers'),
          fromLocal.lastIndexOf(image),
        ].every(
          (position, index, positions) =>
            position >= 0 &&
            (index === 0 || position > (positions[index - 1] ?? -1)),
        ),
        icon: own?.icon,
        connected: own?.ariaLabel.endsWith(' Connected'),
      },
      {order: true, icon: 'vm-active.svg', connected: true},
    );
    await closeWindow(name);
  });

  it('F-0901 AC-1 (gate-row-15): with no container and a folder open, the view shows the welcome text, and its reopen link starts Reopen in Container', async () => {
    const folder = devContainerFolder('view-empty', {name: 'View Empty'});
    await setUserSetting('dev.containers.dockerPath', noContainersDocker());
    try {
      const name = await openFolderWindow(folder);
      await inWindow(name, 'workbench.view.remote');
      const words = await welcomeWords(name);
      await waitFor(
        `the reopen link in window ${name}`,
        async () => {
          try {
            await welcomeLink(
              name,
              VIEW,
              'reopen the current folder in a container',
            );
            return true;
          } catch {
            return false;
          }
        },
        30_000,
      );
      await connectedToContainer(name);
      deepStrictEqual(words, WELCOME_WITH_FOLDER);
      await closeWindow(name);
    } finally {
      await setUserSetting('dev.containers.dockerPath', undefined);
    }
  });

  it('F-0901 AC-2 (gate-row-15b): with no container and no folder open, the view shows the welcome text without the reopen clause and the sample link, and no title action', async () => {
    await setUserSetting('dev.containers.dockerPath', noContainersDocker());
    try {
      await inWindow('local', 'workbench.view.remote');
      const words = await welcomeWords('local');
      await waitFor(
        'the title actions of the view to go',
        async () => (await titleActions('local', VIEW)).length === 0,
        10_000,
      );
      deepStrictEqual(
        [words, await titleActions('local', VIEW)],
        [WELCOME_WITHOUT_FOLDER, []],
      );
    } finally {
      await setUserSetting('dev.containers.dockerPath', undefined);
    }
  });
});
