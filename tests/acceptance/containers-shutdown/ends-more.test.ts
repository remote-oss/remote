import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {chmodSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  closeWindow,
  connectedToContainer,
  devContainerFolder,
  devContainersOf,
  reloadWindow,
  reopenInContainer,
  startInWindow,
  variable,
} from '../windows/harness.ts';
import {openFolderWindow, setUserSetting} from '../windows/folder-windows.ts';
import {
  answerDialog,
  dialogOf,
  notificationCentre,
  typeInTerminal,
  waitForDialog,
} from '../windows/renderer.ts';
import {
  closedAndWatched,
  connectedWindow,
  eventsSince,
  helperProcesses,
  lifecycleEvents,
  removeContainersOf,
  stateOf,
  stayedRunning,
  stoppedWithin,
  watched,
} from './support.ts';

const execFileAsync = promisify(execFile);

/** A path in the run's folder. */
function inRun(name: string): string {
  return path.join(variable('HARNESS_RUN_FOLDER'), name);
}

/**
 * Writes the program that stands for docker and, while the file `flag` exists, does `whileFlagged` first; it gives
 * the program's path. `whileFlagged` is a line of shell.
 */
function dockerWrapper(
  name: string,
  flag: string,
  whileFlagged: string,
): string {
  const wrapper = inRun(name);
  writeFileSync(
    wrapper,
    `#!/bin/sh\nif [ -e "${flag}" ]; then ${whileFlagged}; fi\nexec docker "$@"\n`,
  );
  chmodSync(wrapper, 0o755);
  return wrapper;
}

