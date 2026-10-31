import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  closeWindow,
  connectedToContainer,
  devContainerFolder,
  devContainersOf,
  editorProduct,
  reloadingCommand,
  reopenInContainer,
  startInWindow,
  userScopeHolds,
  waitFor,
} from '../windows/harness.ts';
import {
  openFolderWindow,
  removeContainers,
  setUserSetting,
} from '../windows/folder-windows.ts';
import {settingsText} from '../windows/maintenance.ts';
import {
  answerDialog,
  notifications,
  statusBarText,
  waitForDialog,
  windowTitle,
} from '../windows/renderer.ts';

const execFileAsync = promisify(execFile);

/** The error dialog's text of F-0410 (STR:S034). */
const S034 = 'An error occurred setting up the container.';

/** How long a rebuild may take to make its new container. */
const REBUILD_MILLISECONDS = 240_000;

/** The output of `docker` run with `parameters`, trimmed. */
async function docker(...parameters: string[]): Promise<string> {
  const {stdout} = await execFileAsync('docker', parameters);
  return stdout.trim();
}

/** A mount of a container, as `docker inspect` says it. */
interface Mount {
  Type: string;
  Name?: string;
  Destination: string;
  RW: boolean;
}

/** The mounts of container `containerId`. */
async function mountsOf(containerId: string): Promise<Mount[]> {
  return JSON.parse(
    await docker('inspect', '-f', '{{json .Mounts}}', containerId),
  ) as Mount[];
}

/** The mount at `/vscode` of container `containerId`, as its type, volume name and mode, or nothing. */
async function vscodeMountOf(
  containerId: string,
): Promise<[string, string | undefined, boolean] | undefined> {
  const mount = (await mountsOf(containerId)).find(
    each => each.Destination === '/vscode',
  );
  return mount === undefined ? undefined : [mount.Type, mount.Name, mount.RW];
}

/** The creation time of volume `volume`, or nothing when it does not exist. */
async function createdAtOf(volume: string): Promise<string | undefined> {
  try {
    return (
      await docker('volume', 'inspect', '-f', '{{.CreatedAt}}', volume)
    ).trim();
  } catch {
    return undefined;
  }
}

/** What the server link of the remote user points at in container `containerId`: `/vscode/<server>/bin/<platform>/<commit>`. */
async function serverLinkOf(containerId: string): Promise<string> {
  return docker(
    'exec',
    containerId,
    'sh',
    '-c',
    'for link in "$HOME"/.*-server*/bin/*; do [ -L "$link" ] && readlink "$link"; done',
  );
}

/** The commit folders in the platform folder that `link` (a server link's target) is in, as seen from container `containerId`. */
async function commitsBesideOf(
  containerId: string,
  link: string,
): Promise<string[]> {
  return (await docker('exec', containerId, 'ls', link.replace(/\/[^/]*$/, '')))
    .split('\n')
    .filter(line => line !== '');
}

/** How many extension folders the remote user of container `containerId` has installed. */
async function installedCountOf(containerId: string): Promise<number> {
  return Number(
    await docker(
      'exec',
      containerId,
      'sh',
      '-c',
      `ls "$(cd; pwd)/${editorProduct().serverDataFolderName}/extensions" 2>/dev/null | grep -c . ; true`,
    ),
  );
}

/** Opens a window on `folder` and reopens it in its container; gives the window and the container's id. */
async function opened(
  folder: string,
): Promise<{name: string; containerId: string}> {
  const name = await openFolderWindow(folder);
  await reopenInContainer(name);
  const [containerId = ''] = await devContainersOf(folder);
  return {name, containerId};
}

/** Runs the rebuild `command` in window `name`, and gives the container the folder has once the old one is replaced. */
async function rebuiltBy(
  name: string,
  folder: string,
  before: string,
  command: string,
): Promise<string> {
  await reloadingCommand(name, command);
  let made = '';
  await waitFor(
    'the rebuild to make a new container',
    async () => {
      const containerIds = await devContainersOf(folder);
      made = containerIds.find(each => each !== before) ?? '';
      return made !== '' && containerIds.length === 1;
    },
    REBUILD_MILLISECONDS,
  );
  await connectedToContainer(name, REBUILD_MILLISECONDS);
  return made;
}

