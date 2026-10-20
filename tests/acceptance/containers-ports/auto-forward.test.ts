import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createServer, type Server} from 'node:net';
import {promisify} from 'node:util';
import {setUserSetting} from '../windows/folder-windows.ts';
import {
  connectedToContainer,
  devContainersOf,
  inWindow,
  listenIn,
  reopenInContainer,
  waitFor,
} from '../windows/harness.ts';
import {
  answerDialog,
  answerInputBox,
  dialogOf,
  notificationCentre,
  portRowAction,
  portsRows,
  type PortsRow,
  waitForDialog,
} from '../windows/renderer.ts';
import {
  folderOf,
  freePort,
  portsOf,
  portsWindows,
  reloaded,
  rowsWhen,
  showPorts,
} from './ports-support.ts';

const execFileAsync = promisify(execFile);

/** Forwards `port` of the container by hand, as a user does with Forward a Port. */
async function forwardByHand(window: string, port: number): Promise<void> {
  const forwarding = inWindow(window, 'remote.tunnel.forwardCommandPalette');
  await answerInputBox(window, String(port));
  await forwarding;
}

/** The local port of the one row `window` shows for remote `port`, once it is shown. */
async function localPortOf(window: string, port: number): Promise<number> {
  const rows = await rowsWhen(window, shown =>
    portsOf(shown).includes(String(port)),
  );
  const address = rows.find(
    shown => shown.port === String(port),
  )?.forwardedAddress;
  return Number((address ?? '').split(':').at(-1));
}

/** The addresses the host listens on for local port `port`, as `ss -ltn` writes them. */
async function listeningFor(port: number): Promise<string[]> {
  const {stdout} = await execFileAsync('ss', ['-ltn']);
  return stdout
    .split('\n')
    .map(line => line.trim().split(/\s+/)[3] ?? '')
    .filter(address => address.endsWith(`:${String(port)}`))
    .sort();
}

