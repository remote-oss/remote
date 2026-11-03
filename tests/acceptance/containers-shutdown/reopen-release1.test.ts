/**
 * @fileoverview The release-1 lines that waited on Reopen Folder Locally (card coverage-103, #1831): Close Remote
 * Connection (F-0906 AC-6), a stop while a lifecycle command runs (F-0417 AC-62), Reopen in Container before the
 * container has stopped (F-0409 AC-20) and a host folder whose name carries `#` (F-0501 AC-27).
 */

import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  closeWindow,
  devContainerFolder,
  devContainersOf,
  inWindow,
  nextEmptyWindow,
  reloadingCommand,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {
  dialogOf,
  notificationCentre,
  paletteRows,
  rememberPage,
  statusItem,
  vscodeWindowId,
  windowTitle,
} from '../windows/renderer.ts';
import {
  closeOtherWindows,
  connectedWindow,
  removeContainersOf,
  stateOf,
  stoppedWithin,
  watched,
} from './support.ts';

const execFileAsync = promisify(execFile);

const REOPEN_LOCALLY = 'remote-containers.reopenLocally';
const REOPEN_IN_CONTAINER = 'remote-containers.reopenInContainer';

/** The start of the reopen notification's message (F-0402). */
const NOTICE_START = 'Folder contains a Dev Container configuration file.';

/** The notices of window `name` other than the reopen notification. */
async function otherNotices(name: string): Promise<string[]> {
  return (await notificationCentre(name).catch(() => [])).filter(
    text => !text.startsWith(NOTICE_START),
  );
}

/** What `docker inspect` says of container `containerId` under the Go template `format`. */
async function inspected(containerId: string, format: string): Promise<string> {
  const {stdout} = await execFileAsync('docker', [
    'inspect',
    '--format',
    format,
    containerId,
  ]);
  return stdout.trim();
}

