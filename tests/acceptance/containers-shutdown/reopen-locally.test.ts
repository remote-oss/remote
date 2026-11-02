import {deepStrictEqual} from 'node:assert';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {
  closeWindow,
  inWindow,
  isOpen,
  nextEmptyWindow,
  reloadingCommand,
  waitFor,
  windowNames,
  windowState,
} from '../windows/harness.ts';
import {
  dialogOf,
  notificationCentre,
  paletteRows,
  statusItem,
  windowTitle,
} from '../windows/renderer.ts';
import {
  connectedWindow,
  removeContainersOf,
  stateOf,
  stayedRunning,
  stoppedWithin,
  watched,
} from './support.ts';

const execFileAsync = promisify(execFile);

/** The four commands that reopen the folder elsewhere, by their ids. */
const REOPEN_LOCALLY = 'remote-containers.reopenLocally';
const REOPEN_IN_SSH = 'remote-containers.reopenInSSH';
const REOPEN_IN_WSL = 'remote-containers.reopenInWSL';
const REOPEN_IN_TUNNEL = 'remote-containers.reopenInTunnel';

/** The start of the reopen notification's message (F-0402). */
const NOTICE_START = 'Folder contains a Dev Container configuration file.';

/** The palette labels of the four commands, which no window but a dev container's lists. */
const OWNED_LABELS = [
  'Dev Containers: Reopen Folder Locally',
  'Dev Containers: Reopen Folder in SSH',
  'Dev Containers: Reopen Folder in WSL',
  'Dev Containers: Reopen Folder in Tunnel',
];

/** Whether window `name` shows the reopen notification within `milliseconds`. */
async function showsNotice(
  name: string,
  milliseconds: number,
): Promise<boolean> {
  try {
    await waitFor(
      `the reopen notification in ${name}`,
      async () =>
        (await notificationCentre(name).catch(() => [])).some(text =>
          text.startsWith(NOTICE_START),
        ),
      milliseconds,
    );
    return true;
  } catch {
    return false;
  }
}

/** What a window shows of itself, as the rows compare it: its title, its remote indicator and its remote name. */
async function shownBy(name: string): Promise<{
  title: string;
  indicator: string;
  remoteName: string | null;
}> {
  const indicator = await statusItem(name, 'status.host');
  return {
    title: await windowTitle(name),
    indicator: `${indicator.text}|${indicator.ariaLabel}`,
    remoteName: (await windowState(name)).remoteName,
  };
}

/** The windows open now. */
function openWindows(): string[] {
  return windowNames().filter(isOpen).sort();
}

/** Waits until window `name` is open, with the remote name `remoteName` (null for a local window). */
async function openWith(
  name: string,
  remoteName: string | null,
): Promise<void> {
  await waitFor(
    `window ${name} to be open${remoteName === null ? ' and local' : ` on ${remoteName}`}`,
    async () =>
      isOpen(name) &&
      (await windowState(name).catch(() => undefined))?.remoteName ===
        remoteName,
    180_000,
  );
}

