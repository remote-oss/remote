import {writeFileSync} from 'node:fs';
import {connect, createServer} from 'node:net';
import path from 'node:path';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';
import {
  closeWindow,
  commandsOf,
  connectedToContainer,
  devContainerFolder,
  inWindow,
  reloadWindow,
  reopenInContainer,
  runLabelArguments,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {portsRows, type PortsRow} from '../windows/renderer.ts';

/** The command that focuses core's Ports view. */
const FOCUS_PORTS = '~remote.forwardedPorts.focus';

/** A port nothing on this machine listens on, from the range the system hands out. */
export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port =
        typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => {
        resolve(port);
      });
    });
  });
}

/** Whether a connection to `address` (`host:port`) is answered with what it sent. */
export function echoes(address: string): Promise<boolean> {
  const port = Number(address.slice(address.lastIndexOf(':') + 1));
  return new Promise(resolve => {
    const socket = connect({host: '127.0.0.1', port});
    socket.setTimeout(5000);
    socket.once('connect', () => {
      socket.write('ping\n');
    });
    socket.once('data', data => {
      socket.destroy();
      resolve(data.toString().includes('ping'));
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      resolve(false);
    });
  });
}

/** Shows the Ports view of window `window` once core has made it. */
export async function showPorts(window: string): Promise<void> {
  await waitFor(
    'core to register the Ports view',
    async () => (await commandsOf(window, FOCUS_PORTS)).includes(FOCUS_PORTS),
    30_000,
  );
  await inWindow(window, FOCUS_PORTS);
}

/** The rows of the Ports view of window `window` once `ready` holds for them, or whatever they are after 30 s. */
export async function rowsWhen(
  window: string,
  ready: (rows: PortsRow[]) => boolean,
): Promise<PortsRow[]> {
  let rows: PortsRow[] = [];
  await waitFor(
    'the Ports rows',
    async () => {
      rows = await portsRows(window).catch(() => []);
      return ready(rows);
    },
    30_000,
  ).catch(() => undefined);
  return rows;
}

/** The ports of the rows. */
export function portsOf(rows: readonly PortsRow[]): string[] {
  return rows.map(shown => shown.port);
}

/** The folder of the window `name` opened by `connectedWith`. */
export function folderOf(name: string): string {
  return path.join(variable('HARNESS_RUN_FOLDER'), name);
}

/** Writes `configuration` over the folder's devcontainer.json, as an edit of the file the window shows. */
export function editConfiguration(
  folder: string,
  configuration: Readonly<Record<string, unknown>>,
): void {
  writeFileSync(
    path.join(folder, '.devcontainer', 'devcontainer.json'),
    JSON.stringify({
      image: variable('HARNESS_DEVCONTAINER_IMAGE'),
      runArgs: runLabelArguments(),
      name: 'Forwards',
      ...configuration,
    }),
  );
}

/** Reloads window `window` and waits until it is connected to its container again. */
export async function reloaded(window: string): Promise<void> {
  await reloadWindow(window);
  await connectedToContainer(window);
}

/**
 * Called inside a `describe`: closes the windows and removes the containers its `connectedWith` made after each row,
 * and gives that function, which opens a folder with `configuration` in a window and connects it to its container.
 */
export function portsWindows(): {
  connectedWith: (
    name: string,
    configuration: Readonly<Record<string, unknown>>,
  ) => Promise<string>;
  /** Closes `window` now, so that the clean-up after the row does not. */
  closeNow: (window: string) => Promise<void>;
} {
  const opened: string[] = [];
  const folders: string[] = [];
  afterEach(async () => {
    for (const window of opened.splice(0)) {
      await closeWindow(window);
    }
    for (const folder of folders.splice(0)) {
      await removeContainers(folder);
    }
  });
  return {
    connectedWith: async (name, configuration) => {
      const folder = devContainerFolder(name, {
        name: 'Forwards',
        ...configuration,
      });
      folders.push(folder);
      const window = await openFolderWindow(folder);
      opened.push(window);
      await reopenInContainer(window);
      return window;
    },
    closeNow: async window => {
      opened.splice(opened.indexOf(window), 1);
      await closeWindow(window);
    },
  };
}
