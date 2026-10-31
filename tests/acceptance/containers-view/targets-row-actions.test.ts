import {deepStrictEqual} from 'node:assert';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {
  closeWindow,
  connectedToContainer,
  devContainerFolder,
  devContainersOf,
  inWindow,
  reopenInContainer,
  runScopedName,
  variable,
  waitFor,
  windowNames,
} from '../windows/harness.ts';
import {
  answerDialog,
  dialogDetailLines,
  dialogOf,
  centreNotifications,
  notifications,
  toastDetails,
  rowContextMenu,
  rowMenuAction,
  statusItemText,
  waitForDialog,
} from '../windows/renderer.ts';
import {
  activations,
  clearEarlierRows,
  openFolderWindow,
  removeContainers,
  setUserSetting,
} from '../windows/folder-windows.ts';
import {
  chosen,
  docker,
  dockerWrapper,
  iconOf,
  iconReaches,
  idOf,
  made,
  rowsWhen,
  shown,
  stateOf,
  VIEW,
  viewed,
} from '../windows/dev-containers-view.ts';

/** The words of the Remove Container confirmation (F-0902 AC-1). */
const REMOVE_MESSAGE = 'Remove this container?';
const REMOVE_DETAIL =
  'This action is not reversible and deletes the container permanently.';

/** How soon after a change of Docker the row follows it, in milliseconds (F-0902 AC-5). */
const FOLLOW_MILLISECONDS = 5_000;

/** The `sh -c` script of a container whose process ignores the stop signal. */
const DEAF = 'trap "" TERM; sleep 600';

/** The toasts of window `name` in the order shown, once there are `count` of them. */
async function notified(
  name: string,
  count: number,
): Promise<Array<{message: string; buttons: string[]}>> {
  let shownToasts: Awaited<ReturnType<typeof toastDetails>> = [];
  await waitFor(
    `${String(count)} notifications in window ${name}`,
    async () => {
      shownToasts = await toastDetails(name);
      return shownToasts.length >= count;
    },
    30_000,
  );
  return shownToasts.map(({message, buttons}) => ({message, buttons}));
}

