import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  connectedToContainer,
  devContainerFolder,
  devContainersOf,
  reloadWindow,
  reopenInContainer,
  runLabelArguments,
  startInWindow,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {
  closedAndWatched,
  connectedWindow,
  removeContainersOf,
  stateOf,
  stayedRunning,
  stoppedWithin,
  watched,
} from './support.ts';

const execFileAsync = promisify(execFile);

/** A Dockerfile configuration of the run's image, with `lines` after its FROM. */
function dockerfileFolder(
  name: string,
  lines: string,
  configuration: Readonly<Record<string, unknown>> = {},
  base: string = variable('HARNESS_DEVCONTAINER_IMAGE'),
): string {
  const folder = devContainerFolder(name, {
    name: 'Shutdown',
    image: undefined,
    build: {dockerfile: 'Dockerfile'},
    ...configuration,
  });
  writeFileSync(
    path.join(folder, '.devcontainer', 'Dockerfile'),
    `FROM ${base}\n${lines}`,
  );
  return folder;
}

describe('what ends a window decides when its container stops (card containers-69)', function () {
  this.timeout(900_000);

  it('F-0417 AC-12 (e12): a command that exits 3 four seconds after the signal shows Exited (3) about 15 s after the close, and one that ignores it Exited (137) about 21 s after', async () => {
    const results = [];
    for (const [label, trap, exitCode, window] of [
      ['exits', "trap 'sleep 4; exit 3' TERM", 3, {from: 13, to: 18}],
      ['ignores', "trap '' TERM", 137, {from: 19, to: 24}],
    ] as const) {
      const folder = dockerfileFolder(
        `c69-e12-${label}`,
        `CMD ["sh", "-c", "${trap}; while :; do sleep 1; done"]\n`,
        {overrideCommand: false},
      );
      const window2 = await openFolderWindow(folder);
      await reopenInContainer(window2, 300_000);
      const [containerId = ''] = await devContainersOf(folder);
      try {
        const outcome = await closedAndWatched(
          {window: window2, folder, containerId},
          label === 'exits' ? 22 : 28,
        );
        results.push([label, stoppedWithin(outcome, exitCode, window)]);
      } finally {
        await removeContainersOf(folder);
      }
    }
    deepStrictEqual(results, [
      ['exits', true],
      ['ignores', true],
    ]);
  });

  it('F-0417 AC-22 (e22): a process started in the container from the host with docker exec does not keep it running', async () => {
    const connected = await connectedWindow('c69-e22');
    try {
      await execFileAsync('docker', [
        'exec',
        '-d',
        connected.containerId,
        'sleep',
        '600',
      ]);
      const outcome = await closedAndWatched(connected, 20);
      deepStrictEqual(stoppedWithin(outcome, 0), true, JSON.stringify(outcome));
    } finally {
      await removeContainersOf(connected.folder);
    }
  });

  it('F-0417 AC-62 (e62): a postCreateCommand that is still running at the close does not keep the container running', async () => {
    const connected = await connectedWindow('c69-e62', {
      postCreateCommand: 'sleep 60',
    });
    try {
      const outcome = await closedAndWatched(connected, 20);
      deepStrictEqual(stoppedWithin(outcome, 0), true, JSON.stringify(outcome));
    } finally {
      await removeContainersOf(connected.folder);
    }
  });

  it('F-0417 AC-66, AC-68 (e66): a foreground postStartCommand of ten minutes and a detached one do not keep the container running', async () => {
    const results = [];
    for (const [label, command] of [
      ['foreground', 'sleep 600'],
      ['detached', 'nohup sleep 600 >/dev/null 2>&1 &'],
    ] as const) {
      const connected = await connectedWindow(`c69-e66-${label}`, {
        postStartCommand: command,
        waitFor: 'postCreateCommand',
      });
      try {
        results.push([
          label,
          stoppedWithin(await closedAndWatched(connected, 20), 0),
        ]);
      } finally {
        await removeContainersOf(connected.folder);
      }
    }
    deepStrictEqual(results, [
      ['foreground', true],
      ['detached', true],
    ]);
  });

  it('F-0417 AC-57 (e57): a window closed after its container started but while it still says Opening Remote... has the container stopped about 11 s later', async () => {
    const folder = devContainerFolder('c69-e57', {
      name: 'Shutdown',
      postCreateCommand: 'sleep 90',
      waitFor: 'postCreateCommand',
    });
    const window = await openFolderWindow(folder);
    void startInWindow(window, 'remote-containers.reopenInContainer');
    let containerId = '';
    await waitFor(
      'the container to run while the window is still connecting',
      async () => {
        [containerId = ''] = await devContainersOf(folder);
        return containerId !== '' && (await stateOf(containerId)) !== 'gone';
      },
      180_000,
    );
    try {
      const outcome = await closedAndWatched({window, folder, containerId}, 22);
      deepStrictEqual(
        stoppedWithin(outcome, 0, {from: 9, to: 17}),
        true,
        JSON.stringify(outcome),
      );
    } finally {
      await removeContainersOf(folder);
    }
  });

  it('F-0417 AC-67 (e67): a Dockerfile’s LABEL devcontainer.metadata with none, on a base image that has its own metadata label, is not on the container’s label as a shutdownAction, and the container is stopped', async () => {
    const baseFolder = path.join(
      variable('HARNESS_RUN_FOLDER'),
      'c69-e67-base',
    );
    mkdirSync(baseFolder, {recursive: true});
    writeFileSync(
      path.join(baseFolder, 'Dockerfile'),
      `FROM ${variable('HARNESS_DEVCONTAINER_IMAGE')}\nLABEL devcontainer.metadata='[{"remoteUser":"root"}]'\n`,
    );
    const base =
      `c69-labelled-base-${variable('HARNESS_RUN_ID')}`.toLowerCase();
    await execFileAsync('docker', ['build', '-t', base, baseFolder]);
    const folder = dockerfileFolder(
      'c69-e67',
      `LABEL devcontainer.metadata='[{"shutdownAction":"none"}]'\n`,
      {},
      base,
    );
    try {
      const window = await openFolderWindow(folder);
      await reopenInContainer(window, 300_000);
      const [containerId = ''] = await devContainersOf(folder);
      const {stdout} = await execFileAsync('docker', [
        'inspect',
        '--format',
        '{{index .Config.Labels "devcontainer.metadata"}}',
        containerId,
      ]);
      const outcome = await closedAndWatched({window, folder, containerId}, 20);
      deepStrictEqual(
        [stdout.includes('shutdownAction'), stoppedWithin(outcome, 0)],
        [false, true],
        `${stdout} ${JSON.stringify(outcome)}`,
      );
    } finally {
      await removeContainersOf(folder);
      await execFileAsync('docker', ['image', 'rm', '--force', base]);
    }
  });

  it('F-0417 AC-69 (e69): a container made with only the folder’s two labels and a file saying none stays running after its window is closed', async () => {
    const folder = devContainerFolder('c69-e69', {
      name: 'Shutdown',
      shutdownAction: 'none',
    });
    const configFile = path.join(folder, '.devcontainer', 'devcontainer.json');
    const {stdout} = await execFileAsync('docker', [
      'run',
      '-d',
      ...runLabelArguments(),
      '--label',
      `devcontainer.local_folder=${folder}`,
      '--label',
      `devcontainer.config_file=${configFile}`,
      '--mount',
      `type=bind,source=${folder},target=/workspaces/${path.basename(folder)}`,
      variable('HARNESS_DEVCONTAINER_IMAGE'),
      'sleep',
      '3600',
    ]);
    const containerId = stdout.trim();
    const window = await openFolderWindow(folder);
    await reopenInContainer(window);
    try {
      const reused = (await devContainersOf(folder)).length === 1;
      const outcome = await closedAndWatched({window, folder, containerId}, 40);
      deepStrictEqual(
        [reused, stayedRunning(outcome)],
        [true, true],
        JSON.stringify(outcome),
      );
    } finally {
      await removeContainersOf(folder, [containerId]);
    }
  });

  it('F-0417 AC-24 (e24): a reload keeps the container running for 40 s with no kill, stop or die, and the close after it stops it', async () => {
    const connected = await connectedWindow('c69-e24');
    try {
      const began = Date.now();
      await reloadWindow(connected.window);
      await connectedToContainer(connected.window, 300_000);
      const during = await watched(connected.containerId, 40, began);
      const outcome = await closedAndWatched(connected, 20);
      deepStrictEqual(
        [stayedRunning(during), stoppedWithin(outcome, 0)],
        [true, true],
        JSON.stringify([during, outcome]),
      );
    } finally {
      await removeContainersOf(connected.folder);
    }
  });
});
