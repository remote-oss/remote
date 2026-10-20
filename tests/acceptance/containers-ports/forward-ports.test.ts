import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {connect, createServer} from 'node:net';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  openFolderWindow,
  removeContainers,
  setUserSetting,
} from '../windows/folder-windows.ts';
import {
  closeWindow,
  commandsOf,
  connectedToContainer,
  devContainerFolder,
  devContainersOf,
  inWindow,
  listenIn,
  reloadWindow,
  reopenInContainer,
  runLabelArguments,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {
  dialogOf,
  hasStatusItem,
  notificationCentre,
  portRowAction,
  portsRows,
  type PortsRow,
  statusItem,
} from '../windows/renderer.ts';

const execFileAsync = promisify(execFile);

/** The command that focuses core's Ports view. */
const FOCUS_PORTS = '~remote.forwardedPorts.focus';

/** A port nothing on this machine listens on, from the range the system hands out. */
async function freePort(): Promise<number> {
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

describe('the declared forwardPorts (card containers-72)', function () {
  this.timeout(900_000);
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

  /** Opens a folder with `configuration` in a window and connects it to its container. */
  async function connectedWith(
    name: string,
    configuration: Readonly<Record<string, unknown>>,
  ): Promise<string> {
    const folder = devContainerFolder(name, {
      name: 'Forwards',
      ...configuration,
    });
    folders.push(folder);
    const window = await openFolderWindow(folder);
    opened.push(window);
    await reopenInContainer(window);
    return window;
  }

  /** Shows the Ports view of window `window` once core has made it. */
  async function showPorts(window: string): Promise<void> {
    await waitFor(
      'core to register the Ports view',
      async () => (await commandsOf(window, FOCUS_PORTS)).includes(FOCUS_PORTS),
      30_000,
    );
    await inWindow(window, FOCUS_PORTS);
  }

  /** The rows of the Ports view of window `window` once `ready` holds for them, or whatever they are after 30 s. */
  async function rowsWhen(
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

  it('F-1101 AC-1 (forward-declared): a declared port is forwarded once the window connects, with the origin Dev Containers and before any listener', async () => {
    const window = await connectedWith('c72-ac1', {forwardPorts: [3000]});
    await showPorts(window);
    const rows = await rowsWhen(window, shown => shown.length > 0);
    const status = await statusItem(window, 'status.forwardedPorts');
    deepStrictEqual(
      [
        rows.map(shown => [shown.port, shown.origin]),
        status.ariaLabel,
        status.text,
      ],
      [[['3000', 'Dev Containers']], 'Forwarded Ports: 3000', '1'],
    );
  });

  /** Writes `configuration` over the folder's devcontainer.json, as an edit of the file the window shows. */
  function editConfiguration(
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

  /** The folder of the window `name` opened by `connectedWith`. */
  function folderOf(name: string): string {
    return path.join(variable('HARNESS_RUN_FOLDER'), name);
  }

  /** Reloads window `window` and waits until it is connected to its container again. */
  async function reloaded(window: string): Promise<void> {
    await reloadWindow(window);
    await connectedToContainer(window);
  }

  /** The ports of the rows. */
  function portsOf(rows: readonly PortsRow[]): string[] {
    return rows.map(shown => shown.port);
  }

  it('F-1101 AC-11 (forward-new-entry): an entry added to the file is not forwarded by a reload, and is by a rebuild', async () => {
    const [first, second] = [await freePort(), await freePort()];
    const window = await connectedWith('c72-ac11', {forwardPorts: [first]});
    editConfiguration(folderOf('c72-ac11'), {forwardPorts: [first, second]});
    await reloaded(window);
    await showPorts(window);
    const afterReload = portsOf(
      await rowsWhen(window, shown => shown.length > 0),
    );
    await reopenInContainer(
      window,
      300_000,
      'remote-containers.rebuildContainer',
    );
    await showPorts(window);
    const afterRebuild = portsOf(
      await rowsWhen(window, shown => shown.length > 1),
    );
    deepStrictEqual(
      [afterReload, afterRebuild.sort()],
      [[String(first)], [String(first), String(second)].sort()],
    );
  });

  it('F-1101 AC-13 (forward-dash-quiet): entries and a key that start with a dash are not forwarded, and the connect goes on with no modal', async () => {
    const port = await freePort();
    const window = await connectedWith('c72-ac13', {
      forwardPorts: [port, -3000, '-3000', 'myhost:-1234'],
      portsAttributes: {'-3000': {label: 'dashed'}},
    });
    await showPorts(window);
    const rows = await rowsWhen(window, shown => shown.length > 0);
    deepStrictEqual(
      [portsOf(rows), await dialogOf(window)],
      [[String(port)], undefined],
    );
  });

  it('F-1101 AC-16 (forward-dash-notice): a port that starts with a dash shows one notification with the S278 text', async () => {
    const port = await freePort();
    const window = await connectedWith('c72-ac16', {
      forwardPorts: [port, '-3000'],
    });
    await waitFor(
      'the S278 notification',
      async () =>
        (await notificationCentre(window)).some(text =>
          text.startsWith('Port number must not start with a dash'),
        ),
      30_000,
    );
    deepStrictEqual(
      (await notificationCentre(window)).filter(text =>
        text.startsWith('Port number must not start with a dash'),
      ),
      ['Port number must not start with a dash: -3000'],
    );
  });

  it('F-1101 AC-18 (forward-https): 443 and 8443 open in the browser with https, and another port with http', async () => {
    const other = await freePort();
    const window = await connectedWith('c72-ac18', {
      forwardPorts: [443, 8443, other],
    });
    const bin = path.join(variable('HARNESS_RUN_FOLDER'), 'xdg-bin');
    const log = path.join(variable('HARNESS_RUN_FOLDER'), 'xdg-open.log');
    mkdirSync(bin, {recursive: true});
    writeFileSync(
      path.join(bin, 'xdg-open'),
      `#!/bin/sh\nprintf '%s\\n' "$1" >> '${log}'\n`,
    );
    chmodSync(path.join(bin, 'xdg-open'), 0o755);
    rmSync(log, {force: true});
    await showPorts(window);
    await rowsWhen(window, shown => shown.length > 2);
    for (const port of ['443', '8443', String(other)]) {
      await portRowAction(window, port, 'Open in Browser');
      await waitFor(
        `the browser to be asked for ${port}`,
        () => readFileSync(log, 'utf8').split('\n').filter(Boolean).length > 0,
        15_000,
      ).catch(() => undefined);
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
    deepStrictEqual(
      readFileSync(log, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map(url => url.slice(0, url.indexOf(':'))),
      ['https', 'https', 'http'],
    );
  });

  it('F-1101 AC-22 (forward-stopped): a declared forward that was stopped is back after a reload, with its origin', async () => {
    const port = await freePort();
    const window = await connectedWith('c72-ac22', {forwardPorts: [port]});
    await showPorts(window);
    await rowsWhen(window, shown => shown.length > 0);
    await portRowAction(window, String(port), 'Stop Forwarding Port');
    const stopped = await rowsWhen(window, shown => shown.length === 0);
    await reloaded(window);
    await showPorts(window);
    const back = await rowsWhen(window, shown => shown.length > 0);
    deepStrictEqual(
      [portsOf(stopped), back.map(shown => [shown.port, shown.origin])],
      [[], [[String(port), 'Dev Containers']]],
    );
  });

  it('F-1101 AC-25 (forward-other-host): host:port forwards to a name the container resolves, and the port is reachable', async () => {
    const port = await freePort();
    const sibling = await siblingListening(port);
    try {
      const window = await connectedWith('c72-ac25', {
        forwardPorts: [`side:${String(port)}`],
        runArgs: [...runLabelArguments(), `--add-host=side:${sibling.address}`],
      });
      await showPorts(window);
      const rows = await rowsWhen(window, shown => shown.length > 0);
      const reachable = await echoes(rows[0]?.forwardedAddress ?? '');
      deepStrictEqual([rows.length, reachable], [1, true]);
    } finally {
      await sibling.stop();
    }
  });

  it('F-1101 AC-26 (forward-address-dropped): an entry with an address in place of a host is not forwarded and shows nothing', async () => {
    const [port, other] = [await freePort(), await freePort()];
    const window = await connectedWith('c72-ac26', {
      forwardPorts: [port, `127.0.0.1:${String(other)}`],
    });
    await showPorts(window);
    const rows = await rowsWhen(window, shown => shown.length > 0);
    await new Promise(resolve => setTimeout(resolve, 3000));
    deepStrictEqual(
      [portsOf(await portsRows(window)), portsOf(rows), await dialogOf(window)],
      [[String(port)], [String(port)], undefined],
    );
  });

  it('F-1101 AC-30 (forward-removed-entry): an entry removed from the file is still forwarded after a reload', async () => {
    const [first, second] = [await freePort(), await freePort()];
    const window = await connectedWith('c72-ac30', {
      forwardPorts: [first, second],
    });
    editConfiguration(folderOf('c72-ac30'), {forwardPorts: [first]});
    await reloaded(window);
    await showPorts(window);
    deepStrictEqual(
      portsOf(await rowsWhen(window, shown => shown.length > 1)).sort(),
      [String(first), String(second)].sort(),
    );
  });

  it('F-1101 AC-31 (forward-seven): of seven entries only the four allowed are forwarded', async () => {
    const [number, first, second, third] = [
      await freePort(),
      await freePort(),
      await freePort(),
      await freePort(),
    ];
    const window = await connectedWith('c72-ac31', {
      forwardPorts: [
        number,
        `localhost:${String(first)}`,
        second,
        `side:${String(third)}`,
        '3000',
        70000,
        'a.b:5',
      ],
    });
    await showPorts(window);
    const rows = await rowsWhen(window, shown => shown.length > 3);
    await new Promise(resolve => setTimeout(resolve, 3000));
    deepStrictEqual(
      portsOf(await portsRows(window)).sort(),
      [
        String(number),
        String(first),
        String(second),
        `side:${String(third)}`,
      ].sort(),
    );
    void rows;
  });

  it('F-1101 AC-32 (forward-quoted-number): a bare string of digits is not forwarded, and the number is', async () => {
    const port = await freePort();
    const quoted = await connectedWith('c72-ac32a', {
      forwardPorts: [String(port)],
    });
    await new Promise(resolve => setTimeout(resolve, 5000));
    const shown = await hasStatusItem(quoted, 'status.forwardedPorts');
    await closeWindow(quoted);
    opened.splice(opened.indexOf(quoted), 1);
    const plain = await connectedWith('c72-ac32b', {forwardPorts: [port]});
    await showPorts(plain);
    deepStrictEqual(
      [shown, portsOf(await rowsWhen(plain, rows => rows.length > 0))],
      [false, [String(port)]],
    );
  });

  it('F-1101 AC-36 (forward-auto-off): with remote.autoForwardPorts off the declared ports are forwarded and reachable', async () => {
    const [first, second] = [await freePort(), await freePort()];
    await setUserSetting('remote.autoForwardPorts', false);
    try {
      const window = await connectedWith('c72-ac36', {
        forwardPorts: [first, second],
      });
      const [containerId = ''] = await devContainersOf(folderOf('c72-ac36'));
      const stops = [
        await listenIn(containerId, first),
        await listenIn(containerId, second),
      ];
      await showPorts(window);
      const rows = await rowsWhen(window, shown => shown.length > 1);
      const reachable = await Promise.all(
        rows.map(shown => echoes(shown.forwardedAddress)),
      );
      for (const stop of stops) {
        await stop();
      }
      deepStrictEqual(
        [portsOf(rows).sort(), reachable],
        [[String(first), String(second)].sort(), [true, true]],
      );
    } finally {
      await setUserSetting('remote.autoForwardPorts', undefined);
    }
  });

  it('F-1101 AC-37 (forward-duplicates): a repeated target, and localhost:port for a port already listed, are forwarded once', async () => {
    const [first, second] = [await freePort(), await freePort()];
    const window = await connectedWith('c72-ac37', {
      forwardPorts: [first, first, second, `localhost:${String(second)}`],
    });
    await showPorts(window);
    await rowsWhen(window, shown => shown.length > 1);
    await new Promise(resolve => setTimeout(resolve, 3000));
    deepStrictEqual(
      portsOf(await portsRows(window)).sort(),
      [String(first), String(second)].sort(),
    );
  });

  it('F-1101 AC-38 (forward-same-port-two-hosts): the same port on localhost and on another host are two forwards on two local ports', async () => {
    const port = await freePort();
    const window = await connectedWith('c72-ac38', {
      forwardPorts: [port, `side:${String(port)}`],
    });
    await showPorts(window);
    const rows = await rowsWhen(window, shown => shown.length > 1);
    deepStrictEqual(
      [rows.length, new Set(rows.map(shown => shown.forwardedAddress)).size],
      [2, 2],
    );
  });
});

/** Whether a connection to `address` (`host:port`) is answered with what it sent. */
function echoes(address: string): Promise<boolean> {
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

/** A container of the run, apart from the dev container, that echoes on `port`: its address and the way to remove it. */
async function siblingListening(
  port: number,
): Promise<{address: string; stop: () => Promise<void>}> {
  const {stdout} = await execFileAsync('docker', [
    'run',
    '-d',
    ...runLabelArguments(),
    variable('HARNESS_DEVCONTAINER_IMAGE'),
    'sh',
    '-c',
    `nc -lk -p ${String(port)} -e cat`,
  ]);
  const id = stdout.trim();
  const inspected = await execFileAsync('docker', [
    'inspect',
    '--format',
    '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',
    id,
  ]);
  return {
    address: inspected.stdout.trim(),
    stop: async () => {
      await execFileAsync('docker', ['rm', '-f', id]);
    },
  };
}
