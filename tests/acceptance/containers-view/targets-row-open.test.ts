import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  connectedToContainer,
  devContainerFolder,
  devContainersOf,
  inWindow,
  isOpen,
  reopenInContainer,
  runLabelArguments,
  variable,
  waitFor,
  windowNames,
  windowState,
} from '../windows/harness.ts';
import {
  dialogOf,
  notifications,
  rowActionTitles,
  rowContextMenu,
  rowMenuAction,
  waitForDialog,
  windowTitle,
} from '../windows/renderer.ts';
import {
  activations,
  clearEarlierRows,
  openFolderWindow,
  removeContainers,
} from '../windows/folder-windows.ts';
import {
  chosen,
  docker,
  iconReaches,
  rowsWhen,
  stateOf,
  VIEW,
  viewed,
} from '../windows/dev-containers-view.ts';

const CURRENT = 'Open in Container in Current Window';
const NEW_WINDOW = 'Open in Container in New Window';

/** The windows that are open now. */
function openWindows(): string[] {
  return windowNames().filter(isOpen).sort();
}

/**
 * Opens a window on a new folder with a dev container configuration (named `Open <base>`), connects it to the folder's
 * container and closes it again; the container is left running, or stopped. The row of `base` is then in the view.
 */
async function dormant(
  base: string,
  options: {stopped: boolean; configuration?: Record<string, unknown>},
): Promise<{folder: string; container: string}> {
  const folder = devContainerFolder(base, {
    name: `Open ${base}`,
    shutdownAction: 'none',
    ...options.configuration,
  });
  const window = await openFolderWindow(folder);
  await reopenInContainer(window);
  const [container = ''] = await devContainersOf(folder);
  await closeWindow(window);
  if (options.stopped) {
    await docker('stop', '--time', '0', container);
  }
  return {folder, container};
}

/** The title core gives a container window of `base`. */
function titleOf(base: string): string {
  return `[${base} [Dev Container: Open ${base}]]`;
}

/** Waits until window `name` has activated its agent once more than `before`. */
function reactivated(name: string, before: number): Promise<void> {
  return waitFor(
    `window ${name} to open`,
    () => activations(name) > before,
    120_000,
  );
}

