import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setUserSetting} from '../windows/folder-windows.ts';
import {
  connectedToContainer,
  devContainersOf,
  inWindow,
  listenIn,
} from '../windows/harness.ts';
import {
  answerDialog,
  answerInputBox,
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
});