describe('the lines that waited on Reopen Folder Locally (card coverage-103)', function () {
  this.timeout(900_000);

  before(closeOtherWindows);

  it('F-0906 AC-6 (c103-close-remote): Close Remote Connection turns the same window into an empty local window within 2 s, with the title and indicator of a plain one, and the container exits 0 afterwards', async () => {
    await rememberPage('local');
    const connected = await connectedWindow('c103-close-remote');
    try {
      const plain = await statusItem('local', 'status.host');
      const plainTitle = await windowTitle('local');
      const identity = await vscodeWindowId(connected.window);
      const from = Date.now();
      const local = await nextEmptyWindow(() =>
        inWindow(connected.window, 'workbench.action.remote.close'),
      );
      const seconds = (Date.now() - from) / 1000;
      await rememberPage(local);
      const shown = await statusItem(local, 'status.host');
      const outcome = await watched(connected.containerId, 30, from);
      deepStrictEqual(
        {
          sameWindow: await vscodeWindowId(local),
          seconds: seconds < 2,
          title: await windowTitle(local),
          indicator: `${shown.text}|${shown.ariaLabel}`,
          remoteName: (await windowState(local)).remoteName,
          stopped: stoppedWithin(outcome, 0, {from: 0, until: 30}),
        },
        {
          sameWindow: identity,
          seconds: true,
          title: plainTitle,
          indicator: `${plain.text}|${plain.ariaLabel}`,
          remoteName: null,
          stopped: true,
        },
        JSON.stringify([seconds, identity]),
      );
      await closeWindow(local).catch(() => undefined);
    } finally {
      await closeWindow(connected.window).catch(() => undefined);
      await removeContainersOf(connected.folder);
    }
  });

  it('F-0417 AC-62 (c103-slow-command): with a lifecycle command still running, Reopen Folder Locally and Close Window each leave the container Exited (0) about 10 to 12 s later, and it stays stopped, with nothing shown', async () => {
    for (const [label, leave] of [
      ['reopen', (window: string) => reloadingCommand(window, REOPEN_LOCALLY)],
      ['close', (window: string) => closeWindow(window)],
    ] as const) {
      const connected = await connectedWindow(`c103-slow-${label}`, {
        postAttachCommand: 'sleep 60',
      });
      try {
        const running = await execFileAsync('docker', [
          'exec',
          connected.containerId,
          'sh',
          '-c',
          'ps -eo args | grep -c "[s]leep 60"',
        ]).then(
          ({stdout}) => Number(stdout.trim()),
          () => 0,
        );
        const from = Date.now();
        await leave(connected.window);
        const outcome = await watched(connected.containerId, 30, from);
        await new Promise(resolve => setTimeout(resolve, 30_000));
        deepStrictEqual(
          [
            running > 0,
            stoppedWithin(outcome, 0, {from: 9, until: 14}),
            await stateOf(connected.containerId),
            label === 'reopen' ? await otherNotices(connected.window) : [],
            label === 'reopen' ? await dialogOf(connected.window) : undefined,
          ],
          [true, true, {status: 'exited', exitCode: 0}, [], undefined],
          `${label}: ${JSON.stringify(outcome.states.slice(0, 16))}`,
        );
      } finally {
        await closeWindow(connected.window).catch(() => undefined);
        await removeContainersOf(connected.folder);
      }
    }
  });

  it('F-0409 AC-20 (c103-reopen-again): Reopen in Container right after Reopen Folder Locally connects to the same container without stopping or starting it, and it is still running 25 s later with no message', async () => {
    const connected = await connectedWindow('c103-again');
    try {
      const startedAt = await inspected(
        connected.containerId,
        '{{.State.StartedAt}}',
      );
      await reloadingCommand(connected.window, REOPEN_LOCALLY);
      await reloadingCommand(connected.window, REOPEN_IN_CONTAINER);
      await waitFor(
        'the window to be connected to the container again',
        async () =>
          (await windowState(connected.window).catch(() => undefined))
            ?.remoteName === 'dev-container',
        120_000,
      );
      await new Promise(resolve => setTimeout(resolve, 25_000));
      deepStrictEqual(
        {
          state: await stateOf(connected.containerId),
          startedAt: await inspected(
            connected.containerId,
            '{{.State.StartedAt}}',
          ),
          restarts: await inspected(connected.containerId, '{{.RestartCount}}'),
          notices: await otherNotices(connected.window),
          dialog: await dialogOf(connected.window),
          containers: (
            await execFileAsync('docker', [
              'ps',
              '-aq',
              '--no-trunc',
              '--filter',
              `label=devcontainer.local_folder=${connected.folder}`,
            ])
          ).stdout
            .split('\n')
            .filter(line => line !== '').length,
        },
        {
          state: {status: 'running', exitCode: 0},
          startedAt,
          restarts: '0',
          notices: [],
          dialog: undefined,
          containers: 1,
        },
      );
    } finally {
      await closeWindow(connected.window).catch(() => undefined);
      await removeContainersOf(connected.folder);
    }
  });

  it('F-0501 AC-27 (c103-hash-name): a host folder named with `#` and a space is mounted at /workspaces/<full name>, the authority carries the full host path, the window stays usable, and Reopen Folder Locally reopens exactly the host folder', async () => {
    const folder = devContainerFolder('c103 #x', {name: 'Hash'});
    const window = await openFolderWindow(folder);
    try {
      await reloadingCommand(window, REOPEN_IN_CONTAINER);
      // The window may end on a path core cannot open, so the wait is for the container and the connection to settle.
      await waitFor(
        'the container of the folder to run',
        async () => {
          const [found = ''] = await devContainersOf(folder);
          return (
            found !== '' &&
            (await stateOf(found)) !== 'gone' &&
            ((await stateOf(found)) as {status: string}).status === 'running'
          );
        },
        300_000,
      );
      await new Promise(resolve => setTimeout(resolve, 45_000));
      const [containerId = ''] = await devContainersOf(folder);
      const mounts = await inspected(
        containerId,
        '{{range .Mounts}}{{.Destination}}|{{end}}',
      );
      const inside = (await windowState(window)).folders[0] ?? '';
      const payload =
        /^vscode-remote:\/\/dev-container(?:\+|%2B)([0-9a-f]+)/i.exec(
          inside,
        )?.[1] ?? '';
      const decoded =
        payload === ''
          ? {}
          : (JSON.parse(Buffer.from(payload, 'hex').toString('utf8')) as {
              hostPath?: string;
            });
      const dialog = await dialogOf(window);
      const usable =
        (await paletteRows(window, 'Reopen Folder Locally')).length > 0;
      await reloadingCommand(window, REOPEN_LOCALLY);
      const local = await windowState(window);
      deepStrictEqual(
        {
          mounted: mounts
            .split('|')
            .includes(`/workspaces/${path.basename(folder)}`),
          hostPath: decoded.hostPath,
          dialogOk: dialog === undefined || dialog.buttons.includes('Cancel'),
          usable,
          reopened: [
            local.remoteName,
            decodeURIComponent(
              (local.folders[0] ?? '').replace(/^file:\/\//, ''),
            ),
          ],
        },
        {
          mounted: true,
          hostPath: folder,
          dialogOk: true,
          usable: true,
          reopened: [null, folder],
        },
        JSON.stringify([mounts, inside, dialog]),
      );
    } finally {
      await closeWindow(window).catch(() => undefined);
      await removeContainersOf(folder);
    }
  });
});
