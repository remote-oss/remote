import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  closeWindow,
  connectedToContainer,
  devContainerFolder,
  devContainersOf,
  inWindow,
  reopenInContainer,
  runLabelArguments,
  runScopedName,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {
  answerDialog,
  dialogDetailLines,
  dialogKindOf,
  dialogOf,
  notificationCentre,
  notifications,
  rowContextMenu,
  rowDetails,
  rowMenuAction,
  statusItemText,
  waitForDialog,
} from '../windows/renderer.ts';
import {
  clearEarlierRows,
  openFolderWindow,
  removeContainers,
  setUserSetting,
} from '../windows/folder-windows.ts';
import {dockerWrapper, rowsWhen, VIEW} from '../windows/dev-containers-view.ts';

const execFileAsync = promisify(execFile);

/** The words of the Remove Container confirmation (F-0902 AC-1). */
const REMOVE_MESSAGE = 'Remove this container?';
const REMOVE_DETAIL =
  'This action is not reversible and deletes the container permanently.';

/** How soon after a change of Docker the row follows it, in milliseconds (F-0902 AC-5). */
const FOLLOW_MILLISECONDS = 5_000;

/** The `sh -c` script of a container whose process ignores the stop signal. */
const DEAF = 'trap "" TERM; sleep 600';

/** What `docker <argv>` printed, trimmed. */
async function docker(...argv: string[]): Promise<string> {
  const {stdout} = await execFileAsync('docker', argv);
  return stdout.trim();
}

/** `State.Status` of a container, or `gone` when Docker has none by that name or id. */
async function stateOf(container: string): Promise<string> {
  try {
    return await docker('inspect', '-f', '{{.State.Status}}', container);
  } catch {
    return 'gone';
  }
}

/** The full id of a container. */
function idOf(container: string): Promise<string> {
  return docker('inspect', '-f', '{{.Id}}', container);
}

/**
 * Creates a container of the run named `runScopedName(base)` that the view lists as a dev container by the folder name
 * `base`, with `command` run in it. `started` false only creates it. `extra` is added to `docker create` before the image.
 */
async function made(
  base: string,
  command: readonly string[],
  options: {started?: boolean; extra?: readonly string[]} = {},
): Promise<string> {
  const container = runScopedName(base);
  await docker(
    options.started === false ? 'create' : 'run',
    ...(options.started === false ? [] : ['-d']),
    '--name',
    container,
    ...runLabelArguments(),
    '--label',
    `devcontainer.local_folder=${path.join(variable('HARNESS_RUN_FOLDER'), base)}`,
    ...(options.extra ?? []),
    variable('HARNESS_DEVCONTAINER_IMAGE'),
    ...command,
  );
  return container;
}

/** Opens the Dev Containers view in the local window and waits for the row labelled `label`. */
async function viewed(label: string): Promise<void> {
  await inWindow('local', 'workbench.view.remote');
  await rowsWhen('local', rows => rows.some(each => each.label === label));
}

/** The icon of the row labelled `label` in window `name`, or none when the view lists no such row. */
async function iconOf(
  name: string,
  label: string,
): Promise<string | undefined> {
  try {
    return (await rowDetails(name, VIEW))?.find(each => each.label === label)
      ?.icon;
  } catch {
    return undefined;
  }
}

/** Waits until the row labelled `label` of window `name` has the icon `icon`, or none when `icon` is undefined. */
function iconReaches(
  name: string,
  label: string,
  icon: string | undefined,
  milliseconds = 30_000,
): Promise<void> {
  return waitFor(
    `the row ${label} to have the icon ${String(icon)}`,
    async () => (await iconOf(name, label)) === icon,
    milliseconds,
  );
}

/** What the open dialog of window `name` says. */
async function shown(name: string): Promise<{
  message: string;
  details: string;
  buttons: string[];
  kind: string | undefined;
}> {
  const dialog = await waitForDialog(name, 30_000);
  return {...dialog, kind: await dialogKindOf(name)};
}

/** Picks the context menu item `item` of the row `label` in the local window. */
function chosen(label: string, item: string): Promise<void> {
  return rowMenuAction('local', VIEW, label, item);
}

/** The notifications of window `name` once there are `count` of them. */
async function notified(name: string, count: number): Promise<string[]> {
  let texts: string[] = [];
  await waitFor(
    `${String(count)} notifications in window ${name}`,
    async () => {
      texts = await notifications(name);
      return texts.length >= count;
    },
    30_000,
  );
  return texts;
}