/** The ids `docker <listing>` prints, sorted: the containers, images or volumes the engine holds. */
async function idsOf(...listing: string[]): Promise<string[]> {
  return (await docker(...listing))
    .split('\n')
    .filter(line => line !== '')
    .sort();
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
    const windows = [activations('local'), windowNames().length];
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
        [activations('local'), windowNames().length],
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
        windows,
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

  it('F-0902 AC-3 (stop-from-connected): Stop Container from a window connected to another container shows the same dialog, and Cancel leaves the target running', async () => {
    const base = 'ra-stop-from';
    const folder = devContainerFolder('ra-stop-from-window', {
      name: 'Stop From',
    });
    const connected = await openFolderWindow(folder);
    try {
      await reopenInContainer(connected);
      const container = await made(base, ['sleep', '600']);
      await inWindow(connected, 'workbench.view.remote');
      await rowsWhen(connected, rows => rows.some(each => each.label === base));
      await rowMenuAction(connected, VIEW, base, 'Stop Container');
      const asked = await shown(connected);
      await answerDialog(connected, 'Cancel');
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
    } finally {
      await closeWindow(connected).catch(() => undefined);
      await removeContainers(folder);
    }
  });

  it('F-0902 AC-4 (dev-container-half): Stop Container from another window gives the window connected to the target core’s Cannot reconnect dialog and the disconnected status', async () => {
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

  it('F-0902 AC-24 (last-user): the Remove confirmation adds S373 for each volume and folder no other container uses, in mount order, not for one another container mounts and not for the vscode volume', async () => {
    const base = 'ra-last-user';
    const volume = runScopedName('ra-last-volume');
    const folder = path.join(variable('HARNESS_RUN_FOLDER'), 'ra-last-folder');
    mkdirSync(folder, {recursive: true});
    await docker('volume', 'create', 'vscode');
    const mounts = [
      '-v',
      `${volume}:/data`,
      '-v',
      'vscode:/vscode',
      '-v',
      `${folder}:/mnt`,
    ];
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

  it('F-0902 AC-25 (start-fails): Start Container on an exited row whose host port another running container publishes shows the error S170 with no buttons, and the row stays exited', async () => {
    const base = 'ra-start-fails';
    const probe = await made('ra-start-probe', ['sleep', '600'], {
      extra: ['-p', '127.0.0.1::80'],
    });
    const published = (await docker('port', probe, '80/tcp')).split(':').pop();
    await docker('rm', '-f', probe);
    const container = await made(base, ['true'], {
      extra: ['-p', `127.0.0.1:${String(published)}:80`],
    });
    await made('ra-start-holder', ['sleep', '600'], {
      extra: ['-p', `127.0.0.1:${String(published)}:80`],
    });
    await viewed(base);
    await iconReaches('local', base, 'vm');
    await chosen(base, 'Start Container');
    const toasts = await notified('local', 1);
    deepStrictEqual(
      [
        toasts,
        await dialogOf('local'),
        await stateOf(container),
        await iconOf('local', base),
      ],
      [
        [
          {
            message: `Error starting container: Command failed: docker start ${await idOf(container)}`,
            buttons: [],
          },
        ],
        undefined,
        'exited',
        'vm',
      ],
    );
  });

  it('F-0902 AC-36 (stop-fails): a Stop Container whose docker stop fails shows the error S171 naming the command with no buttons, and the container and its row stay running', async () => {
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
      const toasts = await notified('local', 1);
      deepStrictEqual(
        [toasts, await stateOf(container), await iconOf('local', base)],
        [
          [
            {
              message: `Error stopping container: Command failed: ${wrapper} stop ${await idOf(container)}`,
              buttons: [],
            },
          ],
          'running',
          'vm-running',
        ],
      );
    } finally {
      await setUserSetting('dev.containers.dockerPath', undefined);
    }
  });

  /** Clicks Remove Container on the row `label` and Remove on its dialog. */
  async function removed(label: string): Promise<void> {
    await chosen(label, 'Remove Container');
    await waitForDialog('local', 30_000);
    await answerDialog('local', 'Remove');
  }

  it('F-0902 AC-37 (remove-fails): a failed rm shows the error S168 and keeps the container and its row, exited if it was stopped first; a failed stop shows S171 then S168 and keeps it running; none has buttons', async () => {
    const failRm = dockerWrapper(
      'fail-rm',
      'if [ "$1" = rm ]; then exit 1; fi',
    );
    const failStop = dockerWrapper(
      'fail-stop-remove',
      'if [ "$1" = stop ]; then exit 1; fi',
    );
    /** What the window shows after a failed Remove of the row `label` of container `container`. */
    async function afterFailure(
      label: string,
      container: string,
      count: number,
    ): Promise<unknown> {
      const toasts = await notified('local', count);
      return {
        messages: toasts.map(toast => toast.message),
        buttons: toasts.map(toast => toast.buttons),
        state: await stateOf(container),
        icon: await iconOf('local', label),
      };
    }
    try {
      await setUserSetting('dev.containers.dockerPath', failRm);
      const exited = await made('ra-remove-exited-rm', ['true']);
      const stopped = await made('ra-remove-stopped-rm', ['sleep', '600']);
      await viewed('ra-remove-stopped-rm');
      const exitedId = await idOf(exited);
      const stoppedId = await idOf(stopped);
      await removed('ra-remove-exited-rm');
      const afterExited = await afterFailure('ra-remove-exited-rm', exited, 1);
      await inWindow('local', 'notifications.clearAll');
      await removed('ra-remove-stopped-rm');
      await waitFor(
        'the container to have been stopped first',
        async () => (await stateOf(stopped)) === 'exited',
        40_000,
      );
      const afterStopped = await afterFailure(
        'ra-remove-stopped-rm',
        stopped,
        1,
      );
      await inWindow('local', 'notifications.clearAll');
      await setUserSetting('dev.containers.dockerPath', failStop);
      const running = await made('ra-remove-fails-up', ['sleep', '600']);
      await rowsWhen('local', rows =>
        rows.some(each => each.label === 'ra-remove-fails-up'),
      );
      const runningId = await idOf(running);
      await removed('ra-remove-fails-up');
      const afterRunning = await afterFailure('ra-remove-fails-up', running, 2);
      deepStrictEqual(
        [afterExited, afterStopped, afterRunning],
        [
          {
            messages: [
              `Error removing container: Command failed: ${failRm} rm ${exitedId}`,
            ],
            buttons: [[]],
            state: 'exited',
            icon: 'vm',
          },
          {
            messages: [
              `Error removing container: Command failed: ${failRm} rm ${stoppedId}`,
            ],
            buttons: [[]],
            state: 'exited',
            icon: 'vm',
          },
          {
            messages: [
              `Error removing container: Command failed: ${failStop} stop ${runningId}`,
              `Error stopping container: Command failed: ${failStop} stop ${runningId}`,
            ],
            buttons: [[], []],
            state: 'running',
            icon: 'vm-running',
          },
        ],
      );
    } finally {
      await setUserSetting('dev.containers.dockerPath', undefined);
    }
  });

  it('F-0902 AC-51 (stale-remove): a Remove confirmed after another window removed the container shows the error S168 with no buttons and the stale row goes', async () => {
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
      let centre: Awaited<ReturnType<typeof centreNotifications>> = [];
      await waitFor(
        'the error in the centre of the first window',
        async () => {
          centre = await centreNotifications('local');
          return centre.length > 0;
        },
        30_000,
      );
      await iconReaches('local', base, undefined);
      deepStrictEqual(centre, [
        {
          message: `Error removing container: Command failed: docker rm ${removedId}`,
          buttons: [],
        },
      ]);
    } finally {
      await closeWindow(other).catch(() => undefined);
    }
  });

  it('F-0902 AC-56 (no-row): Start, Stop and Remove called with no row create, change and remove no container, image or volume, and show no dialog and no notification', async () => {
    await made('ra-none-exited', ['true']);
    await made('ra-none-running', ['sleep', '600']);
    await viewed('ra-none-running');
    /** The ids the engine holds of containers, images and volumes, and the state of the two containers. */
    async function held(): Promise<string[][]> {
      return [
        await idsOf('ps', '-a', '-q'),
        await idsOf('image', 'ls', '-q'),
        await idsOf('volume', 'ls', '-q'),
        [
          await stateOf(runScopedName('ra-none-exited')),
          await stateOf(runScopedName('ra-none-running')),
        ],
      ];
    }
    // Something else may still be removing what an earlier row left, so the engine is read until it holds still.
    let before = await held();
    for (let tries = 0; tries < 10; tries += 1) {
      await new Promise(resolve => setTimeout(resolve, 1_000));
      const again = await held();
      if (JSON.stringify(again) === JSON.stringify(before)) {
        break;
      }
      before = again;
    }
    for (const command of [
      'remote-containers.startContainer',
      'remote-containers.stopContainer',
      'remote-containers.removeContainer',
    ]) {
      await inWindow('local', command);
    }
    await new Promise(resolve => setTimeout(resolve, 3_000));
    deepStrictEqual(
      [await held(), await dialogOf('local'), await notifications('local')],
      [before, undefined, []],
    );
  });

  it('F-0902 AC-26 (dev-row-half): after a confirmed Stop, the exited menu of a configured dev container row is Start, Show Details, Inspect, Show Container Log, the two Open in Container items and Remove', async () => {
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

  it('F-0902 AC-14 (own-row-half): the window’s own row offers no Stop, Start or Remove, and Show Details, Inspect and Show Container Log', async () => {
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
