import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {readdirSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
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
  settingIn,
  variable,
  waitFor,
  windowEvents,
  windowState,
} from '../windows/harness.ts';
import {
  answerDialog,
  notificationCentre,
  statusItem,
  waitForDialog,
  windowTitle,
} from '../windows/renderer.ts';

const execFileAsync = promisify(execFile);

/** How many times window `name` has activated its agent. */
function activations(name: string): number {
  return windowEvents(name).filter(each => each.event === 'activated').length;
}

/** Opens a local window on `folder` and waits for its agent; the window is named after the folder. */
async function openFolderWindow(folder: string): Promise<string> {
  const name = path.basename(folder);
  const before = activations(name);
  await inWindow(
    'local',
    'acceptance.agent.openWindow',
    pathToFileURL(folder).href,
  );
  await waitFor(
    `window ${name} to activate its agent`,
    () => activations(name) > before,
    60_000,
  );
  return name;
}

/** Sets a user setting from the local window and waits until the local window reads it back. */
async function setUserSetting(
  settingId: string,
  value: unknown,
): Promise<void> {
  await inWindow('local', 'acceptance.agent.updateSetting', settingId, value);
  await waitFor(
    `${settingId} to read back as ${JSON.stringify(value)}`,
    async () =>
      JSON.stringify((await settingIn('local', settingId)) ?? null) ===
      JSON.stringify(value ?? null),
    30_000,
  );
}

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
});
