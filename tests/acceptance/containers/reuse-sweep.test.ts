import {deepStrictEqual} from 'node:assert';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {
  closeWindow,
  connectedToContainer,
  devContainerFolder,
  devContainersOf,
  reopenInContainer,
  inWindow,
  reopenStarted,
  runLabelArguments,
  runScopedName,
  reloadWindow,
  terminalBuffer,
  terminalNames,
  waitFor,
  variable,
  windowState,
} from '../windows/harness.ts';
import {
  activations,
  openFolderWindow,
  removeContainers,
  setUserSetting,
} from '../windows/folder-windows.ts';
import {
  answerDialog,
  answerFolderDialog,
  dialogOf,
  notificationCentre,
  notifications,
  pressEscape,
  rowDetails,
  primaryButtonOf,
  statusItem,
  waitForDialog,
  waitForQuickPick,
  windowTitle,
} from '../windows/renderer.ts';
import {
  chosen,
  docker,
  idOf,
  stateOf,
  VIEW,
} from '../windows/dev-containers-view.ts';
import {
  connectedWindow,
  COUNTDOWN,
  eventually,
  noDaemonDocker,
} from './resolve-support.ts';

/** The string of the editor's table that the failed-setup dialog shows, and F-0410's three buttons, sorted. */
const S034 = 'An error occurred setting up the container.';
const RECOVERY_BUTTONS = [
  'Edit devcontainer.json Locally',
  'More Actions...',
  'Retry',
];

/** How long a connect that ends in a dialog takes. */
const DIALOG_MILLISECONDS = 180_000;

/** The `StartedAt` of a container. */
function startedAtOf(container: string): Promise<string> {
  return docker('inspect', '-f', '{{.State.StartedAt}}', container);
}

/**
 * Makes, with Docker itself, a container of the run that carries the folder and configuration labels of `folder`, and
 * gives its name. It is left running, or stopped when `running` is false.
 */
async function labelled(
  folder: string,
  base: string,
  running: boolean,
): Promise<string> {
  const container = runScopedName(base);
  await docker(
    'run',
    '-d',
    '--name',
    container,
    ...runLabelArguments(),
    '--label',
    `devcontainer.local_folder=${folder}`,
    '--label',
    `devcontainer.config_file=${path.join(folder, '.devcontainer', 'devcontainer.json')}`,
    '--volume',
    `${folder}:/workspaces/${path.basename(folder)}`,
    variable('HARNESS_DEVCONTAINER_IMAGE'),
    'sleep',
    '3600',
  );
  if (!running) {
    await docker('stop', '--time', '1', container);
  }
  return container;
}

/** The indicator of window `name`, once it reads the disconnected state. */
function disconnectedIndicator(name: string): Promise<string> {
  return eventually(
    'the Disconnected indicator',
    async () => {
      const {text} = await statusItem(name, 'status.host');
      return text.startsWith('Disconnected from Dev Container')
        ? text
        : undefined;
    },
    60_000,
  );
}

/** Answers the dialog of window `name` with More Actions..., closes the quick pick it opens with Escape, and waits for the window to settle. */
async function settledByEscape(name: string): Promise<string> {
  await answerDialog(name, 'More Actions...');
  await waitForQuickPick(name, 30_000);
  await pressEscape(name);
  return disconnectedIndicator(name);
}

/** Unpauses `container`, whatever its state. */
async function unpaused(container: string): Promise<void> {
  await docker('unpause', container).catch(() => undefined);
}

/** The three texts F-0409 BR-7 forbids: the state of a container is never told to the user in these words. */
const STALE_TEXTS = [
  'Container is no longer running.',
  'Container is paused.',
  'Container no longer exists.',
];

/** The states of the folder's container that the triggers are run in. */
type ContainerState = 'exited' | 'paused' | 'removed';

/** Every text in window `name`, and in the local window's Dev Containers view, that the extension could have put there. */
async function shownTexts(name: string): Promise<string[]> {
  const dialog = await dialogOf(name).catch(() => undefined);
  const rows = (await rowDetails('local', VIEW).catch(() => undefined)) ?? [];
  return [
    dialog?.message ?? '',
    dialog?.details ?? '',
    ...(await notifications(name).catch(() => [])),
    ...(await notificationCentre(name).catch(() => [])),
    ...rows.flatMap(entry => [entry.label, entry.description, entry.ariaLabel]),
    ...(await terminalNames(name).catch(() => [])),
    await terminalBuffer(name).catch(() => ''),
  ];
}

/** Puts the container of `folder` in `state`. */
async function putIn(folder: string, state: ContainerState): Promise<void> {
  const [container = ''] = await devContainersOf(folder);
  if (state === 'exited') {
    await docker('stop', '--time', '1', container);
  } else if (state === 'paused') {
    await docker('pause', container);
  } else {
    await docker('rm', '--force', container);
  }
}