describe('Open in Container from the rows of the Dev Containers view (card containers-103)', function () {
  this.timeout(600_000);

  beforeEach(async () => {
    await clearEarlierRows();
    await inWindow('local', 'notifications.clearAll');
  });

  it('F-0902 AC-6 (new-window-exited): Open in Container in New Window on an exited row asks nothing, starts the same container, opens one more connected window with the container’s title, and leaves the issuing window as it was', async () => {
    const base = 'ro-new-exited';
    const {folder, container} = await dormant(base, {stopped: true});
    await viewed(base);
    await iconReaches('local', base, 'vm');
    const windows = openWindows();
    const before = activations(base);
    const issuing = activations('local');
    await chosen(base, NEW_WINDOW);
    await reactivated(base, before);
    await connectedToContainer(base);
    try {
      deepStrictEqual(
        [
          await devContainersOf(folder),
          await stateOf(container),
          openWindows().length - windows.length,
          await windowTitle(base),
          await dialogOf('local'),
          activations('local'),
          (await windowState('local')).remoteName,
        ],
        [[container], 'running', 1, titleOf(base), undefined, issuing, null],
      );
    } finally {
      await closeWindow(base).catch(() => undefined);
      await removeContainers(folder);
    }
  });

  it('F-0902 AC-17 (current-window): Open in Container in Current Window from an unconnected window connects that window to the container in place and opens no other window', async () => {
    const base = 'ro-current';
    const {folder, container} = await dormant(base, {stopped: true});
    const issuer = await openFolderWindow(
      devContainerFolder('ro-current-from'),
    );
    try {
      await inWindow(issuer, 'workbench.view.remote');
      await rowsWhen(issuer, rows => rows.some(each => each.label === base));
      const windows = openWindows();
      const before = activations(base);
      await rowMenuAction(issuer, VIEW, base, CURRENT);
      await reactivated(base, before);
      await connectedToContainer(base);
      deepStrictEqual(
        [
          await devContainersOf(folder),
          await stateOf(container),
          openWindows().length,
          openWindows().includes(issuer),
          await windowTitle(base),
        ],
        [[container], 'running', windows.length, false, titleOf(base)],
      );
    } finally {
      await closeWindow(base).catch(() => undefined);
      await closeWindow(issuer).catch(() => undefined);
      await removeContainers(folder);
    }
  });

  it('F-0902 AC-34 (running-row): Open in Container in New Window on a running row opens a connected window and does not restart the container', async () => {
    const base = 'ro-running';
    const {folder, container} = await dormant(base, {stopped: false});
    const startedAt = await docker(
      'inspect',
      '--format',
      '{{.State.StartedAt}}',
      container,
    );
    await viewed(base);
    await iconReaches('local', base, 'vm-running');
    const before = activations(base);
    await chosen(base, NEW_WINDOW);
    await reactivated(base, before);
    await connectedToContainer(base);
    try {
      deepStrictEqual(
        [
          await docker(
            'inspect',
            '--format',
            '{{.State.StartedAt}}',
            container,
          ),
          await devContainersOf(folder),
        ],
        [startedAt, [container]],
      );
    } finally {
      await closeWindow(base).catch(() => undefined);
      await removeContainers(folder);
    }
  });

  it('F-0902 AC-35 (connected-elsewhere): Open in Container in New Window on the row of a container another window is connected to opens no window, shows no dialog or notification and makes no second container', async () => {
    const base = 'ro-elsewhere';
    const folder = devContainerFolder(base, {name: `Open ${base}`});
    const connected = await openFolderWindow(folder);
    try {
      await reopenInContainer(connected);
      await viewed(base);
      const windows = openWindows();
      await chosen(base, NEW_WINDOW);
      await new Promise(resolve => setTimeout(resolve, 8_000));
      deepStrictEqual(
        [
          openWindows(),
          await dialogOf('local'),
          await notifications('local'),
          (await devContainersOf(folder)).length,
        ],
        [windows, undefined, [], 1],
      );
    } finally {
      await closeWindow(connected).catch(() => undefined);
      await removeContainers(folder);
    }
  });

  it('F-0902 AC-57 (port-held): Open in Container in New Window on an exited row whose host port another container holds starts nothing, shows the issuing window nothing, and the new window shows the connection error with the port detail', async () => {
    const base = 'ro-port';
    const probe = await docker(
      'run',
      '--detach',
      ...runLabelArguments(),
      '--publish',
      '127.0.0.1::80',
      variable('HARNESS_DEVCONTAINER_IMAGE'),
      'sleep',
      '600',
    );
    const port = (await docker('port', probe, '80/tcp')).split(':').pop();
    await docker('rm', '--force', probe);
    const {folder, container} = await dormant(base, {
      stopped: true,
      configuration: {
        runArgs: [
          ...runLabelArguments(),
          '--publish',
          `127.0.0.1:${String(port)}:80`,
        ],
      },
    });
    await docker(
      'run',
      '--detach',
      ...runLabelArguments(),
      '--publish',
      `127.0.0.1:${String(port)}:80`,
      variable('HARNESS_DEVCONTAINER_IMAGE'),
      'sleep',
      '600',
    );
    await viewed(base);
    await iconReaches('local', base, 'vm');
    const before = activations(base);
    await chosen(base, NEW_WINDOW);
    await reactivated(base, before);
    try {
      const modal = await waitForDialog(base, 180_000);
      deepStrictEqual(
        [
          modal.details,
          await stateOf(container),
          await dialogOf('local'),
          await notifications('local'),
        ],
        [
          'A port the container is setup to bind to is already in use. See the Dev Containers terminal for details.',
          'exited',
          undefined,
          [],
        ],
      );
    } finally {
      await closeWindow(base).catch(() => undefined);
      await removeContainers(folder);
    }
  });

  it('F-0901 AC-6 (open-items): an exited dev container row seen from an unconnected window shows Open in Current Window, Open in New Window and Remove as inline actions, and the two Open items in the first group of its menu', async () => {
    const base = 'ro-items';
    const {folder} = await dormant(base, {stopped: true});
    try {
      await viewed(base);
      await iconReaches('local', base, 'vm');
      const menu = (await rowContextMenu('local', VIEW, base)).filter(
        label => label !== '',
      );
      deepStrictEqual(
        [
          await rowActionTitles('local', VIEW, base),
          menu.filter(label => [CURRENT, NEW_WINDOW].includes(label)),
          menu.indexOf(NEW_WINDOW) < menu.indexOf('Remove Container'),
        ],
        [
          [CURRENT, NEW_WINDOW, 'Remove Container'],
          [CURRENT, NEW_WINDOW],
          true,
        ],
      );
    } finally {
      await removeContainers(folder);
    }
  });
});
