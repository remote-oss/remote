import {execFile} from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {connect, createServer, type Server} from 'node:net';
import path from 'node:path';
import {promisify} from 'node:util';
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
import {answerInputBox, portsRows, type PortsRow} from '../windows/renderer.ts';

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

/** The promisified docker runner of this suite. */
const execFileAsync = promisify(execFile);

/**
 * The run's recording `xdg-open`: the containers-ports launch puts the run's `xdg-bin` first on the editor's PATH,
 * so a browser or preview ask lands in the log. The script is installed fresh with an empty log, and the log's
 * path comes back.
 */
export function recordBrowserOpens(): string {
  const binFolder = path.join(variable('HARNESS_RUN_FOLDER'), 'xdg-bin');
  const logFile = path.join(variable('HARNESS_RUN_FOLDER'), 'xdg-open.log');
  mkdirSync(binFolder, {recursive: true});
  writeFileSync(
    path.join(binFolder, 'xdg-open'),
    `#!/bin/sh\nprintf '%s\\n' "$1" >> '${logFile}'\n`,
  );
  chmodSync(path.join(binFolder, 'xdg-open'), 0o755);
  rmSync(logFile, {force: true});
  return logFile;
}

/** Forwards `port` of the window by hand, as a user does with Forward a Port. */
export async function forwardByHand(
  window: string,
  port: number,
): Promise<void> {
  const forwarding = inWindow(window, 'remote.tunnel.forwardCommandPalette');
  await answerInputBox(window, String(port));
  await forwarding;
}

/** Holds `port` on the host's loopback until the returned function is called. */
export async function occupy(port: number): Promise<() => Promise<void>> {
  const holder: Server = createServer();
  await new Promise<void>((resolve, reject) => {
    holder.once('error', reject);
    holder.listen(port, '127.0.0.1', resolve);
  });
  return () =>
    new Promise(resolve => {
      holder.close(() => {
        resolve();
      });
    });
}

/** Whether `port` can be bound on the host's loopback now. */
export async function isFree(port: number): Promise<boolean> {
  try {
    await (
      await occupy(port)
    )();
    return true;
  } catch {
    return false;
  }
}

/** The local port of the one row `window` shows for remote `port`, once it is shown. */
export async function localPortOf(
  window: string,
  port: number,
): Promise<number> {
  const rows = await rowsWhen(window, shown =>
    portsOf(shown).includes(String(port)),
  );
  const address = rows.find(
    shown => shown.port === String(port),
  )?.forwardedAddress;
  return Number((address ?? '').split(':').at(-1));
}

/** The addresses the run's recording `xdg-open` was asked to open; an uncreated log means it was never asked. */
export function browserOpens(logFile: string): string[] {
  try {
    return readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Starts `command` in a new terminal of the window, as a user does: core's detection looks at the processes that
 * terminals started. The way to end every process of that command comes back.
 */
async function inTerminal(
  window: string,
  containerId: string,
  command: string,
): Promise<() => Promise<void>> {
  await inWindow(window, 'workbench.action.terminal.new');
  await inWindow(window, 'workbench.action.terminal.sendSequence', {
    text: `${command} &\n`,
  });
  return async () => {
    await execFileAsync('docker', [
      'exec',
      containerId,
      'sh',
      '-c',
      `pkill -f '[${command.charAt(0)}]${command.slice(1)}' || true`,
    ]).catch(() => undefined);
  };
}

/** Starts a listener on `port` in a terminal of the window (an echo server on every address). */
export function listenInTerminal(
  window: string,
  containerId: string,
  port: number,
  address = '',
): Promise<() => Promise<void>> {
  return inTerminal(
    window,
    containerId,
    `nc -lk ${address === '' ? '' : `-s ${address} `}-p ${String(port)} -e cat`,
  );
}

/** The ports the container listens on, as its netstat reports them. */
export async function listeningPorts(containerId: string): Promise<string[]> {
  const {stdout} = await execFileAsync('docker', [
    'exec',
    containerId,
    'netstat',
    '-ltn',
  ]);
  return stdout
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('tcp'))
    .map(line => {
      const address = line.split(/\s+/)[3] ?? '';
      return address.slice(address.lastIndexOf(':') + 1);
    })
    .filter(text => text !== '')
    .sort();
}

/**
 * Runs `start`, which gives the way to end the listener, until `port` is among the container's listening ports,
 * starting it again when a start never ran. Throws when it never did.
 */
export async function ensureListening(
  containerId: string,
  port: number,
  start: () => Promise<() => Promise<void>>,
  tries = 3,
): Promise<() => Promise<void>> {
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    const stop = await start();
    try {
      await waitFor(
        `a listener on ${String(port)}`,
        async () => (await listeningPorts(containerId)).includes(String(port)),
        15_000,
      );
      return stop;
    } catch {
      await stop();
    }
  }
  throw new Error(
    `the listener on ${String(port)} never ran in ${String(tries)} starts`,
  );
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