/** Waits until window `name` shows a dialog or has a working connection to a container. */
async function settledAfter(name: string): Promise<void> {
  await eventually(
    'a dialog or the connection',
    async () => {
      if ((await dialogOf(name)) !== undefined) {
        return true;
      }
      try {
        await inWindow(name, 'acceptance.agent.statFolder');
        return (await windowState(name)).remoteName === 'dev-container'
          ? true
          : undefined;
      } catch {
        return undefined;
      }
    },
    240_000,
  );
  await new Promise(resolve => setTimeout(resolve, 3000));
}

/** Closes the dialog of window `name`, if one is open. */
async function dismissed(name: string): Promise<void> {
  if ((await dialogOf(name).catch(() => undefined)) !== undefined) {
    await pressEscape(name);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

/**
 * Runs each trigger the release builds against a container in `state`, and gives the triggers it ran with the texts
 * (trigger, text) that said what the container's state is.
 */
async function triggersIn(
  state: ContainerState,
): Promise<{triggers: string[]; found: string[]}> {
  const base = `c70-trig-${state}`;
  const triggers: string[] = [];
  const found: string[] = [];
  async function scanned(trigger: string, name: string): Promise<void> {
    triggers.push(trigger);
    for (const text of await shownTexts(name)) {
      if (STALE_TEXTS.some(stale => text.includes(stale))) {
        found.push(`${trigger}: ${text}`);
      }
    }
  }
  const {name, folder} = await connectedWindow(base);
  try {
    await inWindow('local', 'workbench.view.remote');
    await putIn(folder, state);
    // The row is still the one the view drew before the container changed: the action is a stale Start or Stop.
    await chosen(
      base,
      state === 'exited' ? 'Start Container' : 'Stop Container',
    ).catch(() => undefined);
    await new Promise(resolve => setTimeout(resolve, 2000));
    await scanned('row action', 'local');
    await dismissed('local');
    await inWindow('local', 'remote-containers.explorerTargetsRefresh');
    await new Promise(resolve => setTimeout(resolve, 3000));
    await scanned('fresh discovery', name);
    await inWindow(name, 'remote-containers.showContainerLog').catch(
      () => undefined,
    );
    await new Promise(resolve => setTimeout(resolve, 2000));
    await scanned('show container log', name);
    await reloadWindow(name);
    await settledAfter(name);
    await scanned('reload', name);
    await dismissed(name);
    await closeWindow(name);
    for (const [trigger, command] of [
      ['reopen', 'remote-containers.reopenInContainer'],
      ['rebuild', 'remote-containers.rebuildAndReopenInContainer'],
    ] as const) {
      const local = await openFolderWindow(folder);
      await putIn(folder, state).catch(() => undefined);
      const running = inWindow(local, command);
      running.catch(() => undefined);
      await settledAfter(local);
      await scanned(trigger, local);
      await dismissed(local);
      await closeWindow(local);
    }
  } finally {
    await unpausedAll(folder);
    await removeContainers(folder);
  }
  return {triggers, found};
}

/** Unpauses every container of `folder`. */
async function unpausedAll(folder: string): Promise<void> {
  for (const container of await devContainersOf(folder)) {
    await unpaused(container);
  }
}

describe('F-0409 discovery and reuse, the remaining rows (card coverage-70)', function () {
  this.timeout(900_000);

  it('F-0409 AC-24 (c70-duplicates): of two containers with the same labels the newer one is started and used, both when both are exited and when the older one runs; the other is left as it was', async () => {
    const outcomes: unknown[] = [];
    for (const olderRunning of [false, true]) {
      const base = `c70-dup-${olderRunning ? 'running' : 'exited'}`;
      const folder = devContainerFolder(base, {name: 'Duplicates'});
      try {
        const older = await labelled(folder, `${base}-older`, olderRunning);
        await new Promise(resolve => setTimeout(resolve, 1500));
        const newer = await labelled(folder, `${base}-newer`, false);
        const olderStarted = await startedAtOf(older);
        const name = await openFolderWindow(folder);
        await reopenInContainer(name);
        outcomes.push({
          newer: await stateOf(newer),
          older: await stateOf(older),
          olderUntouched: (await startedAtOf(older)) === olderStarted,
          title: await windowTitle(name),
        });
        await closeWindow(name);
      } finally {
        await removeContainers(folder);
      }
    }
    deepStrictEqual(outcomes, [
      {
        newer: 'running',
        older: 'exited',
        olderUntouched: true,
        title: '[c70-dup-exited [Dev Container: Duplicates]]',
      },
      {
        newer: 'running',
        older: 'running',
        olderUntouched: true,
        title: '[c70-dup-running [Dev Container: Duplicates]]',
      },
    ]);
  });

  it('F-0409 AC-39 (c70-no-docker): with Docker unreachable and the folder’s container exited, connecting shows F-0202’s dialog with Show Log primary, creates no container and leaves the existing one exited', async () => {
    const folder = devContainerFolder('c70-no-docker', {name: 'No Docker'});
    try {
      const container = await labelled(folder, 'c70-no-docker', false);
      await setUserSetting('dev.containers.dockerPath', noDaemonDocker());
      try {
        const name = await openFolderWindow(folder);
        // The command waits on its dialog, so the dialog is answered before the command is awaited.
        const running = inWindow(name, 'remote-containers.reopenInContainer');
        const dialog = await waitForDialog(name, DIALOG_MILLISECONDS);
        const primary = await primaryButtonOf(name);
        await answerDialog(name, 'Cancel');
        await running;
        deepStrictEqual(
          {
            message: dialog.message,
            details: dialog.details,
            buttons: [...dialog.buttons].sort(),
            primary,
            containers: await devContainersOf(folder),
            state: await stateOf(container),
          },
          {
            message: 'Docker returned an error.',
            details: 'Make sure the Docker daemon is running.',
            buttons: ['Cancel', 'Show Log'],
            primary: 'Show Log',
            containers: [(await idOf(container)).slice(0, 12)],
            state: 'exited',
          },
        );
        await closeWindow(name);
      } finally {
        await setUserSetting('dev.containers.dockerPath', undefined);
      }
    } finally {
      await removeContainers(folder);
    }
  });
  it.skip('F-0409 AC-36 (c70-paused-settles): a paused container after a Reopen in a profile that connected the folder shows F-0410’s dialog under the named title and Opening Remote..., and More Actions... then Escape leaves Disconnected from Dev Container: <name>, the title unchanged and the container paused', async () => {
    const folder = devContainerFolder('c70-paused', {name: 'Paused'});
    let container: string | undefined;
    try {
      const first = await openFolderWindow(folder);
      await reopenInContainer(first);
      [container] = await devContainersOf(folder);
      await closeWindow(first);
      await docker('pause', container ?? '');
      const name = await openFolderWindow(folder);
      await reopenStarted(name);
      const dialog = await waitForDialog(name, DIALOG_MILLISECONDS);
      const shown = {
        dialog: [dialog.message, dialog.details, [...dialog.buttons].sort()],
        title: await windowTitle(name),
        indicator: (await statusItem(name, 'status.host')).text,
      };
      const settled = await settledByEscape(name);
      deepStrictEqual(
        {
          shown,
          settled,
          title: await windowTitle(name),
          state: await stateOf(container ?? ''),
        },
        {
          shown: {
            dialog: ['', S034, RECOVERY_BUTTONS],
            title: '[c70-paused [Dev Container: Paused]]',
            indicator: 'Opening Remote...',
          },
          settled: 'Disconnected from Dev Container: Paused',
          title: '[c70-paused [Dev Container: Paused]]',
          state: 'paused',
        },
      );
      await closeWindow(name);
    } finally {
      await unpaused(container ?? '');
      await removeContainers(folder);
    }
  });

  it.skip('F-0409 AC-11 (c70-countdown-reload): Reload Window on the countdown dialog of a paused container shows F-0410’s dialog under the same title, and More Actions... then Escape leaves Disconnected from Dev Container: <name> with the container still paused', async () => {
    const {name, containerId, folder} = await connectedWindow('c70-countdown');
    try {
      await docker('pause', containerId);
      const countdown = await eventually(
        'the countdown dialog',
        async () => {
          const shown = await dialogOf(name);
          return shown !== undefined && COUNTDOWN.test(shown.details)
            ? shown
            : undefined;
        },
        120_000,
      );
      await answerDialog(name, 'Reload Window');
      const dialog = await waitForDialog(name, DIALOG_MILLISECONDS);
      const shown = {
        countdown: COUNTDOWN.test(countdown.details),
        dialog: [dialog.message, dialog.details, [...dialog.buttons].sort()],
        title: await windowTitle(name),
      };
      const settled = await settledByEscape(name);
      deepStrictEqual(
        {shown, settled, state: await stateOf(containerId)},
        {
          shown: {
            countdown: true,
            dialog: ['', S034, RECOVERY_BUTTONS],
            title: '[c70-countdown [Dev Container: c70-countdown]]',
          },
          settled: 'Disconnected from Dev Container: c70-countdown',
          state: 'paused',
        },
      );
      await closeWindow(name);
    } finally {
      await unpaused(containerId);
      await removeContainers(folder);
    }
  });

  it('F-0409 AC-13 (c70-paused-unknown): a paused container of a folder this profile never connected gives the same dialog, and More Actions... then Escape leaves the window with the unnamed title and indicator, no Dev Containers terminal and no notification', async () => {
    const folder = devContainerFolder('c70-unknown', {name: 'Unknown'});
    try {
      const container = await labelled(folder, 'c70-unknown', true);
      await docker('pause', container);
      const name = await openFolderWindow(folder);
      await reopenStarted(name);
      const dialog = await waitForDialog(name, DIALOG_MILLISECONDS);
      const settled = await settledByEscape(name);
      deepStrictEqual(
        {
          dialog: [dialog.message, dialog.details, [...dialog.buttons].sort()],
          settled,
          title: await windowTitle(name),
          terminals: await terminalNames(name),
          notifications: await notifications(name),
        },
        {
          dialog: ['', S034, RECOVERY_BUTTONS],
          settled: 'Disconnected from Dev Container',
          title: '[c70-unknown [Dev Container]]',
          terminals: [],
          notifications: [],
        },
      );
      await closeWindow(name);
    } finally {
      await unpaused(runScopedName('c70-unknown'));
      await removeContainers(folder);
    }
  });

  it('F-0409 AC-38 (c70-open-twice): an empty window that runs Open Folder in Container on the folder of a connected window stays empty, and the container is not stopped, restarted or replaced', async () => {
    const {name, containerId, folder} = await connectedWindow('c70-twice');
    try {
      await connectedToContainer(name);
      const before = {
        id: await idOf(containerId),
        started: await startedAtOf(containerId),
      };
      const running = inWindow('local', 'remote-containers.openFolder');
      running.catch(() => undefined);
      await answerFolderDialog('local', folder);
      await new Promise(resolve => setTimeout(resolve, 10_000));
      deepStrictEqual(
        {
          emptyFolders: (await windowState('local')).folders,
          remoteName: (await windowState(name)).remoteName,
          containers: await devContainersOf(folder),
          id: await idOf(containerId),
          started: await startedAtOf(containerId),
          state: await stateOf(containerId),
        },
        {
          emptyFolders: [],
          remoteName: 'dev-container',
          containers: [before.id.slice(0, 12)],
          id: before.id,
          started: before.started,
          state: 'running',
        },
      );
      await closeWindow(name);
    } finally {
      await removeContainers(folder);
    }
  });
  it('F-0409 AC-17 (c70-subfolder): a sub-folder opened from a window connected to its parent folder uses the parent’s container and opens at the sub-folder’s path inside it', async () => {
    const {name, containerId, folder} = await connectedWindow('c70-parent');
    mkdirSync(path.join(folder, 'inner'), {recursive: true});
    try {
      const [parentUri = ''] = (await windowState(name)).folders;
      const before = activations('inner');
      await inWindow(name, 'acceptance.agent.openWindow', `${parentUri}/inner`);
      await waitFor(
        'the window of the sub-folder to activate',
        () => activations('inner') > before,
        120_000,
      );
      await connectedToContainer('inner');
      const opened = await windowState('inner');
      deepStrictEqual(
        {
          remoteName: opened.remoteName,
          folders: opened.folders.map(
            entry => new URL(decodeURIComponent(entry)).pathname,
          ),
          containers: await devContainersOf(folder),
          ofSubFolder: await devContainersOf(path.join(folder, 'inner')),
          state: await stateOf(containerId),
        },
        {
          remoteName: 'dev-container',
          folders: ['/workspaces/c70-parent/inner'],
          containers: [(await idOf(containerId)).slice(0, 12)],
          ofSubFolder: [],
          state: 'running',
        },
      );
      await closeWindow('inner');
      await closeWindow(name);
    } finally {
      await removeContainers(folder);
    }
  });
  it('F-0409 AC-14 (c70-no-state-text): fresh discovery, Show Container Log, a reload, Reopen and Rebuild and Reopen, each against an exited, a paused and a removed container, show none of the three container-state texts in a dialog, a notification, a view row, a row’s accessible label or a terminal', async () => {
    const outcomes: Record<string, unknown> = {};
    for (const state of ['exited', 'paused', 'removed'] as const) {
      outcomes[state] = await triggersIn(state);
    }
    const triggers = [
      'row action',
      'fresh discovery',
      'show container log',
      'reload',
      'reopen',
      'rebuild',
    ];
    deepStrictEqual(outcomes, {
      exited: {triggers, found: []},
      paused: {triggers, found: []},
      removed: {triggers, found: []},
    });
  });
});
