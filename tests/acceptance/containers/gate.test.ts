import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {readdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  closeWindow,
  commandsOf,
  devContainerFolder,
  devContainersOf,
  dockerVolumes,
  extensionPresent,
  inWindow,
  reopenInContainer,
  reopenStarted,
  startInWindow,
  variable,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {
  answerDialog,
  answerNotification,
  dialogOf,
  notificationButtons,
  notificationCentre,
  notifications,
  primaryButtonOf,
  statusItem,
  waitForDialog,
  waitForQuickPick,
  welcomeText,
  windowTitle,
} from '../windows/renderer.ts';
import {VIEW} from '../windows/dev-containers-view.ts';
import {folderWrapper, recordedCalls} from '../windows/folder-wrapper.ts';
import {
  activations,
  openFolderWindow,
  removeContainers,
  setUserSetting,
} from '../windows/folder-windows.ts';

const execFileAsync = promisify(execFile);

/** What `/tmp/created` holds in container `containerId`, written by the configuration's postCreateCommand. */
async function markerOf(containerId: string): Promise<string> {
  const {stdout} = await execFileAsync('docker', [
    'exec',
    containerId,
    'cat',
    '/tmp/created',
  ]);
  return stdout.trim();
}

/** The ids of every container the engine has, running or not. */
async function containerIds(): Promise<string[]> {
  const {stdout} = await execFileAsync('docker', ['ps', '--all', '--quiet']);
  return stdout.split('\n').filter(line => line !== '');
}

/** The text the pre-reload progress shows once its link is rendered (S087). */
const PRE_RELOAD_TOAST = 'Reading Dev Container Configuration (show log)';

describe('Dev Containers release 1 gate rows (card containers-09)', function () {
  this.timeout(600_000);

  it('F-0201 AC-2, F-0401 AC-13 (gate-row-8): a bogus dockerPath shows the pre-flight dialog before any reload, twice, and changes nothing', async () => {
    const bogus = path.join(variable('HARNESS_RUN_FOLDER'), 'no-such-docker');
    const folder = devContainerFolder('gate-docker', {name: 'Gate Eight'});
    await setUserSetting('dev.containers.dockerPath', bogus);
    try {
      const name = await openFolderWindow(folder);
      const volumes = await dockerVolumes();
      const activated = activations(name);
      const shown = [];
      for (let attempt = 0; attempt < 2; attempt += 1) {
        // The command waits on its dialog, so it's answered before the command is awaited.
        const running = inWindow(name, 'remote-containers.reopenInContainer');
        const dialog = await waitForDialog(name);
        shown.push(dialog);
        await answerDialog(name, 'Cancel');
        await running;
      }
      console.log(
        `containers-09 row 8: the dialog's buttons in DOM order: ${JSON.stringify(shown[0]?.buttons)}`,
      );
      const expectedDialog = [
        'Docker version 17.12.0 or later required.',
        `Command not found: '${bogus}'. Check the license for details.`,
        ['Cancel', 'Install', 'License'],
      ];
      deepStrictEqual(
        {
          dialogs: shown.map(dialog => [
            dialog.message,
            dialog.details,
            [...dialog.buttons].sort(),
          ]),
          activated: activations(name),
          remoteName: (await windowState(name)).remoteName,
          containers: await devContainersOf(folder),
          volumes: await dockerVolumes(),
        },
        {
          dialogs: [expectedDialog, expectedDialog],
          activated,
          remoteName: null,
          containers: [],
          volumes,
        },
      );
      await closeWindow(name);
    } finally {
      await setUserSetting('dev.containers.dockerPath', undefined);
    }
  });

  it('F-0401 AC-3, AC-15, F-0504 AC-1 (gate-row-1): Reopen in Container on an image configuration connects, and the title and indicator name the container; with the other Dev Containers installed but disabled, ours works and warns of nothing (F-0101 AC-18)', async () => {
    // The other Dev Containers is installed in this launch's extensions folder, and disabled, so the API doesn't see it.
    const otherInstalled = readdirSync(
      variable('HARNESS_EXTENSIONS_FOLDER'),
    ).some(entry => entry.startsWith('ms-vscode-remote.remote-containers'));
    const otherEnabled = await extensionPresent(
      'local',
      'ms-vscode-remote.remote-containers',
    );
    const folder = devContainerFolder('gate-image', {name: 'Gate One'});
    const name = await openFolderWindow(folder);
    await reopenInContainer(name);
    const state = await windowState(name);
    const title = await windowTitle(name);
    const indicator = await statusItem(name, 'status.host');
    await new Promise(resolve => setTimeout(resolve, 10_000));
    const centre = await notificationCentre(name);
    await inWindow(name, 'acceptance.agent.writeFile', 'gate-probe', 'x');
    const containers = await devContainersOf(folder);
    const containerId = containers[0] ?? '';
    const {stdout: probe} = await execFileAsync('docker', [
      'exec',
      containerId,
      'cat',
      '/workspaces/gate-image/gate-probe',
    ]);
    const {stdout: labels} = await execFileAsync('docker', [
      'inspect',
      '-f',
      '{{index .Config.Labels "devcontainer.local_folder"}}|{{index .Config.Labels "devcontainer.config_file"}}',
      containerId,
    ]);
    const registered = await commandsOf(name, 'remote-containers.');
    deepStrictEqual(
      {
        otherInstalled,
        otherEnabled,
        remoteName: state.remoteName,
        folders: state.folders.map(folderUri => {
          const decoded = decodeURIComponent(folderUri);
          return (
            decoded.startsWith('vscode-remote://dev-container+') &&
            decoded.endsWith('/workspaces/gate-image')
          );
        }),
        title,
        indicator,
        centre,
        containerCount: containers.length,
        probe,
        labels: labels.trim(),
        reopenRegistered: registered.includes(
          'remote-containers.reopenInContainer',
        ),
      },
      {
        otherInstalled: true,
        otherEnabled: false,
        remoteName: 'dev-container',
        folders: [true],
        title: '[gate-image [Dev Container: Gate One]]',
        indicator: {
          text: 'Dev Container: Gate One',
          ariaLabel: 'remote  Dev Container: Gate One',
          hover: 'Editing on Dev Container: Gate One',
        },
        centre: [],
        containerCount: 1,
        probe: 'x',
        labels: `${folder}|${path.join(folder, '.devcontainer', 'devcontainer.json')}`,
        reopenRegistered: true,
      },
    );
    await closeWindow(name);
  });

  it('F-0412 AC-11 (gate-row-7): a Dockerfile that fails to build on Reopen shows F-0410’s dialog with Retry, Edit and More Actions..., and makes no container', async () => {
    const folder = devContainerFolder('gate-build', {
      name: 'Gate Seven',
      image: undefined,
      build: {dockerfile: 'Dockerfile'},
    });
    writeFileSync(
      path.join(folder, '.devcontainer', 'Dockerfile'),
      `FROM ${variable('HARNESS_DEVCONTAINER_IMAGE')}\nRUN false\n`,
    );
    const name = await openFolderWindow(folder);
    try {
      await reopenStarted(name);
      const dialog = await waitForDialog(name, 300_000);
      const primary = await primaryButtonOf(name);
      const title = await windowTitle(name);
      const indicator = (await statusItem(name, 'status.host')).text;
      const containers = await devContainersOf(folder);
      await answerDialog(name, 'More Actions...');
      const pick = await waitForQuickPick(name, 30_000);
      deepStrictEqual(
        {
          dialog: [dialog.message, dialog.details, [...dialog.buttons].sort()],
          primary,
          title,
          indicator,
          containers,
          pick,
        },
        {
          dialog: [
            '',
            'An error occurred setting up the container.',
            ['Edit devcontainer.json Locally', 'More Actions...', 'Retry'],
          ],
          primary: 'Retry',
          title: '[gate-build]',
          indicator: 'Opening Remote...',
          containers: [],
          pick: {
            placeholder: 'Pick an action to help resolve the problem.',
            items: [
              'Reload Window',
              'Edit devcontainer.json Locally',
              'Open Recent...',
              'Open Documentation',
            ],
          },
        },
      );
    } finally {
      await closeWindow(name);
      await removeContainers(folder);
    }
  });

  it('ruling (c) (P1), containers-24: with a Docker that answers after a second, the Reading Dev Container Configuration toast is on screen before the window reloads, and then it connects', async () => {
    const wrapper = path.join(variable('HARNESS_RUN_FOLDER'), 'slow-docker');
    writeFileSync(wrapper, '#!/bin/sh\nsleep 1\nexec docker "$@"\n', {
      mode: 0o755,
    });
    const folder = devContainerFolder('gate-slow', {name: 'Gate Slow'});
    await setUserSetting('dev.containers.dockerPath', wrapper);
    try {
      const name = await openFolderWindow(folder);
      await Promise.all([
        reopenInContainer(name),
        waitFor(
          `the toast ${PRE_RELOAD_TOAST} before the reload`,
          async () => {
            try {
              return (await notifications(name)).includes(PRE_RELOAD_TOAST);
            } catch {
              return false;
            }
          },
          30_000,
        ),
      ]);
      deepStrictEqual(
        {
          remoteName: (await windowState(name)).remoteName,
          containers: (await devContainersOf(folder)).length,
        },
        {remoteName: 'dev-container', containers: 1},
      );
      await closeWindow(name);
    } finally {
      await setUserSetting('dev.containers.dockerPath', undefined);
    }
  });

  it('F-0408 AC-7 (c114-cancel): Cancel on the Reading Dev Container Configuration toast, shown with a primary Cancel, removes it, and the window does not reload, no container is made and no other notification or dialog shows', async () => {
    const wrapper = path.join(variable('HARNESS_RUN_FOLDER'), 'slow-docker-8');
    writeFileSync(wrapper, '#!/bin/sh\nsleep 8\nexec docker "$@"\n', {
      mode: 0o755,
    });
    const folder = devContainerFolder('c114-cancel', {name: 'Cancel Reading'});
    await setUserSetting('dev.containers.dockerPath', wrapper);
    try {
      const name = await openFolderWindow(folder);
      await new Promise(resolve => setTimeout(resolve, 3000));
      await inWindow(name, 'notifications.clearAll');
      const running = inWindow(name, 'remote-containers.reopenInContainer');
      running.catch(() => undefined);
      await waitFor(
        `the toast ${PRE_RELOAD_TOAST}`,
        async () => (await notifications(name)).includes(PRE_RELOAD_TOAST),
        30_000,
      );
      const buttons = await notificationButtons(name, PRE_RELOAD_TOAST);
      await answerNotification(name, PRE_RELOAD_TOAST, 'Cancel');
      await running;
      await new Promise(resolve => setTimeout(resolve, 12_000));
      deepStrictEqual(
        {
          buttons,
          toasts: await notifications(name),
          centre: await notificationCentre(name),
          dialog: await dialogOf(name),
          remoteName: (await windowState(name)).remoteName,
          containers: await devContainersOf(folder),
        },
        {
          buttons: ['Cancel'],
          toasts: [],
          centre: [],
          dialog: undefined,
          remoteName: null,
          containers: [],
        },
      );
      await closeWindow(name);
    } finally {
      await setUserSetting('dev.containers.dockerPath', undefined);
    }
  });

  it('ruling (c) (P2), containers-24: with the plain docker, Reopen in Container connects, and what shows before the reload is not asserted', async () => {
    const folder = devContainerFolder('gate-plain', {name: 'Gate Plain'});
    const name = await openFolderWindow(folder);
    await reopenInContainer(name);
    deepStrictEqual(
      {
        remoteName: (await windowState(name)).remoteName,
        containers: (await devContainersOf(folder)).length,
      },
      {remoteName: 'dev-container', containers: 1},
    );
    await closeWindow(name);
  });

  it('F-0405 AC-4, AC-5, AC-6 (gate-row-5): Rebuild Container in a dev container window reloads the same window onto a new container, whose postCreateCommand ran again, with no confirmation and no notice', async () => {
    const folder = devContainerFolder('gate-rebuild', {
      name: 'Gate Rebuild',
      postCreateCommand: 'date +%s%N > /tmp/created',
    });
    const name = await openFolderWindow(folder);
    await reopenInContainer(name);
    const [first = ''] = await devContainersOf(folder);
    const before = await markerOf(first);
    await reopenInContainer(
      name,
      300_000,
      'remote-containers.rebuildContainer',
    );
    await new Promise(resolve => setTimeout(resolve, 10_000));
    const containers = await devContainersOf(folder);
    const [second = ''] = containers;
    const remaining = await containerIds();
    const after = await markerOf(second);
    const centre = await notificationCentre(name);
    deepStrictEqual(
      {
        containerCount: containers.length,
        replaced: second !== first,
        oldRemoved: !remaining.some(remainingId =>
          first.startsWith(remainingId),
        ),
        markerRewritten: after !== before && after !== '',
        remoteName: (await windowState(name)).remoteName,
        centre,
      },
      {
        containerCount: 1,
        replaced: true,
        oldRemoved: true,
        markerRewritten: true,
        remoteName: 'dev-container',
        centre: [],
      },
    );
    await closeWindow(name);
  });

  it('F-0405 AC-8 (gate-row-5b): Rebuild Without Cache and Reopen in Container in a local window opens the folder in a new container', async () => {
    const folder = path.join(variable('HARNESS_RUN_FOLDER'), 'gate-rebuild');
    const [second = ''] = await devContainersOf(folder);
    const before = await markerOf(second);
    const name = await openFolderWindow(folder);
    await reopenInContainer(
      name,
      300_000,
      'remote-containers.rebuildNoCacheAndReopenInContainer',
    );
    const containers = await devContainersOf(folder);
    const [third = ''] = containers;
    const after = await markerOf(third);
    deepStrictEqual(
      {
        remoteName: (await windowState(name)).remoteName,
        containerCount: containers.length,
        replaced: third !== second,
        markerRewritten: after !== before && after !== '',
      },
      {
        remoteName: 'dev-container',
        containerCount: 1,
        replaced: true,
        markerRewritten: true,
      },
    );
    await closeWindow(name);
  });

  it('F-0201 AC-37 (t37): a relative dockerPath, with ./ or without, is the folder’s own file: the wrapper runs the checks and the setup and the window connects with no dialog; in an empty window the same value is not found, with the dialog and the Docker welcome', async () => {
    const connectedWith: Array<[string, boolean, boolean, string | undefined]> =
      [];
    for (const value of ['tools/dk', './tools/dk']) {
      const calls = path.join(
        variable('HARNESS_RUN_FOLDER'),
        `t37-calls-${value.replace(/\W/g, '')}`,
      );
      const folder = devContainerFolder(
        `gate-wrapper-${String(value.length)}`,
        {
          name: 'Wrapper',
        },
      );
      folderWrapper(folder, calls);
      await setUserSetting('dev.containers.dockerPath', value);
      try {
        const name = await openFolderWindow(folder);
        await reopenInContainer(name);
        const recorded = recordedCalls(calls);
        connectedWith.push([
          (await windowState(name)).remoteName ?? '',
          recorded.some(call => call.startsWith('version')),
          recorded.some(call => call.startsWith('run ')),
          (await dialogOf(name))?.message,
        ]);
        await closeWindow(name);
      } finally {
        await removeContainers(folder);
      }
    }
    await setUserSetting('dev.containers.dockerPath', 'tools/dk');
    try {
      await startInWindow('local', 'remote-containers.openFolder');
      const shown = await waitForDialog('local');
      await answerDialog('local', 'Cancel');
      await inWindow('local', 'workbench.view.remote');
      await new Promise(resolve => setTimeout(resolve, 3000));
      deepStrictEqual(
        {
          connectedWith,
          dialog: [shown.message, shown.details],
          welcome: await welcomeText('local', VIEW),
        },
        {
          connectedWith: [
            ['dev-container', true, true, undefined],
            ['dev-container', true, true, undefined],
          ],
          dialog: [
            'Docker version 17.12.0 or later required.',
            "Command not found: 'tools/dk'. Check the license for details.",
          ],
          welcome:
            'Get started with containers by installing Docker or by visiting the help view. Refresh after installation and startup.',
        },
      );
    } finally {
      await setUserSetting('dev.containers.dockerPath', undefined);
    }
  });
});
