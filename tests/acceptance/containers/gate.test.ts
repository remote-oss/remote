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
  variable,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {
  answerDialog,
  notificationCentre,
  notifications,
  statusItem,
  waitForDialog,
  windowTitle,
} from '../windows/renderer.ts';
import {
  activations,
  openFolderWindow,
  setUserSetting,
} from '../windows/folder-windows.ts';

const execFileAsync = promisify(execFile);

/** The text the pre-reload progress shows once its link is rendered (S087). */
const PRE_RELOAD_TOAST = 'Connecting to Dev Container (show log)';

describe('Dev Containers release 1 gate rows (card containers-09)', function () {
  this.timeout(600_000);

  it('F-0201 AC-2 (gate-row-8): a bogus dockerPath shows the pre-flight dialog before any reload, twice, and changes nothing', async () => {
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
      path.join(variable('HARNESS_RUN_FOLDER'), 'extensions-containers'),
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

  it('F-0401 5.0 steps 2 and 3, ruling (c) (P1): with a Docker that answers after a second, the Connecting to Dev Container toast is on screen before the window reloads, and then it connects', async () => {
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
          async () => (await notifications(name)).includes(PRE_RELOAD_TOAST),
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

  it('F-0401 5.0 step 2, ruling (c) (P2): with the plain docker, Reopen in Container connects, and what shows before the reload is not asserted', async () => {
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
});
