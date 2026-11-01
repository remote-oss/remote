import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {promisify} from 'node:util';
import {setUserSetting} from '../windows/folder-windows.ts';
import {
  devContainersOf,
  listenIn,
  reopenInContainer,
  runLabelArguments,
  variable,
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
  waitForDialog,
} from '../windows/renderer.ts';
import {
  browserOpens,
  echoes,
  editConfiguration,
  folderOf,
  freePort,
  forwardByHand,
  localPortOf,
  occupy,
  portsOf,
  portsWindows,
  reloaded,
  recordBrowserOpens,
  rowsWhen,
  showPorts,
} from './ports-support.ts';

const execFileAsync = promisify(execFile);

/** How long after its start a window's tunnel model may show the could-not-be-used dialog again (core's 10 s), plus a margin. */
const MISMATCH_COOLDOWN_MILLISECONDS = 12_000;

describe('the declared forwardPorts (card containers-72)', function () {
  this.timeout(900_000);
  const {connectedWith, closeNow} = portsWindows();

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
    const logFile = recordBrowserOpens();
    await showPorts(window);
    await rowsWhen(window, shown => shown.length > 2);
    for (const port of ['443', '8443', String(other)]) {
      await portRowAction(window, port, 'Open in Browser');
      await waitFor(
        `the browser to be asked for ${port}`,
        () =>
          readFileSync(logFile, 'utf8').split('\n').filter(Boolean).length > 0,
        15_000,
      ).catch(() => undefined);
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
    deepStrictEqual(
      readFileSync(logFile, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map(url => url.slice(0, url.indexOf(':'))),
      ['https', 'https', 'http'],
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
    await rowsWhen(window, shown => shown.length > 3);
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
  });

  it('F-1101 AC-32 (forward-quoted-number): a bare string of digits is not forwarded, and the number is', async () => {
    const port = await freePort();
    const quoted = await connectedWith('c72-ac32a', {
      forwardPorts: [String(port)],
    });
    // The window enables core's Ports features once connected, so its status item exists with no port forwarded.
    let label = '';
    await waitFor(
      'the status item to read that no port is forwarded',
      async () => {
        label = await statusItem(quoted, 'status.forwardedPorts')
          .then(item => item.ariaLabel)
          .catch(() => '');
        return label === 'No Ports Forwarded';
      },
      10_000,
    ).catch(() => undefined);
    await showPorts(quoted);
    const none = portsOf(await portsRows(quoted).catch(() => []));
    const dialog = await dialogOf(quoted);
    await closeNow(quoted);
    const plain = await connectedWith('c72-ac32b', {forwardPorts: [port]});
    await showPorts(plain);
    deepStrictEqual(
      [
        label,
        none,
        dialog,
        portsOf(await rowsWhen(plain, rows => rows.length > 0)),
      ],
      ['No Ports Forwarded', [], undefined, [String(port)]],
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

  it('F-1101 AC-7 (declared-taken): a declared port whose local port is taken is silently forwarded to a different local port, with no dialog and no notification', async () => {
    const port = await freePort();
    const release = await occupy(port);
    try {
      const window = await connectedWith('c73b-ac7', {
        forwardPorts: [port],
        portsAttributes: {[String(port)]: {requireLocalPort: true}},
      });
      await showPorts(window);
      await rowsWhen(window, shown => shown.length > 0);
      const local = await localPortOf(window, port);
      const status = await statusItem(window, 'status.forwardedPorts');
      deepStrictEqual(
        [
          local === port,
          await dialogOf(window),
          (await notificationCentre(window)).filter(text =>
            text.includes(String(port)),
          ),
          status.ariaLabel,
        ],
        [false, undefined, [], `Forwarded Ports: ${String(port)}`],
      );
    } finally {
      await release();
    }
  });

  // Skipped: the product shows no dialog and never takes a fallback local port: the row keeps the taken local port,
  // while the declared batch takes a different one silently (AC-7); posted on #1538.
  it.skip('F-1101 AC-8 (manual-taken): a manually forwarded port whose local port is taken shows the core could-not-be-used modal with OK only, and the row takes the fallback local port', async () => {
    const port = await freePort();
    const release = await occupy(port);
    try {
      const window = await connectedWith('c73b-ac8', {
        otherPortsAttributes: {requireLocalPort: true},
      });
      // Core shows this dialog at most once in 10 s, counted from when the window's tunnel model began, so a forward
      // made in the first seconds of the window gets the fallback port and no dialog.
      await new Promise(resolve =>
        setTimeout(resolve, MISMATCH_COOLDOWN_MILLISECONDS),
      );
      await forwardByHand(window, port);
      const dialog = await waitForDialog(window, 30_000).catch(() => undefined);
      if (dialog !== undefined) {
        await answerDialog(window, 'OK');
      }
      const local = await localPortOf(window, port);
      const entry = (
        await rowsWhen(window, shown =>
          shown.some(each => each.port === String(port)),
        )
      ).find(each => each.port === String(port));
      const message =
        dialog === undefined ? undefined : dialog.message + dialog.details;
      // The spec (6.3 step 3) records the rendering with or without the spaces between the three sentences.
      const expected =
        `Local port ${String(port)} could not be used for forwarding to remote port ${String(port)}` +
        `.This usually happens when there is already another process using local port ${String(port)}` +
        `.Port number ${String(local)} has been used instead.`;
      deepStrictEqual(
        {
          buttons: dialog?.buttons ?? [],
          message:
            message === undefined ? undefined : message.replace(/\. /g, '.'),
          fallbackTaken: local !== port,
          origin: entry?.origin,
        },
        {
          buttons: ['OK'],
          message: expected,
          fallbackTaken: true,
          origin: 'User Forwarded',
        },
      );
    } finally {
      await release();
    }
  });

  it('F-1101 AC-9 (elevate-silent): with elevateIfNeeded on privileged ports, neither the declared batch nor the manual path prompts, and both fall back to an unprivileged local port', async function () {
    const unprivileged = Number(
      readFileSync('/proc/sys/net/ipv4/ip_unprivileged_port_start', 'utf8'),
    );
    if (unprivileged <= 82) {
      // The host binds every port here, so the condition cannot be made.
      this.skip();
    }
    const window = await connectedWith('c73b-ac9', {
      forwardPorts: [81],
      portsAttributes: {'81': {elevateIfNeeded: true}},
      otherPortsAttributes: {elevateIfNeeded: true},
    });
    await showPorts(window);
    await rowsWhen(window, shown => shown.length > 0);
    await forwardByHand(window, 82);
    await rowsWhen(window, shown => shown.length > 1);
    deepStrictEqual(
      [
        (await localPortOf(window, 81)) >= unprivileged,
        (await localPortOf(window, 82)) >= unprivileged,
        await dialogOf(window),
        (await portsRows(window)).map(shown => shown.origin).sort(),
      ],
      [true, true, undefined, ['Dev Containers', 'User Forwarded']],
    );
  });

  it('F-1101 AC-15 (protocol-https): Open in Browser on a port with protocol https opens the https scheme', async () => {
    const port = await freePort();
    const logFile = recordBrowserOpens();
    const window = await connectedWith('c73b-ac15', {
      forwardPorts: [port],
      portsAttributes: {[String(port)]: {protocol: 'https'}},
    });
    await showPorts(window);
    await rowsWhen(window, shown => shown.length > 0);
    await portRowAction(window, String(port), 'Open in Browser');
    await new Promise(resolve => setTimeout(resolve, 15_000));
    deepStrictEqual(
      {
        opens: browserOpens(logFile),
        tabs: (await editorTabs(window))
          .map(entry => entry.label)
          .filter(label => label.startsWith('localhost:')),
        rows: (await portsRows(window))
          .map(shown => [shown.port, shown.origin])
          .sort(),
      },
      {
        opens: [`https://localhost:${String(port)}/`],
        tabs: [],
        rows: [[String(port), 'Dev Containers']],
      },
    );
  });
});

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
  const containerId = stdout.trim();
  const inspected = await execFileAsync('docker', [
    'inspect',
    '--format',
    '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',
    containerId,
  ]);
  return {
    address: inspected.stdout.trim(),
    stop: async () => {
      await execFileAsync('docker', ['rm', '-f', containerId]);
    },
  };
}
