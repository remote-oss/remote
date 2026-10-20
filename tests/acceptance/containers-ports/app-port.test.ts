import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {
  devContainersOf,
  listenIn,
  reopenInContainer,
} from '../windows/harness.ts';
import {
  dialogOf,
  notificationCentre,
  portRowActions,
  statusItem,
} from '../windows/renderer.ts';
import {
  echoes,
  editConfiguration,
  folderOf,
  freePort,
  portsWindows,
  rowsWhen,
  showPorts,
} from './ports-support.ts';

const execFileAsync = promisify(execFile);

/** The published ports of the container made for `folder`, as Docker reports them: `<container port>/tcp` to its host bindings. */
async function publishedPorts(
  folder: string,
): Promise<Record<string, Array<{HostIp: string; HostPort: string}>>> {
  const [containerId = ''] = await devContainersOf(folder);
  const {stdout} = await execFileAsync('docker', [
    'inspect',
    '--format',
    '{{json .NetworkSettings.Ports}}',
    containerId,
  ]);
  return JSON.parse(stdout) as Record<
    string,
    Array<{HostIp: string; HostPort: string}>
  >;
}

describe('the appPort rows (card containers-74)', function () {
  this.timeout(900_000);
  const {connectedWith} = portsWindows();

  it('F-1101 AC-5 (app-port-published): an appPort number is published on 127.0.0.1 and a host:container string on all interfaces, both reachable from the host', async () => {
    const [number, host, container] = [
      await freePort(),
      await freePort(),
      await freePort(),
    ];
    await connectedWith('c74-ac5', {
      appPort: [number, `${String(host)}:${String(container)}`],
    });
    const [containerId = ''] = await devContainersOf(folderOf('c74-ac5'));
    const stops = [
      await listenIn(containerId, number),
      await listenIn(containerId, container),
    ];
    const published = await publishedPorts(folderOf('c74-ac5'));
    const reachable = [
      await echoes(`127.0.0.1:${String(number)}`),
      await echoes(`127.0.0.1:${String(host)}`),
    ];
    for (const stop of stops) {
      await stop();
    }
    const bindings = published[`${String(container)}/tcp`] ?? [];
    deepStrictEqual(
      [
        published[`${String(number)}/tcp`]?.map(each => [
          each.HostIp,
          each.HostPort,
        ]),
        [...new Set(bindings.map(each => each.HostPort))],
        bindings.map(each => each.HostIp).sort(),
        reachable,
      ],
      [
        [['127.0.0.1', String(number)]],
        [String(host)],
        ['0.0.0.0', '::'],
        [true, true],
      ],
    );
  });

  it('F-1101 AC-6 (app-port-attribute): an attribute for the port, added with a rebuild, gives the row no label, and its origin is Statically Forwarded', async () => {
    const port = await freePort();
    const window = await connectedWith('c74-ac6', {appPort: [port]});
    editConfiguration(folderOf('c74-ac6'), {
      appPort: [port],
      portsAttributes: {[String(port)]: {label: 'web'}},
    });
    await reopenInContainer(
      window,
      300_000,
      'remote-containers.rebuildContainer',
    );
    await showPorts(window);
    const rows = await rowsWhen(window, shown => shown.length > 0);
    deepStrictEqual(
      rows.map(shown => [shown.port, shown.origin]),
      [[String(port), 'Statically Forwarded']],
    );
  });

  it('F-1101 AC-20 (app-port-and-forward): the same port in forwardPorts and in appPort gives two rows, one for each origin', async () => {
    const port = await freePort();
    const window = await connectedWith('c74-ac20', {
      forwardPorts: [port],
      appPort: [port],
    });
    await showPorts(window);
    const rows = await rowsWhen(window, shown => shown.length > 1);
    deepStrictEqual(
      [
        rows.map(shown => shown.origin).sort(),
        await dialogOf(window),
        (await notificationCentre(window)).filter(text =>
          /error|failed/i.test(text),
        ),
      ],
      [['Dev Containers', 'Statically Forwarded'], undefined, []],
    );
  });

  it('F-1101 AC-24 (app-port-actions): a Statically Forwarded row offers copying the address, opening in the browser and previewing, and the menu adds only Forward a Port, with or without a process listening', async () => {
    const port = await freePort();
    const window = await connectedWith('c74-ac24', {appPort: [port]});
    await showPorts(window);
    await rowsWhen(window, shown => shown.length > 0);
    const without = await portRowActions(window, String(port));
    const [containerId = ''] = await devContainersOf(folderOf('c74-ac24'));
    const stop = await listenIn(containerId, port);
    const listening = await portRowActions(window, String(port));
    await stop();
    const offered = {
      inline: ['Copy Local Address', 'Open in Browser', 'Preview in Editor'],
      menu: [
        'Open in Browser',
        'Preview in Editor',
        'Copy Local Address',
        'Forward a Port',
      ],
    };
    deepStrictEqual([without, listening], [offered, offered]);
  });

  it('F-1101 AC-40 (ruling-1334): a host:container row shows the tooltip of its container port at the host port on [::1] and no running process, no Auto Forwarded row comes for it, and the status item names the ports in the order of appPort', async () => {
    const [number, host, container] = [
      await freePort(),
      await freePort(),
      await freePort(),
    ];
    const window = await connectedWith('c74-ac40', {
      appPort: [number, `${String(host)}:${String(container)}`],
    });
    const [containerId = ''] = await devContainersOf(folderOf('c74-ac40'));
    const stop = await listenIn(containerId, container);
    await showPorts(window);
    const rows = await rowsWhen(window, shown => shown.length > 1);
    await new Promise(resolve => setTimeout(resolve, 3000));
    await stop();
    const shown = rows.find(each => each.port === String(container));
    deepStrictEqual(
      {
        tooltip: shown?.tooltip,
        process: shown?.runningProcess,
        origins: rows.map(each => each.origin).sort(),
        status: (await statusItem(window, 'status.forwardedPorts')).ariaLabel,
      },
      {
        process: '',
        tooltip: `Remote port 0.0.0.0:${String(container)} forwarded to local address [::1]:${String(host)}.`,
        origins: ['Statically Forwarded', 'Statically Forwarded'],
        status: `Forwarded Ports: ${String(number)}, ${String(container)}`,
      },
    );
  });
});
