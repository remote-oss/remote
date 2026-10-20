import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  closeWindow,
  devContainerFolder,
  devContainersOf,
  reopenInContainer,
  runLabelArguments,
  variable,
} from '../windows/harness.ts';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {
  closedAndWatched,
  connectedWindow,
  removeContainersOf,
  stayedRunning,
  stoppedWithin,
} from './support.ts';

const execFileAsync = promisify(execFile);

/** Rewrites the configuration of `folder`: the run's image and labels, and `configuration`. */
function configure(
  folder: string,
  configuration: Readonly<Record<string, unknown>>,
): void {
  writeFileSync(
    path.join(folder, '.devcontainer', 'devcontainer.json'),
    JSON.stringify({
      image: variable('HARNESS_DEVCONTAINER_IMAGE'),
      runArgs: runLabelArguments(),
      name: 'Shutdown',
      ...configuration,
    }),
  );
}

/** Opens `folder` in a new window and reopens it in its container, which is the one it already has. */
async function reopened(folder: string): Promise<string> {
  const window = await openFolderWindow(folder);
  await reopenInContainer(window);
  return window;
}

describe('the effective shutdownAction decides what the close does (card containers-69)', function () {
  this.timeout(900_000);

  it('F-0417 AC-1 (v1): an image configuration with no shutdownAction is stopped, Exited (0), 10 to 15 s after the window closes', async () => {
    const connected = await connectedWindow('c69-v1');
    try {
      const outcome = await closedAndWatched(connected, 20);
      deepStrictEqual(stoppedWithin(outcome, 0), true, JSON.stringify(outcome));
    } finally {
      await removeContainersOf(connected.folder);
    }
  });

  it('F-0417 AC-2, AC-9 (v2): stopContainer, and stopCompose on an image configuration, give the same result as no value', async () => {
    const results = [];
    for (const value of ['stopContainer', 'stopCompose']) {
      const connected = await connectedWindow(`c69-v2-${value}`, {
        shutdownAction: value,
      });
      try {
        results.push(stoppedWithin(await closedAndWatched(connected, 20), 0));
      } finally {
        await removeContainersOf(connected.folder);
      }
    }
    deepStrictEqual(results, [true, true]);
  });

  it('F-0417 AC-3 (v3): a Dockerfile configuration with no shutdownAction is stopped, Exited (0), 10 to 15 s after the close', async () => {
    const folder = devContainerFolder('c69-v3', {name: 'Shutdown'});
    writeFileSync(
      path.join(folder, '.devcontainer', 'Dockerfile'),
      `FROM ${variable('HARNESS_DEVCONTAINER_IMAGE')}\n`,
    );
    configure(folder, {build: {dockerfile: 'Dockerfile'}, image: undefined});
    const window = await openFolderWindow(folder);
    await reopenInContainer(window, 300_000);
    const [containerId = ''] = await devContainersOf(folder);
    try {
      const outcome = await closedAndWatched({window, folder, containerId}, 20);
      deepStrictEqual(stoppedWithin(outcome, 0), true, JSON.stringify(outcome));
    } finally {
      await removeContainersOf(folder);
    }
  });

  it('F-0417 AC-4, AC-65 (v4): none and a value that is no stop value, keepRunning, leave the container running for 60 s after the close', async () => {
    const results = [];
    for (const value of ['none', 'keepRunning']) {
      const connected = await connectedWindow(`c69-v4-${value}`, {
        shutdownAction: value,
      });
      try {
        results.push(stayedRunning(await closedAndWatched(connected, 60)));
      } finally {
        await removeContainersOf(connected.folder);
      }
    }
    deepStrictEqual(results, [true, true]);
  });

  it('F-0417 AC-70 (v70): null, false, 0 and the empty string stop the container as no value does, and 1 leaves it running for 40 s', async () => {
    const results: Array<[string, boolean]> = [];
    for (const [label, value] of [
      ['null', null],
      ['false', false],
      ['zero', 0],
      ['empty', ''],
    ] as const) {
      const connected = await connectedWindow(`c69-v70-${label}`, {
        shutdownAction: value,
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
    const numeric = await connectedWindow('c69-v70-one', {shutdownAction: 1});
    try {
      results.push(['one', stayedRunning(await closedAndWatched(numeric, 40))]);
    } finally {
      await removeContainersOf(numeric.folder);
    }
    deepStrictEqual(results, [
      ['null', true],
      ['false', true],
      ['zero', true],
      ['empty', true],
      ['one', true],
    ]);
  });

  it('F-0417 AC-8 (v8): none added to the file while the window is connected does not apply: the container is stopped as with no value', async () => {
    const connected = await connectedWindow('c69-v8');
    try {
      configure(connected.folder, {shutdownAction: 'none'});
      const outcome = await closedAndWatched(connected, 20);
      deepStrictEqual(stoppedWithin(outcome, 0), true, JSON.stringify(outcome));
    } finally {
      await removeContainersOf(connected.folder);
    }
  });

  it('F-0417 AC-7 (v7): a container made with none stays running after a reopen without a rebuild whose file no longer has it, and one made without it is stopped when the file says none', async () => {
    const kept = await connectedWindow('c69-v7-none', {
      shutdownAction: 'none',
    });
    const stopped = await connectedWindow('c69-v7-key');
    try {
      await closeWindow(kept.window);
      configure(kept.folder, {});
      const again = await reopened(kept.folder);
      const same = (await devContainersOf(kept.folder))[0] === kept.containerId;
      const keptOutcome =
        same &&
        stayedRunning(await closedAndWatched({...kept, window: again}, 40));
      await closeWindow(stopped.window);
      configure(stopped.folder, {shutdownAction: 'none'});
      const later = await reopened(stopped.folder);
      const sameStopped =
        (await devContainersOf(stopped.folder))[0] === stopped.containerId;
      // The first window's own check may come first, with the second one closed already: it stops the container then.
      const stoppedOutcome =
        sameStopped &&
        stoppedWithin(
          await closedAndWatched({...stopped, window: later}, 20),
          0,
          {
            from: 0,
            until: 15,
          },
        );
      deepStrictEqual([keptOutcome, stoppedOutcome], [true, true]);
    } finally {
      await removeContainersOf(kept.folder);
      await removeContainersOf(stopped.folder);
    }
  });

  it('F-0417 AC-5, AC-6 (v5): an image whose label says none keeps the container running, and a stop value in the file stops it', async () => {
    const folderOfImage = path.join(
      variable('HARNESS_RUN_FOLDER'),
      'c69-v5-image',
    );
    mkdirSync(folderOfImage, {recursive: true});
    writeFileSync(
      path.join(folderOfImage, 'Dockerfile'),
      `FROM ${variable('HARNESS_DEVCONTAINER_IMAGE')}\nLABEL devcontainer.metadata='[{"shutdownAction":"none"}]'\n`,
    );
    const imageTag = `c69-none-${variable('HARNESS_RUN_ID')}`.toLowerCase();
    await execFileAsync('docker', ['build', '-t', imageTag, folderOfImage]);
    const results = [];
    try {
      for (const [label, extra] of [
        ['label', {}],
        ['file', {shutdownAction: 'stopContainer'}],
      ] as const) {
        const connected = await connectedWindow(`c69-v5-${label}`, {
          image: imageTag,
          ...extra,
        });
        try {
          const outcome = await closedAndWatched(
            connected,
            label === 'label' ? 40 : 20,
          );
          results.push(
            label === 'label'
              ? stayedRunning(outcome)
              : stoppedWithin(outcome, 0),
          );
        } finally {
          await removeContainersOf(connected.folder);
        }
      }
      deepStrictEqual(results, [true, true]);
    } finally {
      await execFileAsync('docker', ['image', 'rm', '--force', imageTag]);
    }
  });
});