/** Holds `port` on the host's loopback until the returned function is called. */
async function occupy(port: number): Promise<() => Promise<void>> {
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
async function isFree(port: number): Promise<boolean> {
  try {
    await (
      await occupy(port)
    )();
    return true;
  } catch {
    return false;
  }
}

describe('port forwarding stays core’s (card containers-75, F-1102)', function () {
  this.timeout(900_000);
  const {connectedWith} = portsWindows();

  it('F-1102 AC-16 (local-port-host): a forward binds the loopback only by default, and every interface with remote.localPortHost allInterfaces after a reload', async () => {
    const window = await connectedWith('c75-ac16', {});
    const [containerId = ''] = await devContainersOf(folderOf('c75-ac16'));
    const port = await freePort();
    const stop = await listenIn(containerId, port);
    try {
      await forwardByHand(window, port);
      await showPorts(window);
      const local = await localPortOf(window, port);
      const byDefault = await listeningFor(local);
      await setUserSetting('remote.localPortHost', 'allInterfaces');
      await reloaded(window);
      await showPorts(window);
      const reloadedLocal = await localPortOf(window, port);
      const everywhere = await listeningFor(reloadedLocal);
      deepStrictEqual(
        [byDefault, everywhere, reloadedLocal === local],
        [[`127.0.0.1:${String(local)}`], [`0.0.0.0:${String(local)}`], true],
      );
    } finally {
      await setUserSetting('remote.localPortHost', undefined);
      await stop();
    }
  });

  it('F-1102 AC-19 (restored-after-kill): after the container is killed, Reload Window on Cannot reconnect brings the forward back as a reload does', async () => {
    const window = await connectedWith('c75-ac19', {});
    const [containerId = ''] = await devContainersOf(folderOf('c75-ac19'));
    const port = await freePort();
    const stop = await listenIn(containerId, port);
    try {
      await forwardByHand(window, port);
      await showPorts(window);
      await rowsWhen(window, shown => portsOf(shown).includes(String(port)));
      await execFileAsync('docker', ['kill', containerId]);
      const dialog = await waitForDialog(window, 60_000);
      await answerDialog(window, 'Reload Window');
      await connectedToContainer(window, 240_000);
      await showPorts(window);
      const back = await rowsWhen(window, shown => shown.length > 0);
      deepStrictEqual(
        [dialog.details, back.map(shown => [shown.port, shown.origin])],
        [
          'Cannot reconnect. Please reload the window.',
          [[String(port), 'User Forwarded']],
        ],
      );
    } finally {
      await stop().catch(() => undefined);
    }
  });

  /** A window connected to a container with no declared ports (or `configuration`), and the container's id. */
  async function plainWindow(
    name: string,
    configuration: Readonly<Record<string, unknown>> = {},
  ): Promise<{window: string; containerId: string}> {
    const window = await connectedWith(name, configuration);
    const [containerId = ''] = await devContainersOf(folderOf(name));
    return {window, containerId};
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
      ]);
    };
  }

  /** Starts a listener on `port` in a terminal of the window (an echo server on every address). */
  function listenInTerminal(
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

  /** The row for remote `port` once core shows it, with the milliseconds it took from `since`. */
  async function appearing(
    window: string,
    port: number,
    since: number,
    seconds = 60,
  ): Promise<{shown: PortsRow | undefined; milliseconds: number}> {
    await showPorts(window);
    let found: PortsRow | undefined;
    await waitFor(
      `a Ports row for ${String(port)}`,
      async () => {
        found = (await portsRows(window).catch(() => [])).find(
          shown => shown.port === String(port),
        );
        return found !== undefined;
      },
      seconds * 1000,
    ).catch(() => undefined);
    return {shown: found, milliseconds: Date.now() - since};
  }

  /** The local port a row's Forwarded Address names. */
  function localOf(shown: PortsRow | undefined): number {
    return Number((shown?.forwardedAddress ?? '').split(':').at(-1));
  }

  it('F-1102 AC-1, AC-2 (auto-detected): a listener started in a terminal of the container gets a row within 10 s, with a remote and a local address and no dialog, and the container publishes nothing for it', async () => {
    const {window, containerId} = await plainWindow('c75-ac1');
    const port = await freePort();
    const since = Date.now();
    const stop = await listenInTerminal(window, containerId, port);
    try {
      const seen = await appearing(window, port, since);
      const {stdout} = await execFileAsync('docker', [
        'inspect',
        '--format',
        '{{json .NetworkSettings.Ports}} {{json .HostConfig.PortBindings}}',
        containerId,
      ]);
      deepStrictEqual(
        {
          appeared: seen.milliseconds < 10_000,
          origin: seen.shown?.origin,
          local: seen.shown?.forwardedAddress,
          remote: seen.shown?.tooltip.startsWith(`Remote port `),
          dialog: await dialogOf(window),
          published: stdout.includes(`${String(port)}/tcp`),
        },
        {
          appeared: true,
          origin: 'Auto Forwarded',
          local: `localhost:${String(port)}`,
          remote: true,
          dialog: undefined,
          published: false,
        },
      );
    } finally {
      await stop();
    }
  });

  it('F-1102 AC-5 (privileged-port): a listener on a privileged port the host cannot bind is forwarded on a substitute local port, with no dialog', async function () {
    const unprivileged = Number(
      readFileSync('/proc/sys/net/ipv4/ip_unprivileged_port_start', 'utf8'),
    );
    if (unprivileged <= 81) {
      // The host binds every port here, so the condition cannot be made.
      this.skip();
    }
    const {window, containerId} = await plainWindow('c75-ac5');
    const since = Date.now();
    const stop = await listenInTerminal(window, containerId, 81);
    try {
      const seen = await appearing(window, 81, since);
      deepStrictEqual(
        {
          substitute: localOf(seen.shown) !== 81 && localOf(seen.shown) > 1023,
          dialog: await dialogOf(window),
        },
        {substitute: true, dialog: undefined},
      );
    } finally {
      await stop();
    }
  });

  it('F-1102 AC-6 (other-user): with a remote user that is not root, a listener of root whose port is not on its command line is not forwarded, and the same program of the server’s user is', async () => {
    const {window, containerId} = await plainWindow('c75-ac6', {
      remoteUser: 'node',
    });
    // `-p 0` takes a port of the system's choice, so no command line names it.
    await execFileAsync('docker', [
      'exec',
      '-d',
      '--user',
      'root',
      containerId,
      'nc',
      '-lk',
      '-p',
      '0',
      '-e',
      'cat',
    ]);
    const stopOwn = await inTerminal(window, containerId, 'nc -lk -p 0 -e cat');
    try {
      await new Promise(resolve => setTimeout(resolve, 15_000));
      await showPorts(window);
      const rows = await rowsWhen(window, shown => shown.length > 0);
      const {stdout} = await execFileAsync('docker', [
        'exec',
        containerId,
        'ps',
        '-o',
        'pid,user,args',
      ]);
      const owned = stdout
        .split('\n')
        .map(line => line.trim().split(/\s+/))
        .filter(fields => fields.slice(2).join(' ') === 'nc -lk -p 0 -e cat')
        .map(fields => ({process: fields[0] ?? '', user: fields[1] ?? ''}));
      const ownProcess = owned.find(each => each.user === 'node')?.process;
      deepStrictEqual(
        {
          owners: owned.map(each => each.user).sort(),
          forwarded: rows.map(shown => shown.runningProcess),
        },
        {
          owners: ['node', 'root'],
          forwarded: [`nc -lk -p 0 -e cat (${String(ownProcess)})`],
        },
      );
    } finally {
      await stopOwn();
      await execFileAsync('docker', [
        'exec',
        '--user',
        'root',
        containerId,
        'sh',
        '-c',
        "pkill -f '[n]c -lk -p 0' || true",
      ]);
    }
  });

  it('F-1102 AC-7 (restored-on-reload): after a reload every forward but the stopped one is back, automatic and by hand alike, starting with no running process', async () => {
    const {window, containerId} = await plainWindow('c75-ac7');
    const [auto, hand, stopped] = [
      await freePort(),
      await freePort(),
      await freePort(),
    ];
    const stopHand = await listenIn(containerId, hand);
    await forwardByHand(window, hand);
    const stops = [
      stopHand,
      await listenInTerminal(window, containerId, auto),
      await listenInTerminal(window, containerId, stopped),
    ];
    try {
      await appearing(window, auto, Date.now());
      await appearing(window, stopped, Date.now());
      await portRowAction(window, String(stopped), 'Stop Forwarding Port');
      await rowsWhen(
        window,
        shown => !portsOf(shown).includes(String(stopped)),
      );
      for (const stop of stops) {
        await stop();
      }
      await reloaded(window);
      await showPorts(window);
      const back = await rowsWhen(window, shown => shown.length > 1);
      deepStrictEqual(
        back
          .map(shown => [shown.port, shown.runningProcess])
          .sort((first, second) =>
            String(first[0]).localeCompare(String(second[0])),
          ),
        [
          [String(auto), ''],
          [String(hand), ''],
        ].sort((first, second) =>
          String(first[0]).localeCompare(String(second[0])),
        ),
      );
    } finally {
      for (const stop of stops) {
        await stop().catch(() => undefined);
      }
    }
  });

  it('F-1102 AC-15 (local-port-taken): when local port N is taken on the host, the container’s N is forwarded on N+1', async () => {
    const {window, containerId} = await plainWindow('c75-ac15');
    let port = await freePort();
    // A port whose successor is free too.
    while (!(await isFree(port + 1))) {
      port = await freePort();
    }
    const release = await occupy(port);
    const stop = await listenInTerminal(window, containerId, port);
    try {
      const seen = await appearing(window, port, Date.now());
      deepStrictEqual(localOf(seen.shown), port + 1);
    } finally {
      await stop();
      await release();
    }
  });

  it('F-1102 AC-18 (three-taken): when three consecutive local ports are taken, the substitute is neither the next one nor the next free after the three', async () => {
    const {window, containerId} = await plainWindow('c75-ac18');
    let port = await freePort();
    while (
      !(await isFree(port + 1)) ||
      !(await isFree(port + 2)) ||
      !(await isFree(port + 3))
    ) {
      port = await freePort();
    }
    const releases = [
      await occupy(port),
      await occupy(port + 1),
      await occupy(port + 2),
    ];
    const stop = await listenInTerminal(window, containerId, port);
    try {
      const seen = await appearing(window, port, Date.now());
      const local = localOf(seen.shown);
      deepStrictEqual(
        [local === port + 1, local === port + 3, local > 0],
        [false, false, true],
      );
    } finally {
      await stop();
      for (const release of releases) {
        await release();
      }
    }
  });

  it('F-1102 AC-24 (ipv6-tooltip): a listener on ::1 only is forwarded, and the row’s tooltip names the address expanded and without brackets', async () => {
    const {window, containerId} = await plainWindow('c75-ac24');
    const port = await freePort();
    const stop = await listenInTerminal(window, containerId, port, '::1');
    try {
      const seen = await appearing(window, port, Date.now());
      deepStrictEqual(
        seen.shown?.tooltip.startsWith(
          `Remote port 0:0:0:0:0:0:0:1:${String(port)} forwarded`,
        ),
        true,
      );
    } finally {
      await stop();
    }
  });

  it('F-1102 AC-29 (ipv6-wildcard): a dual-stack wildcard listener names the zero address in the tooltip', async () => {
    const {window, containerId} = await plainWindow('c75-ac29');
    const port = await freePort();
    const stop = await listenInTerminal(window, containerId, port, '::');
    try {
      const seen = await appearing(window, port, Date.now());
      deepStrictEqual(
        seen.shown?.tooltip.startsWith(
          `Remote port 0:0:0:0:0:0:0:0:${String(port)} forwarded`,
        ),
        true,
      );
    } finally {
      await stop();
    }
  });

  it('F-1102 AC-27 (rebuild): after Rebuild Container the automatic and the by-hand forward are back on the new container, and the stopped one is not', async () => {
    const {window, containerId} = await plainWindow('c75-ac27');
    const [auto, hand, stopped] = [
      await freePort(),
      await freePort(),
      await freePort(),
    ];
    const stopHand = await listenIn(containerId, hand);
    await forwardByHand(window, hand);
    const stops = [
      stopHand,
      await listenInTerminal(window, containerId, auto),
      await listenInTerminal(window, containerId, stopped),
    ];
    try {
      await appearing(window, auto, Date.now());
      await appearing(window, stopped, Date.now());
      await portRowAction(window, String(stopped), 'Stop Forwarding Port');
      await rowsWhen(
        window,
        shown => !portsOf(shown).includes(String(stopped)),
      );
      await reopenInContainer(
        window,
        300_000,
        'remote-containers.rebuildContainer',
      );
      await showPorts(window);
      const back = await rowsWhen(window, shown => shown.length > 1);
      deepStrictEqual(
        portsOf(back).sort(),
        [String(auto), String(hand)].sort(),
      );
    } finally {
      for (const stop of stops) {
        await stop().catch(() => undefined);
      }
    }
  });

  it('F-1102 AC-31 (listening-before-connect): a listener that postStartCommand started is not forwarded, while a later listener started in a terminal is', async () => {
    const [before, later] = [await freePort(), await freePort()];
    const {window, containerId} = await plainWindow('c75-ac31a', {
      postStartCommand: `nohup nc -lk -p ${String(before)} -e cat >/dev/null 2>&1 &`,
    });
    await showPorts(window);
    await new Promise(resolve => setTimeout(resolve, 25_000));
    const early = portsOf(await portsRows(window).catch(() => []));
    const stop = await listenInTerminal(window, containerId, later);
    try {
      const seen = await appearing(window, later, Date.now());
      await new Promise(resolve => setTimeout(resolve, 5000));
      deepStrictEqual(
        [early, seen.shown !== undefined, portsOf(await portsRows(window))],
        [[], true, [String(later)]],
      );
    } finally {
      await stop();
    }
  });

  it('F-1102 AC-31 (on-auto-forward): portsAttributes onAutoForward silent forwards a later listener without a notice, and ignore keeps another one out', async () => {
    const [silent, ignored] = [await freePort(), await freePort()];
    const {window, containerId} = await plainWindow('c75-ac31b', {
      portsAttributes: {
        [String(silent)]: {onAutoForward: 'silent'},
        [String(ignored)]: {onAutoForward: 'ignore'},
      },
    });
    const stops = [
      await listenInTerminal(window, containerId, silent),
      await listenInTerminal(window, containerId, ignored),
    ];
    try {
      const seen = await appearing(window, silent, Date.now());
      await new Promise(resolve => setTimeout(resolve, 20_000));
      deepStrictEqual(
        [
          seen.shown?.origin,
          portsOf(await portsRows(window)),
          (await notificationCentre(window)).filter(text =>
            text.includes(String(silent)),
          ),
        ],
        ['Auto Forwarded', [String(silent)], []],
      );
    } finally {
      for (const stop of stops) {
        await stop();
      }
    }
  });
});
