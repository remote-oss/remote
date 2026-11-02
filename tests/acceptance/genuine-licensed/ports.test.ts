import {deepStrictEqual} from 'node:assert';
import {connect, createServer} from 'node:net';
import {
  closeWindow,
  editorProduct,
  inWindow,
  isOpen,
  onHost,
  openWindow,
  readUserSettings,
  restoreUserSettings,
  tunnelsOf,
  userSettings,
  waitFor,
  windowNames,
} from '../windows/harness.ts';
import {
  answerDialog,
  answerInputBox,
  clickStatusItem,
  dialogOf,
  portProtocolChoices,
  portsRows,
  portsViewShown,
  statusItemText,
} from '../windows/renderer.ts';

/** The floor of ADR-0007 and the recorded version, as the two versions the launch runs at. */
const FLOOR = '1.125.0';
const RECORDED = '1.139.1';

/** The version of the editor this launch started. */
const VERSION = editorProduct().version;

/** Runs `body` at the version `wanted` only, and is skipped, named by the version, at the other one. */
function atVersion(wanted: string): typeof it {
  return (VERSION === wanted ? it : it.skip) as typeof it;
}

/** The command that shows core's Ports view. */
const FOCUS_PORTS = '~remote.forwardedPorts.focus';

/** The Forwarded Ports status item of core. */
const STATUS_ITEM = 'status.forwardedPorts';

const CONNECT_MILLISECONDS = 600_000;

/** Starts a listener on the host's loopback `port` that answers with `greeting`, outside VS Code. */
async function listenOnHost(port: number, greeting: string): Promise<void> {
  await onHost(
    'sh',
    '-c',
    `nohup nc -lk -p ${String(port)} -s 127.0.0.1 -e /bin/echo ${greeting} >/dev/null 2>&1 &`,
  );
}

/** What the local `port` answers when it is connected to: the first line, or nothing in 5 s. */
function greetingOf(port: number): Promise<string | undefined> {
  return new Promise(resolve => {
    const socket = connect(port, '127.0.0.1');
    let text = '';
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(undefined);
    }, 5000);
    socket.on('data', chunk => {
      text += String(chunk);
      if (text.includes('\n')) {
        clearTimeout(timer);
        socket.destroy();
        resolve(text.trim());
      }
    });
    socket.on('error', () => {
      clearTimeout(timer);
      resolve(undefined);
    });
  });
}

/** Forwards `port` of the window by hand, as a user does with Forward a Port. */
async function forwardByHand(window: string, port: number): Promise<void> {
  const forwarding = inWindow(window, 'remote.tunnel.forwardCommandPalette');
  await answerInputBox(window, String(port));
  await forwarding;
}

/** The local port of the row for `remotePort`, from the window's tunnels. */
async function localPortOf(
  window: string,
  remotePort: number,
): Promise<number> {
  let found = 0;
  await waitFor(
    `the tunnel of port ${String(remotePort)}`,
    async () => {
      const tunnel = (await tunnelsOf(window)).find(
        each => each.remotePort === remotePort,
      );
      found = Number(tunnel?.localAddress.split(':').at(-1));
      return found > 0;
    },
    60_000,
  );
  return found;
}

