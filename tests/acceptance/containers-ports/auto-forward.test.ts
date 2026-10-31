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

  /** Starts `nc -lk` in container `containerId` as `user` with `execution`, detached, on `port` (0: the system's choice). */
  async function execListener(
    containerId: string,
    user: string,
    port: number,
  ): Promise<void> {
    await execFileAsync('docker', [
      'exec',
      '-d',
      '--user',
      user,
      containerId,
      'nc',
      '-lk',
      '-p',
      String(port),
      '-e',
      'cat',
    ]);
  }

  /** The user that owns the process whose command line is `command` in the container, or none. */
  async function ownerOf(
    containerId: string,
    command: string,
  ): Promise<string | undefined> {
    const {stdout} = await execFileAsync('docker', [
      'exec',
      containerId,
      'ps',
      '-o',
      'user,args',
    ]);
    return stdout
      .split('\n')
      .map(line => line.trim().split(/\s+/))
      .find(fields => fields.slice(1).join(' ') === command)?.[0];
  }

  /** Ends every `nc -lk` of the container, whoever owns it. */
  async function endListeners(containerId: string): Promise<void> {
    await execFileAsync('docker', [
      'exec',
      '--user',
      'root',
      containerId,
      'sh',
      '-c',
      "pkill -f '[n]c -lk' || true",
    ]);
  }

  it('F-1102 AC-31 (listening-before-connect): a listener of the server’s user that was there when the window connected is not forwarded, while a later listener started in a terminal is', async () => {
    const [before, later] = [await freePort(), await freePort()];
    const {window, containerId} = await plainWindow('c75-ac31a');
    await execListener(containerId, 'root', before);
    await reloaded(window);
    await showPorts(window);
    await new Promise(resolve => setTimeout(resolve, 25_000));
    const early = portsOf(await portsRows(window).catch(() => []));
    const owner = await ownerOf(
      containerId,
      `nc -lk -p ${String(before)} -e cat`,
    );
    const stop = await listenInTerminal(window, containerId, later);
    try {
      const seen = await appearing(window, later, Date.now());
      await new Promise(resolve => setTimeout(resolve, 5000));
      deepStrictEqual(
        [
          owner,
          early,
          seen.shown !== undefined,
          portsOf(await portsRows(window)),
        ],
        ['root', [], true, [String(later)]],
      );
    } finally {
      await stop();
      await endListeners(containerId);
    }
  });

  it('F-1102 AC-31 (on-auto-forward): a listener that was there when the window connected is forwarded when onAutoForward is silent, with no notice, and stays out when it is ignore, once another listener changes the set', async () => {
    const seen: Array<[string, string[], string[]]> = [];
    for (const [name, mode] of [
      ['c75-ac31b', 'silent'],
      ['c75-ac31c', 'ignore'],
    ] as const) {
      const [before, later] = [await freePort(), await freePort()];
      const {window, containerId} = await plainWindow(name, {
        portsAttributes: {[String(before)]: {onAutoForward: mode}},
      });
      await execListener(containerId, 'root', before);
      await reloaded(window);
      await showPorts(window);
      await new Promise(resolve => setTimeout(resolve, 15_000));
      const stop = await listenInTerminal(window, containerId, later);
      try {
        await appearing(window, later, Date.now());
        await new Promise(resolve => setTimeout(resolve, 5000));
        seen.push([
          mode,
          portsOf(await portsRows(window))
            .filter(port => port === String(before))
            .map(() => 'before'),
          (await notificationCentre(window)).filter(text =>
            text.includes(String(before)),
          ),
        ]);
      } finally {
        await stop();
        await endListeners(containerId);
      }
    }
    deepStrictEqual(seen, [
      ['silent', ['before'], []],
      ['ignore', [], []],
    ]);
  });

  it('F-1102 AC-6 (other-user): who may read whose processes decides what is forwarded: a root listener with no port on its command line is not forwarded for a remote user that is not root, a listener of another user with its port on its command line is not forwarded for root, and a remote user that may trace processes gets both', async () => {
    const cases: Array<
      [string, Record<string, unknown>, string, string, boolean]
    > = [
      // name, configuration, the user of the listener, the same program as the remote user, whether it is forwarded
      ['c75-ac6-node-root', {remoteUser: 'node'}, 'root', 'root', false],
      ['c75-ac6-node-own', {remoteUser: 'node'}, 'node', 'node', true],
      ['c75-ac6-root-node', {remoteUser: 'root'}, 'node', 'node', false],
      ['c75-ac6-root-own', {remoteUser: 'root'}, 'root', 'root', true],
      [
        'c75-ac6-trace-node',
        {remoteUser: 'root', capAdd: ['SYS_PTRACE']},
        'node',
        'node',
        true,
      ],
    ];
    const seen: Array<[string, boolean]> = [];
    for (const [name, configuration, user] of cases) {
      const {window, containerId} = await plainWindow(name, configuration);
      // A listener of a terminal first, so that the listeners of the case come after core's first pass.
      const marker = await freePort();
      const stopMarker = await listenInTerminal(window, containerId, marker);
      try {
        await appearing(window, marker, Date.now());
        // Port 0 takes a port of the system's choice for a listener of root; the other users' name theirs.
        const named = await freePort();
        await execListener(containerId, user, user === 'root' ? 0 : named);
        await new Promise(resolve => setTimeout(resolve, 20_000));
        const rows = await portsRows(window);
        const forwardedOthers = rows.filter(
          shown => shown.port !== String(marker),
        );
        seen.push([name, forwardedOthers.length > 0]);
      } finally {
        await stopMarker();
        await endListeners(containerId);
      }
    }
    deepStrictEqual(
      seen,
      cases.map(([name, , , , expected]) => [name, expected]),
    );
  });

  it('F-1101 AC-22 (forward-stopped): a declared forward stopped by hand is back after a reload with its label and origin, and an auto-detected port stopped the same way stays stopped', async () => {
    const [declared, detected] = [await freePort(), await freePort()];
    const {window, containerId} = await plainWindow('c72-ac22', {
      forwardPorts: [declared],
      portsAttributes: {[String(declared)]: {label: 'Declared'}},
    });
    const stopDetected = await listenInTerminal(window, containerId, detected);
    try {
      await rowsWhen(window, shown =>
        portsOf(shown).includes(`Declared (${String(declared)})`),
      );
      await appearing(window, detected, Date.now());
      await portRowAction(
        window,
        `Declared (${String(declared)})`,
        'Stop Forwarding Port',
      );
      await portRowAction(window, String(detected), 'Stop Forwarding Port');
      await rowsWhen(window, shown => shown.length === 0);
      await new Promise(resolve => setTimeout(resolve, 5000));
      const stopped = portsOf(await portsRows(window));
      await reloaded(window);
      await showPorts(window);
      const back = await rowsWhen(window, shown => shown.length > 0);
      await new Promise(resolve => setTimeout(resolve, 5000));
      const after = await portsRows(window);
      deepStrictEqual(
        [
          stopped,
          back.map(shown => [shown.port, shown.origin]),
          portsOf(after),
        ],
        [
          [],
          [[`Declared (${String(declared)})`, 'Dev Containers']],
          [`Declared (${String(declared)})`],
        ],
      );
    } finally {
      await stopDetected();
    }
  });

  it('F-1101 AC-21 (overlap-regexes): of two regex keys that both match a detected listener’s command line, the one listed first gives the row its label', async () => {
    const outcomes: string[][] = [];
    for (const [name, attributes] of [
      ['c73-ac21c', {lk: {label: 'FirstRegex'}, cat: {label: 'SecondRegex'}}],
      ['c73-ac21d', {cat: {label: 'SecondRegex'}, lk: {label: 'FirstRegex'}}],
    ] as const) {
      const port = await freePort();
      const {window, containerId} = await plainWindow(name, {
        portsAttributes: attributes,
      });
      const stop = await listenInTerminal(window, containerId, port);
      try {
        await showPorts(window);
        await rowsWhen(window, shown => shown.length > 0);
        await new Promise(resolve => setTimeout(resolve, 3000));
        outcomes.push(
          portsOf(await portsRows(window)).map(text =>
            text.replace(String(port), '<port>'),
          ),
        );
      } finally {
        await stop();
      }
    }
    deepStrictEqual(outcomes, [
      ['FirstRegex (<port>)'],
      ['SecondRegex (<port>)'],
    ]);
  });
});
