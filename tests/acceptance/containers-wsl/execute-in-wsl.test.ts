import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  closeWindow,
  devContainerFolder,
  inWindow,
  reopenInContainer,
  variable,
  windowState,
} from '../windows/harness.ts';
import {
  answerDialog,
  notificationCentre,
  waitForDialog,
} from '../windows/renderer.ts';
import {openFolderWindow, setUserSetting} from '../windows/folder-windows.ts';

const execFileAsync = promisify(execFile);

/** The WSL distro that holds the engine: the one the platform workflow's Windows job runs Docker Engine in (`Ubuntu-24.04`). */
const DISTRO = 'Ubuntu-24.04';

/** The words of the notification that a workspace folder's drive is not shared with the engine (S356). */
const S356 = 'The drive of the workspace folder is not shared';

/** Runs `docker` with the arguments inside the distro and gives what it printed, without its final newline. */
async function inDistro(...dockerArguments: string[]): Promise<string> {
  const {stdout} = await execFileAsync('wsl', [
    '-d',
    DISTRO,
    '--',
    'docker',
    ...dockerArguments,
  ]);
  return stdout.trim();
}

describe('Dev Containers with its engine in a WSL distro (F-0411, card #3022)', function () {
  this.timeout(900_000);

  it('F-0411 AC-24 (c3022-distro-only): with the engine only in the distro and executeInWSL unset, Reopen in Container gives the dialog of a machine without Docker', async () => {
    const bogus = path.join(variable('HARNESS_RUN_FOLDER'), 'c3022-no-docker');
    const folder = devContainerFolder('c3022-distro-only', {
      name: 'c3022-distro-only',
    });
    const name = await openFolderWindow(folder);
    await setUserSetting('dev.containers.dockerPath', bogus);
    try {
      const running = inWindow(name, 'remote-containers.reopenInContainer');
      running.catch(() => undefined);
      const dialog = await waitForDialog(name, 60_000);
      await answerDialog(name, 'Cancel');
      await running.catch(() => undefined);
      deepStrictEqual(
        {
          message: dialog.message,
          details: dialog.details,
          containers: await inDistro(
            'ps',
            '-a',
            '-q',
            '--filter',
            `label=devcontainer.local_folder=${folder}`,
          ),
        },
        {
          message: 'Docker version 17.12.0 or later required.',
          details: `Command not found: '${bogus}'. Check the license for details.`,
          containers: '',
        },
      );
    } finally {
      await setUserSetting('dev.containers.dockerPath', undefined);
      await closeWindow(name);
    }
  });

  it('F-0411 AC-25 (c3022-execute-in-wsl): with executeInWSL true, a Windows folder’s window reopens in its container, bound from /mnt/<drive>, labelled with the Windows path, and with no consistency or S356', async () => {
    const folder = devContainerFolder('c3022-wsl', {name: 'c3022-wsl'});
    await setUserSetting('dev.containers.executeInWSL', true);
    await setUserSetting('dev.containers.executeInWSLDistro', DISTRO);
    let name: string | undefined;
    let containerId = '';
    try {
      name = await openFolderWindow(folder);
      const before = (await notificationCentre(name)).some(text =>
        text.includes(S356),
      );
      await reopenInContainer(name);
      containerId = await inDistro(
        'ps',
        '-q',
        '--filter',
        `label=devcontainer.local_folder=${folder}`,
      );
      const inspected = (JSON.parse(
        await inDistro(
          'inspect',
          containerId,
          '--format',
          '{{json .HostConfig.Mounts}}',
        ),
      ) ?? []) as Array<{Type: string; Source: string; Target: string}>;
      const labelled = await inDistro(
        'inspect',
        containerId,
        '--format',
        '{{index .Config.Labels "devcontainer.local_folder"}}',
      );
      const bind = inspected.find(
        mount => mount.Target === '/workspaces/c3022-wsl',
      );
      const consistency = await inDistro(
        'inspect',
        containerId,
        '--format',
        '{{range .HostConfig.Mounts}}{{.Consistency}}{{end}}',
      );
      const after = (await notificationCentre(name)).some(text =>
        text.includes(S356),
      );
      const folders = (await windowState(name)).folders;
      deepStrictEqual(
        {
          bind: bind === undefined ? undefined : [bind.Type, bind.Source],
          target: bind?.Target,
          consistency,
          labelled,
          openedAt: folders.map(each =>
            each.slice(-'/workspaces/c3022-wsl'.length),
          ),
          s356: [before, after],
        },
        {
          bind: [
            'bind',
            `/mnt/${folder[0]?.toLowerCase() ?? ''}/${folder.slice(3).replaceAll('\\', '/')}`,
          ],
          target: '/workspaces/c3022-wsl',
          consistency: '',
          labelled: folder,
          openedAt: ['/workspaces/c3022-wsl'],
          s356: [false, false],
        },
      );
    } finally {
      await setUserSetting('dev.containers.executeInWSL', undefined);
      await setUserSetting('dev.containers.executeInWSLDistro', undefined);
      if (containerId !== '') {
        await inDistro('rm', '-f', containerId);
      }
      if (name !== undefined) {
        await closeWindow(name);
      }
    }
  });
});
