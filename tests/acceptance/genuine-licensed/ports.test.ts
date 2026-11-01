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
        (await portsRows(window).catch(() => [])).some(entry =>
          entry.port.includes('8681'),
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
   * The row of a forwarded port whose local end is remapped: the host's port `remote` is forwarded while the client
   * holds the same local port, so the editor gives it another one; then a process of the host listens on that local
   * port's number. Gives the ports whose rows the view shows.
   */
  async function remappedPorts(remote: number): Promise<string[]> {
    await userSettings({
      'remote.autoForwardPortsSource': 'process',
      'remote.autoForwardPorts': true,
    });
    const holder = createServer();
    await new Promise<void>((resolve, reject) => {
      holder.once('error', reject);
      holder.listen(remote, '127.0.0.1', resolve);
    });
    try {
      await listenOnHost(remote, `ports-${String(remote)}`);
      await forwardByHand(window, remote);
      const remapped = await localPortOf(window, remote);
      await listenOnHost(remapped, `ports-${String(remapped)}`);
      await inWindow(window, FOCUS_PORTS);
      // The editor looks for the host's listening processes every few seconds.
      await new Promise(resolve => setTimeout(resolve, 30_000));
      return (await portsRows(window)).map(entry => entry.port);
    } finally {
      await new Promise<void>(resolve => {
        holder.close(() => {
          resolve();
        });
      });
    }
  }

  atVersion(FLOOR)(
    'ADR-0007 floor (ports-remapped, 1.125): core does not filter the process that listens on a remapped tunnel’s local port from automatic forwarding, so it is forwarded too',
    async () => {
      const ports = await remappedPorts(8683);
      deepStrictEqual(ports.length > 1, true);
    },
  );

  atVersion(RECORDED)(
    'ADR-0007 floor (ports-remapped, 1.139): core filters the process that listens on a remapped tunnel’s local port from automatic forwarding, so only the tunnel’s own row is shown',
    async () => {
      const ports = await remappedPorts(8685);
      deepStrictEqual(ports.length, 1);
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
        (await portsRows(window).catch(() => [])).some(entry =>
          entry.port.includes(String(remote)),
        ),
      60_000,
    );
    return (await portProtocolChoices(window, String(remote))).choices;
  }

  atVersion(FLOOR)(
    'ADR-0007 floor (ports-protocol, 1.125): core’s protocol context is https for an http listener, so the Change Port Protocol menu has HTTPS checked',
    async () => {
      deepStrictEqual(await protocolOf(8687), [
        ['HTTP', false],
        ['HTTPS', true],
      ]);
    },
  );

  atVersion(RECORDED)(
    'ADR-0007 floor (ports-protocol, 1.139): core’s protocol context is http for an http listener, so the Change Port Protocol menu has HTTP checked',
    async () => {
      deepStrictEqual(await protocolOf(8689), [
        ['HTTP', true],
        ['HTTPS', false],
      ]);
    },
  );
});
