import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {realpathSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  closeWindow,
  connectedToContainer,
  devContainerFolder,
  devContainersOf,
  reloadingCommand,
  reopenInContainer,
  variable,
  windowState,
} from '../windows/harness.ts';
import {notificationCentre} from '../windows/renderer.ts';
import {
  openFolderWindow,
  removeContainers,
  setUserSetting,
} from '../windows/folder-windows.ts';
import {bindAt} from './mounts.ts';

const execFileAsync = promisify(execFile);

const CONSISTENCY = 'dev.containers.workspaceMountConsistency';
const LEGACY_CONSISTENCY = 'remote.containers.workspaceMountConsistency';

/** The words of the notification that a workspace folder's drive is not shared with the engine (S356). */
const S356 = 'The drive of the workspace folder is not shared';

/** The first container of the run made for `folder`; it fails when there is none. */
async function containerOf(folder: string): Promise<string> {
  const [containerId] = await devContainersOf(folder);
  if (containerId === undefined) {
    throw new Error(`no container of the run is labelled for ${folder}`);
  }
  return containerId;
}

/** What `docker` printed for `dockerArguments`, without its final newline. */
async function docker(...dockerArguments: string[]): Promise<string> {
  const {stdout} = await execFileAsync('docker', dockerArguments);
  return stdout.trim();
}

/** The consistency of the workspace mount at `target` in the container of `folder`, as the engine was asked for it. */
async function consistencyOf(folder: string, target: string): Promise<string> {
  return (await bindAt(await containerOf(folder), target))?.Consistency ?? '';
}

describe('Dev Containers on Docker Desktop for Windows (card #3172)', function () {
  this.timeout(900_000);

  it('F-0411 AC-33, AC-15 (c3020-consistency-values): the default workspace mount shows cached, then consistent, then delegated, each after a rebuild with no window restart', async () => {
    const folder = devContainerFolder('c3020-consistency', {
      name: 'c3020-consistency',
    });
    const target = '/workspaces/c3020-consistency';
    const seen: string[] = [];
    let name: string | undefined;
    try {
      name = await openFolderWindow(folder);
      await reopenInContainer(name);
      seen.push(await consistencyOf(folder, target));
      for (const value of ['consistent', 'delegated']) {
        await setUserSetting(CONSISTENCY, value);
        await reloadingCommand(name, 'remote-containers.rebuildContainer');
        await connectedToContainer(name);
        seen.push(await consistencyOf(folder, target));
      }
      deepStrictEqual(seen, ['cached', 'consistent', 'delegated']);
    } finally {
      await setUserSetting(CONSISTENCY, undefined);
      if (name !== undefined) {
        await closeWindow(name);
      }
      await removeContainers(folder);
    }
  });

  it('F-0411 AC-31 (c3020-legacy-key): the legacy key alone gives its value, and with both keys set the dev.containers one wins after a rebuild', async () => {
    const folder = devContainerFolder('c3020-legacy', {name: 'c3020-legacy'});
    const target = '/workspaces/c3020-legacy';
    const seen: string[] = [];
    let name: string | undefined;
    try {
      await setUserSetting(LEGACY_CONSISTENCY, 'delegated');
      name = await openFolderWindow(folder);
      await reopenInContainer(name);
      seen.push(await consistencyOf(folder, target));
      await setUserSetting(CONSISTENCY, 'consistent');
      await reloadingCommand(name, 'remote-containers.rebuildContainer');
      await connectedToContainer(name);
      seen.push(await consistencyOf(folder, target));
      deepStrictEqual(seen, ['delegated', 'consistent']);
    } finally {
      await setUserSetting(CONSISTENCY, undefined);
      await setUserSetting(LEGACY_CONSISTENCY, undefined);
      if (name !== undefined) {
        await closeWindow(name);
      }
      await removeContainers(folder);
    }
  });

  it('F-0411 AC-23 (c3020-local-drive): a folder on a local drive is mounted with no S356, and its content is at the mount target (the executeInWSL half waits for #3072)', async () => {
    const folder = devContainerFolder('c3020-drive', {name: 'c3020-drive'});
    writeFileSync(path.join(folder, 'probe.txt'), 'c3020 probe');
    let name: string | undefined;
    try {
      name = await openFolderWindow(folder);
      const before = (await notificationCentre(name)).some(text =>
        text.includes(S356),
      );
      await reopenInContainer(name);
      const content = await docker(
        'exec',
        await containerOf(folder),
        'cat',
        '/workspaces/c3020-drive/probe.txt',
      );
      const after = (await notificationCentre(name)).some(text =>
        text.includes(S356),
      );
      deepStrictEqual(
        {content, s356: [before, after]},
        {content: 'c3020 probe', s356: [false, false]},
      );
    } finally {
      if (name !== undefined) {
        await closeWindow(name);
      }
      await removeContainers(folder);
    }
  });

  it('F-0411 AC-32 (c3020-repo-subfolder): a subfolder of a repository binds the repository root as a Windows path, opens at its sub-path, and labels the container with Windows paths', async () => {
    const subfolder = devContainerFolder('c3020-repo/sub/deeper', {
      name: 'c3020-repo',
    });
    const repository = path.join(variable('HARNESS_RUN_FOLDER'), 'c3020-repo');
    await execFileAsync('git', ['init', '--quiet'], {cwd: repository});
    await execFileAsync('git', ['add', '--all'], {cwd: repository});
    await execFileAsync(
      'git',
      [
        '-c',
        'user.name=Row',
        '-c',
        'user.email=row@example.com',
        'commit',
        '--quiet',
        '--message',
        'repository',
      ],
      {cwd: repository},
    );
    let name: string | undefined;
    try {
      name = await openFolderWindow(subfolder);
      await reopenInContainer(name);
      const containerId =
        (await devContainersOf(subfolder))[0] ??
        (await containerOf(repository));
      const bind = await bindAt(containerId, '/workspaces/c3020-repo');
      const labels = await docker(
        'inspect',
        '-f',
        '{{index .Config.Labels "devcontainer.local_folder"}}|{{index .Config.Labels "devcontainer.config_file"}}',
        containerId,
      );
      const [localFolder = '', configFile = ''] = labels.split('|');
      deepStrictEqual(
        {
          source: realpathSync.native(bind?.Source ?? ''),
          openedAt: (await windowState(name)).folders.map(each =>
            each.slice(-'/workspaces/c3020-repo/sub/deeper'.length),
          ),
          windowsLabels: [
            /^[a-z]:\\/.test(localFolder),
            /^[A-Za-z]:[\\/]/.test(configFile),
            /^[A-Za-z]:\\/.test(bind?.Source ?? ''),
          ],
        },
        {
          source: realpathSync.native(repository),
          openedAt: ['/workspaces/c3020-repo/sub/deeper'],
          windowsLabels: [true, true, true],
        },
      );
    } finally {
      if (name !== undefined) {
        await closeWindow(name);
      }
      await removeContainers(subfolder);
      await removeContainers(repository);
    }
  });
});
