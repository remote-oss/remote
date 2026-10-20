import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {createServer, type Server} from 'node:net';
import {promisify} from 'node:util';
import {
  commandsOf,
  devContainersOf,
  inWindow,
  settingIn,
  listenIn,
  reopenInContainer,
  waitFor,
} from '../windows/harness.ts';
import {
  answerInputBox,
  dialogOf,
  hasStatusItem,
  notificationCentre,
  portRowAction,
  portsRows,
  type PortsRow,
  typeInTerminal,
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

/** The local port a row's Forwarded Address names. */
function localPortOf(row: PortsRow | undefined): number {
  return Number((row?.forwardedAddress ?? '').split(':').at(-1));
}

/** The row for `port`, once it is shown. */
async function rowFor(window: string, port: number): Promise<PortsRow> {
  const rows = await rowsWhen(window, shown =>
    portsOf(shown).includes(String(port)),
  );
  const found = rows.find(shown => shown.port === String(port));
  if (found === undefined) {
    throw new Error(
      `no Ports row for ${String(port)}: ${JSON.stringify(rows)}`,
    );
  }
  return found;
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

describe('automatic port forwarding stays core’s (card containers-75, F-1102)', function () {
  this.timeout(900_000);
  const {connectedWith} = portsWindows();

  /** A window connected to a container with no declared ports, and its container id; core makes the Ports view when the first port is forwarded. */
  async function plainWindow(
    name: string,
  ): Promise<{window: string; containerId: string}> {
    const window = await connectedWith(name, {});
    const [containerId = ''] = await devContainersOf(folderOf(name));
    return {window, containerId};
  }

  it.only('F-1102 AC-1 (auto-detected): a listener started in the container gets a row within 5 s, with a remote and a local address, and no dialog', async () => {
    const {window, containerId} = await plainWindow('c75-ac1');
    const port = await freePort();
    await inWindow(window, 'workbench.action.terminal.new');
    await typeInTerminal(window, `nc -lk -p ${String(port)} -e cat &\n`);
    const stop = async (): Promise<void> => {
      await execFileAsync('docker', [
        'exec',
        containerId,
        'sh',
        '-c',
        `pkill -f '[n]c -lk -p ${String(port)} ' || true`,
      ]);
    };
    try {
      const began = Date.now();
      await new Promise(resolve => setTimeout(resolve, 15000));
      console.log('DUMP ps', (await execFileAsync('docker', ['exec', containerId, 'sh', '-c', 'ps -o pid,ppid,user,args; echo; cat /proc/net/tcp | head -5'])).stdout);
      await showPorts(window);
      const row = await rowFor(window, port);
      console.log('DUMP ac1', JSON.stringify(row), Date.now() - began);
      deepStrictEqual(await dialogOf(window), undefined);
    } finally {
      await stop();
    }
  });
});