describe(`the Ports view after a connect past the licence, on VS Code ${VERSION} (card tooling-98, ADR-0007 decision 4)`, function () {
  this.timeout(1_800_000);

  let saved: string | undefined;
  const window = 'ports-1';

  before(async () => {
    saved = readUserSettings();
    for (const name of windowNames()) {
      if (name !== 'local' && isOpen(name)) {
        await closeWindow(name);
      }
    }
    await openWindow('harness', window);
    // The profile of the launch accepted the licence in the rows before; a run of this file alone is asked once.
    await waitFor(
      'the window to connect or the licence to be asked',
      async () =>
        (await dialogOf(window))?.buttons.includes('Accept and Continue') ===
          true ||
        (await statusItemText(window, 'status.host', 'SSH: harness', 1)) ===
          'SSH: harness',
      CONNECT_MILLISECONDS,
    );
    if ((await dialogOf(window))?.buttons.includes('Accept and Continue')) {
      await answerDialog(window, 'Accept and Continue');
    }
    await statusItemText(
      window,
      'status.host',
      'SSH: harness',
      CONNECT_MILLISECONDS,
    );
  });

  after(async () => {
    await onHost('sh', '-c', "pkill -f 'n[c] -lk -p 87[0-9][0-9]'; true");
    await closeWindow(window).catch(() => undefined);
    restoreUserSettings(saved);
  });

  it('ADR-0007 floor (ports-forward): a listener started on the host and forwarded through Forward a Port answers on its local port, at both versions', async () => {
    await listenOnHost(8681, 'ports-8681');
    await forwardByHand(window, 8681);
    const local = await localPortOf(window, 8681);
    await inWindow(window, FOCUS_PORTS);
    await waitFor(
      'the row',
      async () =>
        (await portsRows(window).catch(() => [])).some(
          entry => entry.port === '8681',
        ),
      60_000,
    );
    deepStrictEqual(await greetingOf(local), 'ports-8681');
  });

  /** Clicks the status item twice and reads whether the Ports view is on screen before and after each click. */
  async function twoClicks(): Promise<boolean[]> {
    await inWindow(window, 'workbench.action.closePanel').catch(
      () => undefined,
    );
    await waitFor(
      'the Ports view to be off screen',
      async () => !(await portsViewShown(window)),
      30_000,
    ).catch(() => undefined);
    const shown = [await portsViewShown(window)];
    for (let click = 0; click < 2; click += 1) {
      await clickStatusItem(window, STATUS_ITEM);
      await new Promise(resolve => setTimeout(resolve, 2500));
      shown.push(await portsViewShown(window));
    }
    return shown;
  }

  // [oss] src/vs/workbench/contrib/remote/browser/remoteExplorer.ts: the Forwarded Ports status item's command is
  // `${TUNNEL_VIEW_ID}.focus` at 1.125.0 and `TOGGLE_VIEW_ACTION_ID` (`remoteExplorer.toggleForwardedPortsView`) at 1.139.1.
  atVersion(FLOOR)(
    'ADR-0007 floor (ports-status-item, 1.125): core focuses the Ports view when the Forwarded Ports status item is clicked, and a second click leaves it shown',
    async () => {
      deepStrictEqual(await twoClicks(), [false, true, true]);
    },
  );

  atVersion(RECORDED)(
    'ADR-0007 floor (ports-status-item, 1.139): core toggles the Ports view when the Forwarded Ports status item is clicked, so a second click hides it',
    async () => {
      deepStrictEqual(await twoClicks(), [false, true, false]);
    },
  );

  /**
   * A forwarded port whose local end is remapped: the host's port `remote` is forwarded while the client holds the same
   * local port, so the editor gives it another one; then a process of the host listens on that local port's number.
   * Waits for the view's row of the remapped number for `seconds` and gives the ports of the rows it shows, with the
   * remapped number.
   */
  async function remappedRows(
    remote: number,
    seconds: number,
  ): Promise<{remapped: number; ports: string[]}> {
    await userSettings({
      'remote.autoForwardPortsSource': 'process',
      'remote.autoForwardPorts': true,
    });
    const holder = createServer();
    await new Promise<void>((resolve, reject) => {
      holder.once('error', reject);
      holder.listen(remote, '127.0.0.1', resolve);
    });
    let remapped = 0;
    try {
      await listenOnHost(remote, `ports-${String(remote)}`);
      await forwardByHand(window, remote);
      remapped = await localPortOf(window, remote);
      await listenOnHost(remapped, `ports-${String(remapped)}`);
      await inWindow(window, FOCUS_PORTS);
      // The editor looks for the host's listening processes every few seconds: the wait is the time it has to forward one.
      await waitFor(
        `the row of the remapped port ${String(remapped)}`,
        async () =>
          (await portsRows(window).catch(() => [])).some(
            entry => entry.port === String(remapped),
          ),
        seconds * 1000,
      ).catch(() => undefined);
      return {
        remapped,
        ports: (await portsRows(window)).map(entry => entry.port),
      };
    } finally {
      await onHost(
        'sh',
        '-c',
        `pkill -f 'n[c] -lk -p ${String(remapped)}'; true`,
      );
      await new Promise<void>(resolve => {
        holder.close(() => {
          resolve();
        });
      });
    }
  }

  // [oss] src/vs/workbench/contrib/remote/browser/remoteExplorer.ts at 1.139.1: `isCandidateRemappedTunnelLocalEndpoint`
  // (a process candidate on a localhost or all-interfaces address whose port is the local port of a forwarded tunnel
  // with another remote port) and its use in the process-forwarding loop, which skips such a candidate. At 1.125.0 the
  // function does not exist and the loop forwards the candidate.
  atVersion(FLOOR)(
    'ADR-0007 floor (ports-remapped, 1.125): core does not filter the process that listens on a remapped tunnel’s local port from automatic forwarding, so the view gets a row for that number besides the tunnel’s own',
    async () => {
      const {remapped, ports} = await remappedRows(8683, 90);
      deepStrictEqual(
        [ports.includes('8683'), ports.includes(String(remapped))],
        [true, true],
      );
    },
  );

  atVersion(RECORDED)(
    'ADR-0007 floor (ports-remapped, 1.139): core filters the process that listens on a remapped tunnel’s local port from automatic forwarding, so the view keeps the tunnel’s own row and gets none for that number after the editor’s scans',
    async () => {
      const {remapped, ports} = await remappedRows(8685, 30);
      deepStrictEqual(
        [ports.includes('8685'), ports.includes(String(remapped))],
        [true, false],
      );
    },
  );

  /** The protocol choices of an http listener's row. */
  async function protocolOf(remote: number): Promise<Array<[string, boolean]>> {
    await listenOnHost(remote, `ports-${String(remote)}`);
    await forwardByHand(window, remote);
    await inWindow(window, FOCUS_PORTS);
    await waitFor(
      'the row',
      async () =>
        (await portsRows(window).catch(() => [])).some(
          entry => entry.port === String(remote),
        ),
      60_000,
    );
    return (await portProtocolChoices(window, String(remote))).choices;
  }

  // [oss] src/vs/workbench/contrib/remote/browser/tunnelView.ts, `onFocusChanged` (line 997 at both tags): the view's
  // protocol context key is `item.protocol === Https ? Https : Https` at 1.125.0, always https, and `... ? Https : Http`
  // at 1.139.1. A row's own context menu does not read that key: its context carries the row's own protocol (the
  // `TunnelProtocolContextKey` set from `element.tunnel.protocol` in the table's row context), so the Change Port
  // Protocol menu shows the listener's real protocol at both versions, which the row below asserts.
  it('ADR-0007 floor (ports-protocol-menu): the Change Port Protocol menu of an http listener’s row has HTTP checked, at both versions', async () => {
    deepStrictEqual(await protocolOf(8687), [
      ['HTTP', true],
      ['HTTPS', false],
    ]);
  });

  // Not reproducible as ADR-0007 describes it: the always-https context of 1.125.0 is the view-level key of
  // `onFocusChanged`, which no menu of a row reads, and the genuine job at 1.125.0 measured the row's menu with HTTP
  // checked (run 41365739306), the same as at 1.139.1. Posted on #1634 for athena's amendment of the ADR.
  it.skip('ADR-0007 floor (ports-protocol, 1.125): the Ports view’s protocol context is https for an http listener (skipped: no row read shows it, see #1634)', () =>
    undefined);
});