describe('the Dev Containers rows’ menus, and Start, Stop and Remove Container (card containers-102)', function () {
  this.timeout(600_000);

  beforeEach(async () => {
    await clearEarlierRows();
    await inWindow('local', 'notifications.clearAll');
  });

  it('F-0902 AC-1 (remove-exited): Remove Container on an exited row asks with S291 and S369, Cancel leaves the container, Remove deletes it and its row goes, with no progress', async () => {
    const base = 'ra-remove-exited';
    const container = await made(base, ['true']);
    await viewed(base);
    await chosen(base, 'Remove Container');
    const asked = await shown('local');
    await answerDialog('local', 'Cancel');
    const afterCancel = [await stateOf(container), await iconOf('local', base)];
    await chosen(base, 'Remove Container');
    await waitForDialog('local', 30_000);
    await answerDialog('local', 'Remove');
    await iconReaches('local', base, undefined);
    deepStrictEqual(
      [
        asked,
        afterCancel,
        await stateOf(container),
        await notifications('local'),
        await dialogOf('local'),
      ],
      [
        {
          message: REMOVE_MESSAGE,
          details: REMOVE_DETAIL,
          buttons: ['Cancel', 'Remove'],
          kind: 'warning',
        },
        ['exited', 'vm'],
        'gone',
        [],
        undefined,
      ],
    );
  });

  it('F-0902 AC-2 (remove-running): Remove Container on a running target that ignores the stop signal keeps the row and the container until the stop grace has passed, then both go', async () => {
    const base = 'ra-remove-running';
    const container = await made(base, ['sh', '-c', DEAF]);
    await viewed(base);
    await chosen(base, 'Remove Container');
    await waitForDialog('local', 30_000);
    await answerDialog('local', 'Remove');
    const began = Date.now();
    await new Promise(resolve => setTimeout(resolve, 5_000));
    const during = [
      await stateOf(container),
      await iconOf('local', base),
      await notifications('local'),
    ];
    await iconReaches('local', base, undefined, 40_000);
    const seconds = (Date.now() - began) / 1000;
    deepStrictEqual(
      [during, seconds >= 8 && seconds < 30, await stateOf(container)],
      [['running', 'vm-running', []], true, 'gone'],
    );
  });

  it('F-0902 AC-3 (stop-dialog): Stop Container on a running row shows only the detail Stop <label>? with Cancel and Stop Container, and Cancel leaves it running', async () => {
    const base = 'ra-stop-dialog';
    const container = await made(base, ['sleep', '600']);
    await viewed(base);
    await chosen(base, 'Stop Container');
    const asked = await shown('local');
    await answerDialog('local', 'Cancel');
    await new Promise(resolve => setTimeout(resolve, 2_000));
    deepStrictEqual(
      [asked, await stateOf(container)],
      [
        {
          message: '',
          details: `Stop ${base}?`,
          buttons: ['Cancel', 'Stop Container'],
          kind: 'warning',
        },
        'running',
      ],
    );
  });

  it('F-0902 AC-4 (stop-other-window): Stop Container from another window gives the window connected to the target core’s Cannot reconnect dialog and the disconnected status', async () => {
    const base = 'ra-stop-other';
    const folder = devContainerFolder(base, {name: 'Stop Other'});
    const connected = await openFolderWindow(folder);
    try {
      await reopenInContainer(connected);
      await viewed(base);
      await chosen(base, 'Stop Container');
      await waitForDialog('local', 30_000);
      await answerDialog('local', 'Stop Container');
      const recovery = await shown(connected);
      await answerDialog(connected, 'Cancel');
      deepStrictEqual(
        [
          recovery,
          await statusItemText(
            connected,
            'status.host',
            'Disconnected from Dev Container: Stop Other',
            30_000,
          ),
        ],
        [
          {
            message: '',
            details: 'Cannot reconnect. Please reload the window.',
            buttons: ['Cancel', 'Reload Window'],
            kind: 'error',
          },
          'Disconnected from Dev Container: Stop Other',
        ],
      );
    } finally {
      await closeWindow(connected).catch(() => undefined);
      await removeContainers(folder);
    }
  });

  it('F-0902 AC-5 (start-exited): Start Container on an exited row shows no dialog and no notice, starts the container, and the row is running within 5 s', async () => {
    const base = 'ra-start-exited';
    const container = await made(base, ['sleep', '600']);
    await docker('stop', '-t', '0', container);
    await viewed(base);
    await iconReaches('local', base, 'vm');
    await chosen(base, 'Start Container');
    const quiet = [await dialogOf('local'), await notifications('local')];
    await iconReaches('local', base, 'vm-running', FOLLOW_MILLISECONDS);
    deepStrictEqual(
      [quiet, await stateOf(container)],
      [[undefined, []], 'running'],
    );
  });

  it('F-0902 AC-24 (last-user): the Remove confirmation adds S373 for each volume and folder no other container uses, in mount order, and not for one another container mounts', async () => {
    const base = 'ra-last-user';
    const volume = runScopedName('ra-last-volume');
    const folder = path.join(variable('HARNESS_RUN_FOLDER'), 'ra-last-folder');
    mkdirSync(folder, {recursive: true});
    const mounts = ['-v', `${volume}:/data`, '-v', `${folder}:/mnt`];
    try {
      await made(base, ['sleep', '600'], {extra: mounts});
      await viewed(base);
      await chosen(base, 'Remove Container');
      await waitForDialog('local', 30_000);
      const alone = await dialogDetailLines('local');
      await answerDialog('local', 'Cancel');
      await made('ra-last-sharer', ['sleep', '600'], {
        extra: ['-v', `${volume}:/data`],
      });
      await chosen(base, 'Remove Container');
      await waitForDialog('local', 30_000);
      const shared = await dialogDetailLines('local');
      await answerDialog('local', 'Cancel');
      deepStrictEqual(
        [alone, shared],
        [
          [
            REMOVE_DETAIL,
            `This is the last container using '${volume}'.`,
            `This is the last container using '${folder}'.`,
          ],
          [REMOVE_DETAIL, `This is the last container using '${folder}'.`],
        ],
      );
    } finally {
      await clearEarlierRows();
      await docker('volume', 'rm', '-f', volume);
    }
  });

  it('F-0902 AC-25 (start-fails): Start Container on a row whose host port another running container publishes shows the error S170 with no buttons, and the row stays exited', async () => {
    const base = 'ra-start-fails';
    const holder = await made('ra-start-holder', ['sleep', '600'], {
      extra: ['-p', '127.0.0.1::80'],
    });
    const published = (await docker('port', holder, '80/tcp')).split(':').pop();
    const container = await made(base, ['sleep', '600'], {
      started: false,
      extra: ['-p', `127.0.0.1:${String(published)}:80`],
    });
    await viewed(base);
    await chosen(base, 'Start Container');
    const texts = await notified('local', 1);
    deepStrictEqual(
      [
        texts,
        await dialogOf('local'),
        await stateOf(container),
        await iconOf('local', base),
      ],
      [
        [
          `Error starting container: Command failed: docker start ${await idOf(container)}`,
        ],
        undefined,
        'created',
        'vm',
      ],
    );
  });

  it('F-0902 AC-36 (stop-fails): a Stop Container whose docker stop fails shows the error S171 naming the command, and the container and its row stay running', async () => {
    const base = 'ra-stop-fails';
    const wrapper = dockerWrapper(
      'fail-stop',
      'if [ "$1" = stop ]; then exit 1; fi',
    );
    await setUserSetting('dev.containers.dockerPath', wrapper);
    try {
      const container = await made(base, ['sleep', '600']);
      await viewed(base);
      await chosen(base, 'Stop Container');
      await waitForDialog('local', 30_000);
      await answerDialog('local', 'Stop Container');
      const texts = await notified('local', 1);
      deepStrictEqual(
        [texts, await stateOf(container), await iconOf('local', base)],
        [
          [
            `Error stopping container: Command failed: ${wrapper} stop ${await idOf(container)}`,
          ],
          'running',
          'vm-running',
        ],
      );
    } finally {
      await setUserSetting('dev.containers.dockerPath', undefined);
    }
  });

  it('F-0902 AC-37 (remove-fails): a Remove whose docker rm fails shows the error S168 and keeps the container; a running target whose stop fails shows S171 and S168 and keeps running', async () => {
    const base = 'ra-remove-fails';
    const wrapper = dockerWrapper(
      'fail-rm-stop',
      'if [ "$1" = rm ] || [ "$1" = stop ]; then exit 1; fi',
    );
    await setUserSetting('dev.containers.dockerPath', wrapper);
    try {
      const exited = await made(base, ['true']);
      const running = await made('ra-remove-fails-up', ['sleep', '600']);
      await viewed(base);
      await chosen(base, 'Remove Container');
      await waitForDialog('local', 30_000);
      await answerDialog('local', 'Remove');
      const first = await notified('local', 1);
      const exitedId = await idOf(exited);
      const runningId = await idOf(running);
      await chosen('ra-remove-fails-up', 'Remove Container');
      await waitForDialog('local', 30_000);
      await answerDialog('local', 'Remove');
      const second = (await notified('local', 3)).filter(
        text => !first.includes(text),
      );
      deepStrictEqual(
        [first, second.sort(), await stateOf(exited), await stateOf(running)],
        [
          [
            `Error removing container: Command failed: ${wrapper} rm ${exitedId}`,
          ],
          [
            `Error removing container: Command failed: ${wrapper} stop ${runningId}`,
            `Error stopping container: Command failed: ${wrapper} stop ${runningId}`,
          ],
          'exited',
          'running',
        ],
      );
    } finally {
      await setUserSetting('dev.containers.dockerPath', undefined);
    }
  });

  it('F-0902 AC-51 (stale-remove): a Remove confirmed after another window removed the container shows the error S168 and the stale row goes', async () => {
    const base = 'ra-stale';
    const container = await made(base, ['true']);
    const other = await openFolderWindow(devContainerFolder('ra-stale-window'));
    try {
      await viewed(base);
      await inWindow(other, 'workbench.view.remote');
      await rowsWhen(other, rows => rows.some(each => each.label === base));
      const removedId = await idOf(container);
      await chosen(base, 'Remove Container');
      await waitForDialog('local', 30_000);
      await rowMenuAction(other, VIEW, base, 'Remove Container');
      await waitForDialog(other, 30_000);
      await answerDialog(other, 'Remove');
      await waitFor(
        'the container to be gone',
        async () => (await stateOf(container)) === 'gone',
        30_000,
      );
      await answerDialog('local', 'Remove');
      // The window is not the one in front, so the editor keeps the notice in its centre instead of a toast.
      let texts: string[] = [];
      await waitFor(
        'the error in the centre of the first window',
        async () => {
          texts = await notificationCentre('local');
          return texts.length > 0;
        },
        30_000,
      );
      await iconReaches('local', base, undefined);
      deepStrictEqual(texts, [
        `Error removing container: Command failed: docker rm ${removedId}`,
      ]);
    } finally {
      await closeWindow(other).catch(() => undefined);
    }
  });

  it('F-0902 AC-56 (no-row): Start, Stop and Remove called with no row change no container and show no dialog and no notification', async () => {
    const exited = await made('ra-none-exited', ['true']);
    const running = await made('ra-none-running', ['sleep', '600']);
    await viewed('ra-none-running');
    const before = [await stateOf(exited), await stateOf(running)];
    for (const command of [
      'remote-containers.startContainer',
      'remote-containers.stopContainer',
      'remote-containers.removeContainer',
    ]) {
      await inWindow('local', command);
    }
    await new Promise(resolve => setTimeout(resolve, 3_000));
    deepStrictEqual(
      [
        before,
        [await stateOf(exited), await stateOf(running)],
        await dialogOf('local'),
        await notifications('local'),
      ],
      [['exited', 'running'], ['exited', 'running'], undefined, []],
    );
  });

  // Show Details, Inspect and Show Container Log are in the menu from containers-104, and Open in Container from containers-103.
  it.skip('F-0902 AC-26 (dev-row-half): after a confirmed Stop, the exited menu of a configured dev container row is Start, Show Details, Inspect, Show Container Log, the two Open in Container items and Remove', async () => {
    const base = 'ra-menu-dev';
    const folder = devContainerFolder(base, {name: 'Menu Dev'});
    const connected = await openFolderWindow(folder);
    try {
      await reopenInContainer(connected);
      await closeWindow(connected);
      await viewed(base);
      await chosen(base, 'Stop Container');
      await waitForDialog('local', 30_000);
      await answerDialog('local', 'Stop Container');
      const [container = ''] = await devContainersOf(folder);
      await waitFor(
        'the container to exit',
        async () => (await stateOf(container)) === 'exited',
        30_000,
      );
      await iconReaches('local', base, 'vm', FOLLOW_MILLISECONDS);
      deepStrictEqual(
        (await rowContextMenu('local', VIEW, base)).filter(
          label => label !== '',
        ),
        [
          'Start Container',
          'Show Details',
          'Inspect',
          'Show Container Log',
          'Open in Container in Current Window',
          'Open in Container in New Window',
          'Remove Container',
        ],
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it.skip('F-0902 AC-14 (own-row-half): the window’s own row offers no Stop, Start or Remove, and Show Details, Inspect and Show Container Log', async () => {
    const base = 'ra-menu-own';
    const folder = devContainerFolder(base, {name: 'Menu Own'});
    const connected = await openFolderWindow(folder);
    try {
      await reopenInContainer(connected);
      await connectedToContainer(connected);
      await inWindow(connected, 'workbench.view.remote');
      await rowsWhen(connected, rows => rows.some(each => each.label === base));
      const menu = await rowContextMenu(connected, VIEW, base);
      deepStrictEqual(
        [
          ['Start Container', 'Stop Container', 'Remove Container'].filter(
            item => menu.includes(item),
          ),
          ['Show Details', 'Inspect', 'Show Container Log'].filter(item =>
            menu.includes(item),
          ),
        ],
        [[], ['Show Details', 'Inspect', 'Show Container Log']],
      );
    } finally {
      await closeWindow(connected).catch(() => undefined);
      await removeContainers(folder);
    }
  });
});
