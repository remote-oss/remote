import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {
  closeWindow,
  connectedToContainer,
  containersLog,
  devContainersOf,
  openEmptyWindows,
  reopenInContainer,
  startInWindow,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {notificationCentre} from '../windows/renderer.ts';
import {
  closedAndWatched,
  connectedWindow,
  removeContainersOf,
  stateOf,
  stayedRunning,
  stoppedWithin,
  watched,
} from './support.ts';

/** The lines of `file` in the folder, none when it does not exist yet. */
function linesOf(folder: string, file: string): string[] {
  try {
    return readFileSync(path.join(folder, file), 'utf8')
      .split('\n')
      .filter(line => line !== '');
  } catch {
    return [];
  }
}

describe('what a window close and a reopen do to a dev container (card coverage-101)', function () {
  this.timeout(600_000);

  it('F-0501 AC-12, F-0409 AC-5 (c101-close-reopen): closing the window stops its container with exit 0 and does not remove it, and reopening the folder starts the same container again with no rebuild and no message', async () => {
    const connected = await connectedWindow('c101-close-reopen');
    try {
      const outcome = await closedAndWatched(connected, 18);
      const mark = containersLog().length;
      const began = Date.now();
      const window = await openFolderWindow(connected.folder);
      await reopenInContainer(window);
      const seconds = (Date.now() - began) / 1000;
      deepStrictEqual(
        {
          stopped: stoppedWithin(outcome, 0),
          present: (await devContainersOf(connected.folder)).length,
          same:
            (await devContainersOf(connected.folder))[0] ===
            connected.containerId,
          running: (await stateOf(connected.containerId)) !== 'gone',
          built: containersLog()
            .slice(mark)
            .filter(line => /build|creating container/i.test(line)),
          notices: (await notificationCentre(window)).filter(
            text => !text.startsWith('Setting up'),
          ),
          seconds: seconds < 60,
        },
        {
          stopped: true,
          present: 1,
          same: true,
          running: true,
          built: [],
          notices: [],
          seconds: true,
        },
        JSON.stringify(outcome),
      );
      await closeWindow(window);
    } finally {
      await removeContainersOf(connected.folder);
    }
  });

  it('F-0502 AC-14 (c101-close-remote): Close Remote Connection leaves an empty local window with no remote and no folder, and about 10 s later the container is exited with code 0 and still present', async () => {
    const connected = await connectedWindow('c101-close-remote');
    try {
      const known = openEmptyWindows();
      const from = Date.now();
      void startInWindow(connected.window, 'workbench.action.remote.close');
      let local = '';
      await waitFor(
        'the window to be an empty local window',
        () => {
          local = openEmptyWindows().find(each => !known.includes(each)) ?? '';
          return local !== '';
        },
        60_000,
      );
      const state = await windowState(local);
      const outcome = await watched(connected.containerId, 24, from);
      deepStrictEqual(
        [
          [state.remoteName, state.folders],
          stoppedWithin(outcome, 0, {from: 9, until: 19}),
          (await devContainersOf(connected.folder)).length,
        ],
        [[null, []], true, 1],
        JSON.stringify(outcome),
      );
    } finally {
      await closeWindow(connected.window).catch(() => undefined);
      await removeContainersOf(connected.folder);
    }
  });

  it('F-0415 AC-39 (c101-none-reopen): with shutdownAction none a closed window leaves the container running, and the reopened window runs only initializeCommand and postAttachCommand again', async () => {
    const connected = await connectedWindow('c101-none-reopen', {
      shutdownAction: 'none',
      initializeCommand: 'echo x >> marker-initialize',
      onCreateCommand: 'echo x >> marker-create',
      postCreateCommand: 'echo x >> marker-post-create',
      postStartCommand: 'echo x >> marker-post-start',
      postAttachCommand: 'echo x >> marker-post-attach',
    });
    try {
      const first = [
        'marker-initialize',
        'marker-create',
        'marker-post-create',
        'marker-post-start',
        'marker-post-attach',
      ].map(file => linesOf(connected.folder, file).length);
      const outcome = await closedAndWatched(connected, 20);
      const window = await openFolderWindow(connected.folder);
      await reopenInContainer(window);
      await waitFor(
        'the post attach command to have run again',
        () => linesOf(connected.folder, 'marker-post-attach').length >= 2,
        60_000,
      );
      const counts = [
        'marker-initialize',
        'marker-create',
        'marker-post-create',
        'marker-post-start',
        'marker-post-attach',
      ].map(file => linesOf(connected.folder, file).length);
      deepStrictEqual(
        [
          first,
          stayedRunning(outcome),
          counts,
          (await windowState(window)).remoteName,
        ],
        [[1, 1, 1, 1, 1], true, [2, 1, 1, 1, 2], 'dev-container'],
        JSON.stringify(outcome),
      );
      await connectedToContainer(window);
      await closeWindow(window);
    } finally {
      await removeContainersOf(connected.folder);
    }
  });
});
