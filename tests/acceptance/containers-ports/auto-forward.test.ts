import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {promisify} from 'node:util';
import {setUserSetting} from '../windows/folder-windows.ts';
import {
  connectedToContainer,
  devContainersOf,
  listenIn,
  reopenInContainer,
  waitFor,
} from '../windows/harness.ts';
import {
  answerDialog,
  dialogOf,
  editorTabs,
  notificationCentre,
  portRowAction,
  portsRows,
  statusItem,
  type PortsRow,
  waitForDialog,
} from '../windows/renderer.ts';
import {
  folderOf,
  freePort,
  browserOpens,
  ensureListening,
  isFree,
  listenInTerminal,
  localPortOf,
  occupy,
  portsOf,
  portsWindows,
  reloaded,
  recordBrowserOpens,
  rowsWhen,
  showPorts,
} from './ports-support.ts';
import {forwardByHand} from '../windows/forward-support.ts';

const execFileAsync = promisify(execFile);

/** How long after a declared port's row shows core has surely made its first scan of the listening ports. */
const INITIAL_SCAN_MILLISECONDS = 10_000;

/** The addresses the host listens on for local port `port`, as `ss -ltn` writes them. */
async function listeningFor(port: number): Promise<string[]> {
  const {stdout} = await execFileAsync('ss', ['-ltn']);
  return stdout
    .split('\n')
    .map(line => line.trim().split(/\s+/)[3] ?? '')
    .filter(address => address.endsWith(`:${String(port)}`))
    .sort();
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
      await execFileAsync('docker', [
        'exec',
        containerId,
        'sh',
        '-c',
        `grep -qi ":$(printf '%04X' ${String(detected)}) " /proc/net/tcp /proc/net/tcp6`,
      ]);
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

  /** A port at or above 10000 that is not a multiple of 1000, free on the host. */
  async function bigPort(): Promise<number> {
    let port = await freePort();
    while (port < 10000 || port % 1000 === 0) {
      port = await freePort();
    }
    return port;
  }

  it('F-1101 AC-14 (reaction-quiet): openBrowser, openPreview and ignore on a port at or above 10000 that is not a multiple of 1000 forward the port with no visible reaction, declared and detected alike', async () => {
    const [browserDecl, browserDet, previewDecl, previewDet, ignored] = [
      await bigPort(),
      await bigPort(),
      await bigPort(),
      await bigPort(),
      await bigPort(),
    ];
    const logFile = recordBrowserOpens();
    const browserWindow = await connectedWith('c73b-ac14a', {
      forwardPorts: [browserDecl],
      portsAttributes: {[String(browserDecl)]: {onAutoForward: 'openBrowser'}},
      otherPortsAttributes: {onAutoForward: 'openBrowser'},
    });
    const [browserContainer = ''] = await devContainersOf(
      folderOf('c73b-ac14a'),
    );
    const browserStops = [
      await listenIn(browserContainer, browserDecl),
      await ensureListening(browserContainer, browserDet, () =>
        listenInTerminal(browserWindow, browserContainer, browserDet),
      ),
    ];
    const previewWindow = await connectedWith('c73b-ac14b', {
      forwardPorts: [previewDecl, ignored],
      portsAttributes: {
        [String(previewDecl)]: {onAutoForward: 'openPreview'},
        [String(ignored)]: {onAutoForward: 'ignore'},
      },
      otherPortsAttributes: {onAutoForward: 'openPreview'},
    });
    const [previewContainer = ''] = await devContainersOf(
      folderOf('c73b-ac14b'),
    );
    const previewStops = [
      await listenIn(previewContainer, previewDecl),
      await ensureListening(previewContainer, previewDet, () =>
        listenInTerminal(previewWindow, previewContainer, previewDet),
      ),
      await listenIn(previewContainer, ignored),
    ];
    try {
      await showPorts(browserWindow);
      await showPorts(previewWindow);
      await rowsWhen(browserWindow, shown => portsOf(shown).length === 2);
      await rowsWhen(previewWindow, shown => portsOf(shown).length === 3);
      await rowsWhen(browserWindow, shown =>
        shown.every(each => each.runningProcess !== ''),
      );
      await rowsWhen(previewWindow, shown =>
        shown.every(each => each.runningProcess !== ''),
      );
      await new Promise(resolve => setTimeout(resolve, 3000));
      function sortRows(rows: readonly PortsRow[]): string[][] {
        return rows
          .map(shown => [shown.port, shown.origin])
          .sort((first, second) =>
            String(first[0]).localeCompare(String(second[0])),
          );
      }
      deepStrictEqual(
        {
          origins: [
            sortRows(await portsRows(browserWindow)),
            sortRows(await portsRows(previewWindow)),
          ],
          icons: [
            (await portsRows(browserWindow)).map(shown => shown.icon).sort(),
            (await portsRows(previewWindow)).map(shown => shown.icon).sort(),
          ],
          tabs: [
            (await editorTabs(browserWindow))
              .map(entry => entry.label)
              .filter(label => label.startsWith('localhost:')),
            (await editorTabs(previewWindow))
              .map(entry => entry.label)
              .filter(label => label.startsWith('localhost:')),
          ],
          browser: browserOpens(logFile),
          notices: [
            (await notificationCentre(browserWindow)).filter(text =>
              [browserDecl, browserDet].some(port =>
                text.includes(String(port)),
              ),
            ),
            (await notificationCentre(previewWindow)).filter(text =>
              [previewDecl, previewDet, ignored].some(port =>
                text.includes(String(port)),
              ),
            ),
          ],
        },
        {
          origins: [
            [
              [String(browserDecl), 'Dev Containers'],
              [String(browserDet), 'Auto Forwarded'],
            ].sort((first, second) =>
              String(first[0]).localeCompare(String(second[0])),
            ),
            [
              [String(previewDecl), 'Dev Containers'],
              [String(previewDet), 'Auto Forwarded'],
              [String(ignored), 'Dev Containers'],
            ].sort((first, second) =>
              String(first[0]).localeCompare(String(second[0])),
            ),
          ],
          icons: [
            [
              'codicon-ports-forwarded-with-process-icon',
              'codicon-ports-forwarded-with-process-icon',
            ],
            [
              'codicon-ports-forwarded-with-process-icon',
              'codicon-ports-forwarded-with-process-icon',
              'codicon-ports-forwarded-with-process-icon',
            ],
          ],
          tabs: [[], []],
          browser: [],
          notices: [[], []],
        },
      );
    } finally {
      for (const stop of [...browserStops, ...previewStops]) {
        await stop();
      }
    }
  });

  it('F-1101 AC-14 (preview-below-10000): openPreview on a declared port below 10000 opens an editor tab titled localhost:<port> whose request reaches the listener, with the Ports view never shown', async () => {
    let port = 7143;
    while (port === 9229 || !(await isFree(port))) {
      port -= 1;
    }
    const logFile = recordBrowserOpens();
    const window = await connectedWith('c73b-ac14p', {
      forwardPorts: [port],
      portsAttributes: {[String(port)]: {onAutoForward: 'openPreview'}},
    });
    const [containerId = ''] = await devContainersOf(folderOf('c73b-ac14p'));
    let tabOpened = false;
    try {
      // The Ports view is not shown in this row: core detects and reacts without it. A port that already listens when
      // core makes its first scan is one of its initial candidates, which core does not act on, so the listener starts
      // after the scan, which the connect has long begun by then; the criterion is about a process detected later.
      await new Promise(resolve =>
        setTimeout(resolve, INITIAL_SCAN_MILLISECONDS),
      );
      await execFileAsync('docker', [
        'exec',
        '-d',
        containerId,
        'sh',
        '-c',
        // tee keeps what a connection sends in the log as it arrives, and gives it back.
        `: > /tmp/c73b-ac14p.log; nc -lk -p ${String(port)} -e tee -a /tmp/c73b-ac14p.log`,
      ]);
      await waitFor(
        `a localhost:${String(port)} tab`,
        async () => {
          tabOpened = (await editorTabs(window))
            .map(entry => entry.label)
            .includes(`localhost:${String(port)}`);
          return tabOpened;
        },
        120_000,
      ).catch(() => undefined);
      async function requestLog(): Promise<string> {
        const {stdout} = await execFileAsync('docker', [
          'exec',
          containerId,
          'cat',
          '/tmp/c73b-ac14p.log',
        ]);
        return stdout;
      }
      // The preview tab asks for the page when it has loaded, a moment after it opens.
      await waitFor(
        'the preview’s request at the listener',
        async () => (await requestLog()).includes('GET /'),
        30_000,
      ).catch(() => undefined);
      deepStrictEqual(
        {
          tabOpened,
          tabs: (await editorTabs(window))
            .map(entry => entry.label)
            .filter(label => label.startsWith('localhost:')),
          request: (await requestLog()).includes('GET /'),
          notice: (await notificationCentre(window)).filter(text =>
            text.includes(String(port)),
          ),
          browser: browserOpens(logFile),
        },
        {
          tabOpened: true,
          tabs: [`localhost:${String(port)}`],
          request: true,
          notice: [],
          browser: [],
        },
      );
    } finally {
      await execFileAsync('docker', [
        'exec',
        '--user',
        'root',
        containerId,
        'sh',
        '-c',
        `pkill -f '[n]c -lk -p ${String(port)}' || true`,
      ]).catch(() => undefined);
    }
  });

  it('F-1101 AC-28 (ignore-undeclared): a port with onAutoForward ignore and no forwardPorts entry is never forwarded: no row after 40+ s, the status bar stays No Ports Forwarded, and no notice', async () => {
    const ignoredPort = await freePort();
    const ignoreWindow = await connectedWith('c73b-ac28a', {
      otherPortsAttributes: {onAutoForward: 'ignore'},
    });
    const [ignoreId = ''] = await devContainersOf(folderOf('c73b-ac28a'));
    const stopIgnore = await ensureListening(ignoreId, ignoredPort, () =>
      listenInTerminal(ignoreWindow, ignoreId, ignoredPort),
    );
    try {
      await showPorts(ignoreWindow);
      await new Promise(resolve => setTimeout(resolve, 45_000));
      const never = portsOf(await portsRows(ignoreWindow).catch(() => []));
      const status = await statusItem(ignoreWindow, 'status.forwardedPorts');
      deepStrictEqual(
        {
          ignored: never,
          aria: status.ariaLabel,
          visible: status.text,
          notice: (await notificationCentre(ignoreWindow)).filter(text =>
            text.includes(String(ignoredPort)),
          ),
        },
        {
          ignored: [],
          aria: 'No Ports Forwarded',
          visible: '0',
          notice: [],
        },
      );
    } finally {
      await stopIgnore();
    }
  });

  it('F-1101 AC-28 (forwarded-plain): the same listener without the ignore override is forwarded', async () => {
    const plainPort = await freePort();
    const plainWindow = await connectedWith('c73b-ac28b', {});
    const [plainId = ''] = await devContainersOf(folderOf('c73b-ac28b'));
    const stopPlain = await ensureListening(plainId, plainPort, () =>
      listenInTerminal(plainWindow, plainId, plainPort),
    );
    try {
      // The rows are read from the Ports view, so it is shown first; a view that is not shown has no table to read.
      await showPorts(plainWindow);
      const plain = (
        await rowsWhen(plainWindow, shown =>
          shown.some(each => each.port === String(plainPort)),
        )
      ).find(each => each.port === String(plainPort));
      deepStrictEqual(
        [plain?.origin, plain?.forwardedAddress],
        ['Auto Forwarded', `localhost:${String(plainPort)}`],
      );
    } finally {
      await stopPlain();
    }
  });
});