describe('more of what ends a window decides when its container stops (card containers-69)', function () {
  this.timeout(900_000);

  it('F-0417 AC-17, AC-19 (m17): a container killed from the host leaves the window disconnected with core’s dialog; Cancel keeps it, and once the container is started by hand the close stops it about 11 s later', async () => {
    const connected = await connectedWindow('c69-m17');
    try {
      await new Promise(resolve => setTimeout(resolve, 5000));
      await execFileAsync('docker', ['kill', connected.containerId]);
      const shown = await waitForDialog(connected.window, 180_000);
      await answerDialog(connected.window, 'Cancel');
      await execFileAsync('docker', ['start', connected.containerId]);
      const outcome = await closedAndWatched(connected, 22);
      deepStrictEqual(
        [
          shown.details.includes('Cannot reconnect'),
          stoppedWithin(outcome, 0, {from: 9, until: 17}),
        ],
        [true, true],
        `${shown.details} ${JSON.stringify(outcome)}`,
      );
    } finally {
      await closeWindow(connected.window).catch(() => undefined);
      await removeContainersOf(connected.folder);
    }
  });

  it('F-0417 AC-21 (m21): a command running in the window’s terminal at the close does not keep the container running', async () => {
    const connected = await connectedWindow('c69-m21');
    try {
      void startInWindow(connected.window, 'workbench.action.terminal.new');
      await typeInTerminal(connected.window, 'sleep 600\n');
      await new Promise(resolve => setTimeout(resolve, 2000));
      const outcome = await closedAndWatched(connected, 20);
      deepStrictEqual(stoppedWithin(outcome, 0), true, JSON.stringify(outcome));
    } finally {
      await removeContainersOf(connected.folder);
    }
  });

  it('F-0417 AC-25 (m25): Close Remote Connection stops the container 11 to 16 s after, though the window stays open', async () => {
    const connected = await connectedWindow('c69-m25');
    try {
      const from = Date.now();
      void startInWindow(connected.window, 'workbench.action.remote.close');
      const outcome = await watched(connected.containerId, 24, from);
      deepStrictEqual(
        stoppedWithin(outcome, 0, {from: 9, until: 19}),
        true,
        JSON.stringify(outcome),
      );
    } finally {
      await closeWindow(connected.window).catch(() => undefined);
      await removeContainersOf(connected.folder);
    }
  });

  it('F-0417 AC-26 (m26): the stop of one window’s container shows nothing in another window, no notification and no dialog', async () => {
    const staying = await connectedWindow('c69-m26-stays');
    const closing = await connectedWindow('c69-m26-closes');
    try {
      const outcome = await closedAndWatched(closing, 18);
      deepStrictEqual(
        [
          stoppedWithin(outcome, 0),
          (await notificationCentre(staying.window)).filter(text =>
            /stop|shut|container/i.test(text),
          ),
          await dialogOf(staying.window),
        ],
        [true, [], undefined],
      );
    } finally {
      await closeWindow(staying.window);
      await removeContainersOf(staying.folder);
      await removeContainersOf(closing.folder);
    }
  });

  it('F-0417 AC-27 (m27): a container removed during the delay is not made again and nothing of the feature runs on the host 30 s later', async () => {
    const connected = await connectedWindow('c69-m27');
    try {
      await closeWindow(connected.window);
      await execFileAsync('docker', ['rm', '--force', connected.containerId]);
      await new Promise(resolve => setTimeout(resolve, 32_000));
      deepStrictEqual(
        [await devContainersOf(connected.folder), await helperProcesses()],
        [[], []],
      );
    } finally {
      await removeContainersOf(connected.folder);
    }
  });

  it('F-0417 AC-28 (m28): a Docker that cannot be reached when the check runs leaves the container running, and it is not stopped when Docker works again', async () => {
    const flag = inRun('m28-down');
    rmSync(flag, {force: true});
    await setUserSetting(
      'dev.containers.dockerPath',
      dockerWrapper('m28-docker', flag, 'echo unreachable >&2; exit 1'),
    );
    try {
      const connected = await connectedWindow('c69-m28');
      try {
        writeFileSync(flag, '');
        await closeWindow(connected.window);
        const from = Date.now();
        await new Promise(resolve => setTimeout(resolve, 16_000));
        rmSync(flag, {force: true});
        const outcome = await watched(connected.containerId, 40, from);
        deepStrictEqual(stayedRunning(outcome), true, JSON.stringify(outcome));
      } finally {
        await removeContainersOf(connected.folder);
      }
    } finally {
      rmSync(flag, {force: true});
      await setUserSetting('dev.containers.dockerPath', undefined);
    }
  });

  it('F-0417 AC-46 (m46): a container stopped by hand during the delay gets no further start, kill, stop or die for 40 s', async () => {
    const connected = await connectedWindow('c69-m46');
    try {
      await closeWindow(connected.window);
      await new Promise(resolve => setTimeout(resolve, 3000));
      await execFileAsync('docker', ['stop', connected.containerId]);
      await new Promise(resolve => setTimeout(resolve, 2000));
      const since = Date.now();
      await new Promise(resolve => setTimeout(resolve, 40_000));
      deepStrictEqual(
        [
          lifecycleEvents(await eventsSince(connected.containerId, since)),
          await stateOf(connected.containerId),
        ],
        [[], {status: 'exited', exitCode: 0}],
      );
    } finally {
      await removeContainersOf(connected.folder);
    }
  });

  it('F-0417 AC-51 (m51): a reload whose Docker calls are held for 25 s keeps the container running throughout, with no kill, stop, die or start', async () => {
    const flag = inRun('m51-held');
    rmSync(flag, {force: true});
    await setUserSetting(
      'dev.containers.dockerPath',
      dockerWrapper('m51-docker', flag, 'sleep 25'),
    );
    try {
      const connected = await connectedWindow('c69-m51');
      try {
        writeFileSync(flag, '');
        const since = Date.now();
        await reloadWindow(connected.window);
        const during = await watched(connected.containerId, 40, since);
        rmSync(flag, {force: true});
        await connectedToContainer(connected.window, 300_000);
        deepStrictEqual(
          [
            stayedRunning(during),
            lifecycleEvents(await eventsSince(connected.containerId, since)),
          ],
          [true, []],
          JSON.stringify(during),
        );
      } finally {
        await closeWindow(connected.window).catch(() => undefined);
        await removeContainersOf(connected.folder);
      }
    } finally {
      rmSync(flag, {force: true});
      await setUserSetting('dev.containers.dockerPath', undefined);
    }
  });

  it('F-0417 AC-56 (m56): after Rebuild Container the new container stays running for 60 s, and the close then stops it', async () => {
    const connected = await connectedWindow('c69-m56');
    try {
      await reopenInContainer(
        connected.window,
        300_000,
        'remote-containers.rebuildContainer',
      );
      const [rebuilt = ''] = await devContainersOf(connected.folder);
      const during = await watched(rebuilt, 60, Date.now());
      const outcome = await closedAndWatched(
        {...connected, containerId: rebuilt},
        20,
      );
      deepStrictEqual(
        [
          rebuilt !== connected.containerId,
          stayedRunning(during),
          stoppedWithin(outcome, 0),
        ],
        [true, true, true],
        JSON.stringify([during, outcome]),
      );
    } finally {
      await removeContainersOf(connected.folder);
    }
  });

  it('F-0417 AC-58 (m58): a window closed during a 25 s build has no container of the folder up for more than 18 s, and none running 120 s after the close', async () => {
    const folder = devContainerFolder('c69-m58', {
      name: 'Shutdown',
      image: undefined,
      build: {dockerfile: 'Dockerfile'},
    });
    mkdirSync(path.join(folder, '.devcontainer'), {recursive: true});
    writeFileSync(
      path.join(folder, '.devcontainer', 'Dockerfile'),
      `FROM ${variable('HARNESS_DEVCONTAINER_IMAGE')}\nRUN sleep 25 # ${variable('HARNESS_RUN_ID')}\n`,
    );
    const window = await openFolderWindow(folder);
    void startInWindow(window, 'remote-containers.reopenInContainer');
    await new Promise(resolve => setTimeout(resolve, 6000));
    await closeWindow(window);
    const closedAt = Date.now();
    const upSince = new Map<string, number>();
    let longestUp = 0;
    try {
      for (let second = 0; second <= 130; second += 1) {
        const wait = closedAt + second * 1000 - Date.now();
        if (wait > 0) {
          await new Promise(resolve => setTimeout(resolve, wait));
        }
        for (const containerId of await devContainersOf(folder)) {
          const state = await stateOf(containerId);
          if (state !== 'gone' && state.status === 'running') {
            const first = upSince.get(containerId) ?? second;
            upSince.set(containerId, first);
            longestUp = Math.max(longestUp, second - first);
          }
        }
      }
      const stillRunning = [];
      for (const containerId of await devContainersOf(folder)) {
        const state = await stateOf(containerId);
        if (state !== 'gone' && state.status === 'running') {
          stillRunning.push(containerId);
        }
      }
      deepStrictEqual(
        [longestUp <= 18, stillRunning],
        [true, []],
        `longest up ${String(longestUp)} s`,
      );
    } finally {
      await removeContainersOf(folder);
    }
  });

  it('F-0417 AC-60 (m60): a reload that fails soon, a remoteUser that does not exist, shows the failure dialog, which stays, and the container is stopped', async () => {
    const connected = await connectedWindow('c69-m60');
    try {
      writeFileSync(
        path.join(connected.folder, '.devcontainer', 'devcontainer.json'),
        JSON.stringify({
          image: variable('HARNESS_DEVCONTAINER_IMAGE'),
          name: 'Shutdown',
          remoteUser: 'no-such-account',
        }),
      );
      const from = Date.now();
      await reloadWindow(connected.window);
      const shown = await waitForDialog(connected.window, 180_000);
      const outcome = await watched(connected.containerId, 30, from);
      deepStrictEqual(
        [
          shown.details,
          (await dialogOf(connected.window))?.details,
          outcome.stoppedAfter !== undefined && outcome.stoppedAfter <= 25,
        ],
        [
          'An error occurred setting up the container.',
          'An error occurred setting up the container.',
          true,
        ],
        JSON.stringify(outcome),
      );
    } finally {
      await closeWindow(connected.window).catch(() => undefined);
      await removeContainersOf(connected.folder);
    }
  });

  it('F-0417 AC-61 (m61): a window closed and the same folder reopened from a second window within five seconds sees no kill, stop, die or start for 40 s', async () => {
    const first = await connectedWindow('c69-m61');
    try {
      const since = Date.now();
      // Both windows have one name, and the first command to reach it is taken by whichever of them polls first: the
      // close is sent while the first is the only one, and the second opens as it ends.
      const closing = closeWindow(first.window);
      const opening = openFolderWindow(first.folder);
      await Promise.all([closing, opening]);
      await reopenInContainer(first.window);
      await new Promise(resolve => setTimeout(resolve, 40_000));
      deepStrictEqual(
        [
          lifecycleEvents(await eventsSince(first.containerId, since)),
          (await devContainersOf(first.folder))[0] === first.containerId,
        ],
        [[], true],
      );
    } finally {
      await closeWindow(first.window).catch(() => undefined);
      await removeContainersOf(first.folder);
    }
  });
});