describe('Reopen Folder Locally from a dev container window (card coverage-103, F-0406)', function () {
  this.timeout(900_000);

  it('F-0406 AC-1, AC-2, AC-3, AC-20, AC-22, F-0417 AC-54 (c103-reopen): the same window reloads on the origin folder with the default local indicator and the reopen notification back, offers Reopen in Container and the rebuild pair and none of the four commands, and the container is exited 0 about 11 s later', async () => {
    const connected = await connectedWindow('c103-reopen');
    try {
      const plain = await statusItem('local', 'status.host');
      const windowsBefore = openWindows();
      const from = Date.now();
      await reloadingCommand(connected.window, REOPEN_LOCALLY);
      const seconds = (Date.now() - from) / 1000;
      const state = await windowState(connected.window);
      const palette = await paletteRows(connected.window, 'Dev Containers');
      const after = await shownBy(connected.window);
      const outcome = await watched(connected.containerId, 30, from);
      deepStrictEqual(
        {
          shown: after,
          folders: state.folders.map(entry => path.basename(entry)),
          sameWindows: openWindows().join(),
          seconds: seconds < 10,
          dialog: await dialogOf(connected.window),
          notice: await showsNotice(connected.window, 15_000),
          palette: palette.filter(
            label =>
              label.includes('Reopen') ||
              label.includes('Rebuild') ||
              OWNED_LABELS.includes(label),
          ),
          stopped: stoppedWithin(outcome, 0, {from: 9, until: 14}),
        },
        {
          shown: {
            title: `[${path.basename(connected.folder)}]`,
            indicator: `${plain.text}|${plain.ariaLabel}`,
            remoteName: null,
          },
          folders: [path.basename(connected.folder)],
          sameWindows: windowsBefore.join(),
          seconds: true,
          dialog: undefined,
          notice: true,
          palette: [
            'Dev Containers: Rebuild and Reopen in Container',
            'Dev Containers: Rebuild Without Cache and Reopen in Container',
            'Dev Containers: Reopen in Container',
            "Dev Containers: Reset Don't Show Reopen Notification",
          ],
          stopped: true,
        },
        JSON.stringify(outcome.states.slice(0, 16)),
      );
    } finally {
      await closeWindow(connected.window).catch(() => undefined);
      await removeContainersOf(connected.folder);
    }
  });

  it('F-0406 AC-26 (c103-none): with shutdownAction none the window reloads as in the default case and the container is still up after 40 s', async () => {
    const connected = await connectedWindow('c103-none', {
      shutdownAction: 'none',
    });
    try {
      const from = Date.now();
      await reloadingCommand(connected.window, REOPEN_LOCALLY);
      const after = await shownBy(connected.window);
      const notice = await showsNotice(connected.window, 15_000);
      const outcome = await watched(connected.containerId, 40, from);
      deepStrictEqual(
        [
          after.title,
          after.remoteName,
          notice,
          stayedRunning(outcome),
          await dialogOf(connected.window),
        ],
        [`[${path.basename(connected.folder)}]`, null, true, true, undefined],
        JSON.stringify(outcome.states.slice(-3)),
      );
    } finally {
      await closeWindow(connected.window).catch(() => undefined);
      await removeContainersOf(connected.folder);
    }
  });

  it('F-0406 AC-34 (c103-subfolder): a window on a subfolder inside the container, or on a path that exists only there, reopens locally on the original host folder, with no S009, the notification back and the container stopped', async () => {
    const connected = await connectedWindow('c103-subfolder');
    mkdirSync(path.join(connected.folder, 'sub1'));
    await execFileAsync('docker', [
      'exec',
      connected.containerId,
      'mkdir',
      '-p',
      '/srv/other',
    ]);
    const inside = `/workspaces/${path.basename(connected.folder)}`;
    const seen: unknown[] = [];
    try {
      for (const [target, name] of [
        [`${inside}/sub1`, 'sub1'],
        ['/srv/other', 'other'],
      ] as const) {
        // The window names itself by its folder, so it has the new name once it has reloaded on the new folder.
        void inWindow(
          connected.window,
          'acceptance.agent.openHere',
          target,
        ).catch(() => undefined);
        await openWith(name, 'dev-container');
        const opened = await shownBy(name);
        const from = Date.now();
        await reloadingCommand(name, REOPEN_LOCALLY).catch(() => undefined);
        await openWith(path.basename(connected.folder), null);
        const local = await shownBy(connected.window);
        const outcome = await watched(connected.containerId, 24, from);
        seen.push([
          opened.title,
          local.title,
          local.remoteName,
          (await windowState(connected.window)).folders.map(entry =>
            path.basename(entry),
          ),
          await showsNotice(connected.window, 15_000),
          (await notificationCentre(connected.window)).filter(
            text => !text.startsWith(NOTICE_START),
          ),
          await dialogOf(connected.window),
          stoppedWithin(outcome, 0, {from: 0, until: 24}),
        ]);
        if (name === 'sub1') {
          await reloadingCommand(
            connected.window,
            'remote-containers.reopenInContainer',
          );
        }
      }
      const origin = path.basename(connected.folder);
      deepStrictEqual(seen, [
        [
          `[sub1 [Dev Container: Shutdown]]`,
          `[${origin}]`,
          null,
          [origin],
          true,
          [],
          undefined,
          true,
        ],
        [
          `[other [Dev Container: Shutdown]]`,
          `[${origin}]`,
          null,
          [origin],
          true,
          [],
          undefined,
          true,
        ],
      ]);
    } finally {
      await closeWindow(connected.window).catch(() => undefined);
      await removeContainersOf(connected.folder);
    }
  });

  it('F-0406 AC-36 (c103-two-windows): with two windows on one container, a reopen from the second after the first has reopened leaves it connected, the container up and no window added', async () => {
    const connected = await connectedWindow('c103-two');
    mkdirSync(path.join(connected.folder, 'sub2'));
    try {
      // A window is named by its folder, so the second window opens a subfolder of the same container to have a name of its own.
      const second = 'sub2';
      void inWindow(
        connected.window,
        'acceptance.agent.openHere',
        `/workspaces/${path.basename(connected.folder)}/sub2`,
        true,
      ).catch(() => undefined);
      await waitFor(
        'the second window on the container',
        () => isOpen(second),
        180_000,
      );
      await waitFor(
        'the second window to be connected',
        async () =>
          (await windowState(second).catch(() => undefined))?.remoteName ===
          'dev-container',
        180_000,
      );
      await reloadingCommand(connected.window, REOPEN_LOCALLY);
      const firstWindow = await shownBy(connected.window);
      const windowsMid = openWindows();
      const secondBefore = await shownBy(second);
      void inWindow(second, REOPEN_LOCALLY).catch(() => undefined);
      await new Promise(resolve => setTimeout(resolve, 30_000));
      deepStrictEqual(
        {
          second: await shownBy(second),
          noticeInSecond: (await notificationCentre(second)).filter(text =>
            text.startsWith(NOTICE_START),
          ),
          dialog: await dialogOf(second),
          windows: openWindows(),
          first: await shownBy(connected.window),
          running: (await stateOf(connected.containerId)) !== 'gone',
          status:
            (await stateOf(connected.containerId)) === 'gone'
              ? 'gone'
              : ((await stateOf(connected.containerId)) as {status: string})
                  .status,
        },
        {
          second: secondBefore,
          noticeInSecond: [],
          dialog: undefined,
          windows: windowsMid,
          first: firstWindow,
          running: true,
          status: 'running',
        },
      );
      await closeWindow(second).catch(() => undefined);
    } finally {
      await closeWindow(connected.window).catch(() => undefined);
      await removeContainersOf(connected.folder);
    }
  });

  it('F-0406 AC-8, AC-24, AC-9 (c103-close-workspace): Close Workspace from the palette leaves a window with no folder attached to the container; Reopen Folder Locally then does nothing for 12 s; Close Remote Connection makes it an empty local window and the container exits 0', async () => {
    const connected = await connectedWindow('c103-close');
    try {
      // Without a folder the window is named as an empty one.
      const folderless = await nextEmptyWindow(() =>
        inWindow(connected.window, 'workbench.action.closeFolder'),
      );
      const closed = await shownBy(folderless);
      const state = await windowState(folderless);
      const before = openWindows();
      void inWindow(folderless, REOPEN_LOCALLY).catch(() => undefined);
      await new Promise(resolve => setTimeout(resolve, 12_000));
      const afterNoop = {
        shown: await shownBy(folderless),
        notices: await notificationCentre(folderless),
        dialog: await dialogOf(folderless),
        windows: openWindows(),
      };
      const from = Date.now();
      const empty = await nextEmptyWindow(() =>
        inWindow(folderless, 'workbench.action.remote.close'),
      );
      const outcome = await watched(connected.containerId, 30, from);
      deepStrictEqual(
        {
          closed: [closed.remoteName, state.folders],
          noop: [
            afterNoop.shown.remoteName,
            afterNoop.shown.title === closed.title,
            afterNoop.notices,
            afterNoop.dialog,
            afterNoop.windows,
          ],
          emptyState: [(await windowState(empty)).remoteName],
          stopped: stoppedWithin(outcome, 0, {from: 0, until: 30}),
        },
        {
          closed: ['dev-container', []],
          noop: ['dev-container', true, [], undefined, before],
          emptyState: [null],
          stopped: true,
        },
        JSON.stringify(closed),
      );
      await closeWindow(empty).catch(() => undefined);
    } finally {
      await closeWindow(connected.window).catch(() => undefined);
      await removeContainersOf(connected.folder);
    }
  });

  it('F-0406 AC-32 (c103-not-possible): in a window on the local Docker host the SSH, WSL and Tunnel commands show their information notice with no button and change nothing', async () => {
    const connected = await connectedWindow('c103-impossible');
    try {
      const before = await shownBy(connected.window);
      const seen: unknown[] = [];
      for (const [command, text] of [
        [REOPEN_IN_SSH, "'Reopen in SSH' not possible in current context."],
        [REOPEN_IN_WSL, "'Reopen in WSL' not possible in current context."],
        [
          REOPEN_IN_TUNNEL,
          "'Reopen in Tunnel' not possible in current context.",
        ],
      ] as const) {
        void inWindow(connected.window, command).catch(() => undefined);
        await waitFor(
          `the notice of ${command}`,
          async () =>
            (await notificationCentre(connected.window)).some(each =>
              each.includes(text),
            ),
          30_000,
        );
        seen.push(
          (await notificationCentre(connected.window)).filter(each =>
            each.includes('not possible in current context'),
          ).length,
        );
      }
      deepStrictEqual(
        [
          seen,
          await shownBy(connected.window),
          await stateOf(connected.containerId),
        ],
        [[1, 2, 3], before, {status: 'running', exitCode: 0}],
      );
    } finally {
      await closeWindow(connected.window).catch(() => undefined);
      await removeContainersOf(connected.folder);
    }
  });
});