/** How a connect looks in the window: the connecting toasts it showed, the remote indicator and the title at its end. */
interface Look {
  toasts: string[];
  indicator: string;
  title: string;
}

/** What of a connect's look does not depend on whether the server had to be installed: the toasts without their stage, the stages being only the server's, the indicator and the title. */
function baseOf(look: Look | undefined): {
  toasts: string[];
  stages: boolean;
  indicator: string | undefined;
  title: string | undefined;
} {
  const texts = look?.toasts ?? [];
  return {
    toasts: [...new Set(texts.map(text => text.replace(/: .*$/, '')))],
    stages: texts
      .filter(text => text.includes(': '))
      .every(text =>
        ['Installing server', 'Starting server'].includes(
          text.split(': ')[1] ?? '',
        ),
      ),
    indicator: look?.indicator,
    title: look?.title,
  };
}

describe('F-0419 the vscode cache volume (card containers-53)', function () {
  this.timeout(900_000);

  it('F-0419 AC-1, AC-2, AC-6, AC-7 (c1): a container mounts the vscode volume read-write at /vscode, an unrelated one mounts the same volume with its one commit folder, and neither rebuild changes the volume', async () => {
    const first = devContainerFolder('c53v-one', {name: 'Volume One'});
    const second = devContainerFolder('c53v-two', {
      name: 'Volume Two',
      containerEnv: {ROW_NAME: 'two'},
    });
    try {
      const firstOpen = await opened(first);
      const mountOne = await vscodeMountOf(firstOpen.containerId);
      const createdAt = await createdAtOf('vscode');
      const linkOne = await serverLinkOf(firstOpen.containerId);
      const commitsOne = await commitsBesideOf(firstOpen.containerId, linkOne);
      await closeWindow(firstOpen.name);
      const secondOpen = await opened(second);
      const mountTwo = await vscodeMountOf(secondOpen.containerId);
      const createdAtAfterTwo = await createdAtOf('vscode');
      const linkTwo = await serverLinkOf(secondOpen.containerId);
      const commitsTwo = await commitsBesideOf(secondOpen.containerId, linkTwo);
      const rebuilt = await rebuiltBy(
        secondOpen.name,
        second,
        secondOpen.containerId,
        'remote-containers.rebuildContainer',
      );
      const mountRebuilt = await vscodeMountOf(rebuilt);
      const createdAtAfterRebuild = await createdAtOf('vscode');
      const rebuiltClean = await rebuiltBy(
        secondOpen.name,
        second,
        rebuilt,
        'remote-containers.rebuildContainerNoCache',
      );
      const mountClean = await vscodeMountOf(rebuiltClean);
      const createdAtAfterClean = await createdAtOf('vscode');
      await closeWindow(secondOpen.name);
      console.log(
        `c53v c1: ${JSON.stringify({linkOne, commitsOne, linkTwo, commitsTwo})}`,
      );
      deepStrictEqual(
        {
          mountOne,
          mountTwo,
          mountRebuilt,
          mountClean,
          sameVolume: [
            createdAtAfterTwo,
            createdAtAfterRebuild,
            createdAtAfterClean,
          ].every(each => each === createdAt),
          oneCommit: commitsOne.length === 1 && commitsTwo.length === 1,
          sameCommit: linkOne === linkTwo,
        },
        {
          mountOne: ['volume', 'vscode', true],
          mountTwo: ['volume', 'vscode', true],
          mountRebuilt: ['volume', 'vscode', true],
          mountClean: ['volume', 'vscode', true],
          sameVolume: true,
          oneCommit: true,
          sameCommit: true,
        },
      );
    } finally {
      await removeContainers(first);
      await removeContainers(second);
    }
  });

  /** Opens `folder` and gives what the failed connect shows and leaves: its dialog, the folder's containers, and the volumes. */
  async function collisionOutcome(
    folder: string,
    volumes: readonly string[],
  ): Promise<{
    dialog: string;
    containers: string[];
    retried: string;
    containersAfterRetry: string[];
    existing: Array<string | undefined>;
  }> {
    const name = await openFolderWindow(folder);
    await startInWindow(name, 'remote-containers.reopenInContainer');
    const shown = await waitForDialog(name, 300_000);
    const containers = await devContainersOf(folder);
    await answerDialog(name, 'Retry');
    const again = await waitForDialog(name, 300_000);
    const containersAfterRetry = await devContainersOf(folder);
    await answerDialog(name, 'Cancel').catch(() => undefined);
    const existing = await Promise.all(volumes.map(each => createdAtOf(each)));
    await closeWindow(name);
    return {
      dialog: shown.details,
      containers,
      retried: again.details,
      containersAfterRetry,
      existing,
    };
  }

  it('F-0419 AC-14, AC-33 (c14): a mounts entry at /vscode makes the S034 dialog, no container, and Retry shows the same dialog again; both volumes are left on the host', async () => {
    await docker('volume', 'rm', 'c53v-own').catch(() => undefined);
    const folder = devContainerFolder('c53v-mounts', {
      name: 'Volume Mounts',
      mounts: ['source=c53v-own,target=/vscode,type=volume'],
    });
    try {
      const outcome = await collisionOutcome(folder, ['vscode', 'c53v-own']);
      console.log(`c53v c14: ${JSON.stringify(outcome)}`);
      deepStrictEqual(
        {
          dialog: outcome.dialog,
          containers: outcome.containers,
          retried: outcome.retried,
          containersAfterRetry: outcome.containersAfterRetry,
          existing: outcome.existing.map(each => each !== undefined),
        },
        {
          dialog: S034,
          containers: [],
          retried: S034,
          containersAfterRetry: [],
          existing: [true, true],
        },
      );
    } finally {
      await removeContainers(folder);
      await docker('volume', 'rm', 'c53v-own').catch(() => undefined);
    }
  });

  it('F-0419 AC-23 (c23): runArgs that mount a volume at /vscode, and a workspaceMount at /vscode, make the S034 dialog and no container, with the vscode volume left unattached', async () => {
    await docker('volume', 'rm', 'c53v-run').catch(() => undefined);
    const byRunArgs = devContainerFolder('c53v-runargs', {
      name: 'Volume RunArgs',
      runArgs: ['-v', 'c53v-run:/vscode'],
    });
    const byWorkspaceMount = devContainerFolder('c53v-wsmount', {
      name: 'Volume WorkspaceMount',
      workspaceMount: 'source=c53v-run,target=/vscode,type=volume',
    });
    try {
      const outcomes = [];
      for (const folder of [byRunArgs, byWorkspaceMount]) {
        const outcome = await collisionOutcome(folder, ['vscode']);
        console.log(`c53v c23 ${folder}: ${JSON.stringify(outcome)}`);
        outcomes.push([
          outcome.dialog,
          outcome.containers,
          outcome.existing.map(each => each !== undefined),
        ]);
      }
      console.log(`c53v c23: ${JSON.stringify(outcomes)}`);
      deepStrictEqual(outcomes, [
        [S034, [], [true]],
        [S034, [], [true]],
      ]);
    } finally {
      await removeContainers(byRunArgs);
      await removeContainers(byWorkspaceMount);
      await docker('volume', 'rm', 'c53v-run').catch(() => undefined);
    }
  });

  it('F-0419 AC-22 (c22): a mounts entry at /vscode added to an existing container’s configuration makes the S034 dialog on Rebuild, leaves no container, and the vscode volume stays unattached', async () => {
    const folder = devContainerFolder('c53v-added', {name: 'Volume Added'});
    try {
      const {name, containerId} = await opened(folder);
      const file = path.join(folder, '.devcontainer', 'devcontainer.json');
      const configuration = JSON.parse(readFileSync(file, 'utf8')) as Record<
        string,
        unknown
      >;
      writeFileSync(
        file,
        JSON.stringify({
          ...configuration,
          mounts: ['source=c53v-added,target=/vscode,type=volume'],
        }),
      );
      await reloadingCommand(name, 'remote-containers.rebuildContainer');
      const dialog = await waitForDialog(name, 300_000);
      const containers = await devContainersOf(folder);
      const holders = await docker(
        'ps',
        '--all',
        '--quiet',
        '--filter',
        'volume=vscode',
      );
      await answerDialog(name, 'Edit devcontainer.json Locally');
      await closeWindow(name);
      deepStrictEqual(
        {
          dialog: dialog.details,
          containers,
          held: holders === '' ? [] : holders.split('\n'),
          volume: (await createdAtOf('vscode')) !== undefined,
          replaced: containerId !== '',
        },
        {
          dialog: S034,
          containers: [],
          held: [],
          volume: true,
          replaced: true,
        },
      );
    } finally {
      await removeContainers(folder);
      await docker('volume', 'rm', 'c53v-added').catch(() => undefined);
    }
  });

  it('F-0419 AC-15 (c15): the connect looks the same with cacheVolume on and off: the same toasts, the same indicator, and the same title but for the folder name', async () => {
    const looks: Look[] = [];
    for (const cacheVolume of [true, false]) {
      await setUserSetting('dev.containers.cacheVolume', cacheVolume);
      const folder = devContainerFolder('c53v-look', {name: 'Volume Look'});
      try {
        const name = await openFolderWindow(folder);
        const toasts = new Set<string>();
        const gate = {done: false};
        const sampler = (async () => {
          while (!gate.done) {
            try {
              for (const text of await notifications(name)) {
                if (text.startsWith('Connecting')) {
                  toasts.add(text);
                }
              }
            } catch {
              // The window is reloading.
            }
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        })();
        await reopenInContainer(name);
        gate.done = true;
        await sampler;
        looks.push({
          toasts: [...toasts].sort(),
          indicator: await statusBarText(name, 'status.host'),
          title: (await windowTitle(name)).replace(
            path.basename(folder),
            '<folder>',
          ),
        });
        await closeWindow(name);
      } finally {
        await removeContainers(folder);
      }
    }
    await setUserSetting('dev.containers.cacheVolume', undefined);
    deepStrictEqual(looks.map(baseOf), [
      {...baseOf(looks[0]), indicator: 'Dev Container: Volume Look'},
      {...baseOf(looks[0]), indicator: 'Dev Container: Volume Look'},
    ]);
  });

  it('F-0419 AC-17 (c17): with an extension pack to install, with cacheVolume on and off, there is a moment when the window is connected and the extensions are not all installed, and they are installed after', async () => {
    const results = [];
    for (const cacheVolume of [false, true]) {
      await setUserSetting('dev.containers.cacheVolume', cacheVolume);
      const folder = devContainerFolder('c53v-pack', {
        name: 'Volume Pack',
        customizations: {vscode: {extensions: ['vscjava.vscode-java-pack']}},
      });
      try {
        const name = await openFolderWindow(folder);
        const samples: Array<{connected: boolean; installed: number}> = [];
        const gate = {done: false};
        const sampler = (async () => {
          let settled = 0;
          while (!gate.done || settled < 20) {
            try {
              const connected = (
                await statusBarText(name, 'status.host')
              ).startsWith('Dev Container:');
              const [containerId = ''] = await devContainersOf(folder);
              const installed =
                connected && containerId !== ''
                  ? await installedCountOf(containerId)
                  : 0;
              samples.push({connected, installed});
              settled =
                gate.done && installed === samples.at(-2)?.installed
                  ? settled + 1
                  : 0;
            } catch {
              // The window is reloading.
            }
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        })();
        await reopenInContainer(name);
        gate.done = true;
        await sampler;
        const connectedSamples = samples.filter(sample => sample.connected);
        results.push({
          cacheVolume,
          atFirstConnected: connectedSamples[0]?.installed,
          atEnd: samples.at(-1)?.installed,
        });
        await closeWindow(name);
      } finally {
        await removeContainers(folder);
      }
    }
    await setUserSetting('dev.containers.cacheVolume', undefined);
    console.log(`c53v c17: ${JSON.stringify(results)}`);
    deepStrictEqual(
      results.map(
        result => (result.atFirstConnected ?? 0) < (result.atEnd ?? 0),
      ),
      [true, true],
    );
  });

  it('F-0419 BR-15 (reset-removes): a reset leaves no dev.containers.cacheVolume key in the user settings', async () => {
    const seen: Array<[boolean, boolean]> = [];
    for (const value of [false, undefined]) {
      await setUserSetting('dev.containers.cacheVolume', value);
      seen.push([
        settingsText().includes('"dev.containers.cacheVolume"'),
        await userScopeHolds('local', 'dev.containers.cacheVolume'),
      ]);
    }
    deepStrictEqual(seen, [
      [true, true],
      [false, false],
    ]);
  });
});
