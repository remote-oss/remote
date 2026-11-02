import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  devContainersOf,
  reloadingCommand,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {dialogOf, notificationCentre} from '../windows/renderer.ts';
import {
  connectedWindow,
  removeContainersOf,
  stoppedWithin,
  watched,
} from './support.ts';

/** The start of the discovery notification that offers to reopen a folder in a container. */
const DISCOVERY = 'Folder contains a Dev Container configuration file.';

/** The notifications of window `name` that are not the discovery offer. */
async function otherNotices(name: string): Promise<string[]> {
  return (await notificationCentre(name)).filter(
    text => !text.startsWith(DISCOVERY),
  );
}

describe('Reopen Folder Locally from a dev container window (card coverage-101)', function () {
  this.timeout(600_000);

  it('F-0101 AC-7, F-0301 AC-48 (c101-reopen-locally): in a connected window the discovery offer is not shown, and Reopen Folder Locally reloads the window to local, shows the offer again, and stops the container with exit 0 without removing it', async () => {
    const connected = await connectedWindow('c101-rl1');
    try {
      await new Promise(resolve => setTimeout(resolve, 5_000));
      const offeredBefore = (await notificationCentre(connected.window)).some(
        text => text.startsWith(DISCOVERY),
      );
      const from = Date.now();
      await reloadingCommand(
        connected.window,
        'remote-containers.reopenLocally',
      );
      await waitFor(
        'the discovery offer in the local window',
        async () =>
          (await notificationCentre(connected.window)).some(text =>
            text.startsWith(DISCOVERY),
          ),
        60_000,
      );
      const state = await windowState(connected.window);
      const outcome = await watched(connected.containerId, 20, from);
      deepStrictEqual(
        [
          offeredBefore,
          [state.remoteName, state.folders.length],
          stoppedWithin(outcome, 0),
          (await devContainersOf(connected.folder)).length,
        ],
        [false, [null, 1], true, 1],
        JSON.stringify(outcome),
      );
    } finally {
      await closeWindow(connected.window).catch(() => undefined);
      await removeContainersOf(connected.folder);
    }
  });

  it('F-0417 AC-62 (c101-reopen-locally-running): Reopen Folder Locally while a postCreateCommand still runs leaves the container Exited (0) about ten seconds on, stopped, and shows nothing but the discovery offer', async () => {
    const connected = await connectedWindow('c101-rl2', {
      postCreateCommand: 'sleep 60',
    });
    try {
      const from = Date.now();
      await reloadingCommand(
        connected.window,
        'remote-containers.reopenLocally',
      );
      await waitFor(
        'the discovery offer in the local window',
        async () =>
          (await notificationCentre(connected.window)).some(text =>
            text.startsWith(DISCOVERY),
          ),
        60_000,
      );
      const outcome = await watched(connected.containerId, 24, from);
      deepStrictEqual(
        [
          stoppedWithin(outcome, 0, {from: 9, until: 19}),
          outcome.states.at(-1),
          await otherNotices(connected.window),
          await dialogOf(connected.window),
        ],
        [true, {status: 'exited', exitCode: 0}, [], undefined],
        JSON.stringify(outcome),
      );
    } finally {
      await closeWindow(connected.window).catch(() => undefined);
      await removeContainersOf(connected.folder);
    }
  });
});
