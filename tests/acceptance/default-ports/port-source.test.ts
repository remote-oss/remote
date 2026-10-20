import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  type ForwardedTunnel,
  inWindow,
  nextEmptyWindow,
  onHost,
  openWindow,
  readUserSettings,
  reloadWindow,
  restoreUserSettings,
  settingDefaultIn,
  settingIn,
  tunnelsOf,
  userSettings,
  waitFor,
} from '../windows/harness.ts';
import {
  notificationButtons,
  notificationCentre,
  notifications,
  statusItem,
} from '../windows/renderer.ts';
import {greetingOf} from './greeting.ts';

/** The setting whose default an SSH window takes from the resolver. */
const SOURCE_SETTING = 'remote.autoForwardPortsSource';

/** The remote port of the launch's default forward. */
const DEFAULT_PORT = 8632;

/** How long the rows watch for a forward that must not come (F-2507 §6.4 step 2). */
const WATCH_MILLISECONDS = 20_000;

/** Starts a listener on the host's loopback `port` that answers with `greeting`, outside VS Code. */
async function listenOnHost(port: number, greeting: string): Promise<void> {
  await onHost(
    'sh',
    '-c',
    `nc -lk -p ${String(port)} -s 127.0.0.1 -e /bin/echo ${greeting} >/dev/null 2>&1 &`,
  );
}

/** The remote ports of window `name`'s tunnels, in the editor's order. */
async function remotePortsOf(name: string): Promise<number[]> {
  return (await tunnelsOf(name)).map(tunnel => tunnel.remotePort);
}

/** Waits until window `name` forwards remote `port`, for up to `milliseconds`, and gives that tunnel. */
async function tunnelFor(
  name: string,
  port: number,
  milliseconds: number,
): Promise<ForwardedTunnel> {
  let found: ForwardedTunnel | undefined;
  await waitFor(
    `window ${name} to forward port ${String(port)}`,
    async () => {
      found = (await tunnelsOf(name)).find(
        tunnel => tunnel.remotePort === port,
      );
      return found !== undefined;
    },
    milliseconds,
  );
  return found ?? {remotePort: port, localAddress: ''};
}

/** The port of a tunnel's local address, `<host>:<port>`. */
function localPortOf(tunnel: ForwardedTunnel): number {
  return Number(
    tunnel.localAddress.slice(tunnel.localAddress.lastIndexOf(':') + 1),
  );
}

describe('the port source of an SSH window (card connect-81)', function () {
  this.timeout(180_000);

  after(async () => {
    await onHost('sh', '-c', "pkill -f 'n[c] -lk -p 864'; true");
  });

  it('F-2507 AC-20 (source-default): an SSH window defaults the port source to output, a local window keeps process, and no settings file is written', async () => {
    const before = readUserSettings();
    await openWindow('harness', 'ps1');
    try {
      await tunnelFor('ps1', DEFAULT_PORT, 30_000);
      deepStrictEqual(
        {
          sshDefault: await settingDefaultIn('ps1', SOURCE_SETTING),
          sshValue: await settingIn('ps1', SOURCE_SETTING),
          localDefault: await settingDefaultIn('local', SOURCE_SETTING),
          localValue: await settingIn('local', SOURCE_SETTING),
          settingsUnchanged: readUserSettings() === before,
          settingWritten: readUserSettings()?.includes(SOURCE_SETTING) ?? false,
        },
        {
          sshDefault: 'output',
          sshValue: 'output',
          localDefault: 'process',
          localValue: 'process',
          settingsUnchanged: true,
          settingWritten: false,
        },
      );
    } finally {
      await closeWindow('ps1');
    }
  });

  it('F-2507 AC-21 (outside-not-forwarded): a server started outside VS Code while the window is connected is not forwarded, nor is the connection\u2019s own server', async () => {
    await openWindow('harness', 'ps2');
    try {
      await tunnelFor('ps2', DEFAULT_PORT, 30_000);
      // Core's process scan skips the ports already listening when the window opened, so the listener starts after.
      await listenOnHost(8641, 'ps-8641');
      await new Promise(resolve => setTimeout(resolve, WATCH_MILLISECONDS));
      deepStrictEqual(await remotePortsOf('ps2'), [DEFAULT_PORT]);
    } finally {
      await closeWindow('ps2');
    }
  });

  it('F-2507 AC-21, AC-38 (terminal-forwarded): a server in a VS Code terminal that prints its URL is forwarded, with core’s notification', async () => {
    await openWindow('harness', 'ps3');
    try {
      await tunnelFor('ps3', DEFAULT_PORT, 30_000);
      await inWindow('ps3', 'workbench.action.terminal.new');
      await inWindow('ps3', 'workbench.action.terminal.sendSequence', {
        text: "printf 'Serving on http://127.0.0.1:%s\\n' 8642; nc -lk -p 8642 -s 127.0.0.1 -e /bin/echo ps-8642\r",
      });
      const tunnel = await tunnelFor('ps3', 8642, 10_000);
      const message = 'Your application running on port 8642 is available.';
      async function shown(): Promise<boolean> {
        return (await notifications('ps3')).some(text =>
          text.startsWith(message),
        );
      }
      await waitFor('the automatic forward’s toast', shown, 10_000);
      await waitFor(
        'the automatic forward’s toast to hide',
        async () => !(await shown()),
        20_000,
      );
      deepStrictEqual(
        {
          greeting: await greetingOf(localPortOf(tunnel)),
          inCentre: (await notificationCentre('ps3')).some(text =>
            text.startsWith(message),
          ),
          buttons: await notificationButtons('ps3', message),
        },
        {
          greeting: 'ps-8642',
          inCentre: true,
          buttons: ['Open in Browser', 'Preview in Editor'],
        },
      );
    } finally {
      await closeWindow('ps3');
    }
  });

  it('F-2507 AC-22 (user-process): with the user value process, a server started outside VS Code is forwarded', async () => {
    const saved = readUserSettings();
    await userSettings({[SOURCE_SETTING]: 'process'});
    try {
      await openWindow('harness', 'ps4');
      try {
        await tunnelFor('ps4', DEFAULT_PORT, 30_000);
        await listenOnHost(8643, 'ps-8643');
        const tunnel = await tunnelFor('ps4', 8643, WATCH_MILLISECONDS);
        deepStrictEqual(await greetingOf(localPortOf(tunnel)), 'ps-8643');
      } finally {
        await closeWindow('ps4');
      }
    } finally {
      restoreUserSettings(saved);
    }
  });
});

/** How long, and how often, the rows of F-2507 6.4 step 5 watch a window for a forward of its own. */
const OWN_PORTS_MILLISECONDS = 60_000;
const OWN_PORTS_READ_MILLISECONDS = 5000;

/** What the forwarded-ports status item says while nothing is forwarded or detected ([oss] remoteExplorer.ts). */
const NO_PORTS = 'No Ports Forwarded';

/** The accessible label of window `name`'s forwarded-ports item, once core has drawn it (up to 15 s after the connect). */
async function forwardedPortsLabel(name: string): Promise<string> {
  let label: string | undefined;
  await waitFor(
    `window ${name} to draw its forwarded-ports item`,
    async () => {
      label = await statusItem(name, 'status.forwardedPorts').then(
        item => item.ariaLabel,
        () => undefined,
      );
      return label !== undefined;
    },
    15_000,
  );
  return label ?? '';
}

/**
 * What window `name` forwards over the watch: the remote ports of its tunnels at each read, and the status item's
 * accessible label at the start and the end. A fixed watch, since the rows are about a forward that must not come.
 */
async function watchOf(
  name: string,
): Promise<{reads: number[][]; status: string[]}> {
  const status = [await forwardedPortsLabel(name)];
  const reads: number[][] = [];
  for (
    let waited = 0;
    waited < OWN_PORTS_MILLISECONDS;
    waited += OWN_PORTS_READ_MILLISECONDS
  ) {
    await new Promise(resolve =>
      setTimeout(resolve, OWN_PORTS_READ_MILLISECONDS),
    );
    reads.push(await remotePortsOf(name));
  }
  status.push(await forwardedPortsLabel(name));
  return {reads, status};
}

/** The watches of a window that connects, reloads, and closes its remote connection and connects again. */
async function ownPortsOf(
  folder: string,
): Promise<Record<string, {reads: number[][]; status: string[]}>> {
  await openWindow('harness', folder);
  const connect = await watchOf(folder);
  await reloadWindow(folder);
  const reload = await watchOf(folder);
  const emptied = await nextEmptyWindow(() =>
    inWindow(folder, 'workbench.action.remote.close'),
  );
  // The closed window is a local empty window now; the connection is made again in a window of its own folder.
  await openWindow('harness', `${folder}r`);
  try {
    return {connect, reload, reconnect: await watchOf(`${folder}r`)};
  } finally {
    await closeWindow(`${folder}r`);
    await closeWindow(emptied);
  }
}

/** A watch in which nothing was forwarded and the status item said so. */
const NOTHING_FORWARDED = {
  reads: Array.from(
    {length: OWN_PORTS_MILLISECONDS / OWN_PORTS_READ_MILLISECONDS},
    () => [],
  ),
  status: [NO_PORTS, NO_PORTS],
};

describe('no port of the connection itself is forwarded (card connect-82)', function () {
  this.timeout(900_000);

  /** The user settings with no default forward, so that only automatic forwards could appear. */
  async function withoutDefaults(
    change: Readonly<Record<string, unknown>>,
  ): Promise<string | undefined> {
    const saved = readUserSettings();
    await userSettings({'remote.SSH.defaultForwardedPorts': [], ...change});
    return saved;
  }

  it('F-2507 AC-43 (own-ports-output): with the default source, nothing is forwarded for 60 s after a connect, a reload, and a close and reconnect', async () => {
    const saved = await withoutDefaults({});
    try {
      deepStrictEqual(await ownPortsOf('po1'), {
        connect: NOTHING_FORWARDED,
        reload: NOTHING_FORWARDED,
        reconnect: NOTHING_FORWARDED,
      });
    } finally {
      restoreUserSettings(saved);
    }
  });

  it('F-2507 AC-43 (own-ports-process): with the user value process, nothing is forwarded for 60 s after a connect, a reload, and a close and reconnect', async () => {
    const saved = await withoutDefaults({[SOURCE_SETTING]: 'process'});
    try {
      deepStrictEqual(await ownPortsOf('po2'), {
        connect: NOTHING_FORWARDED,
        reload: NOTHING_FORWARDED,
        reconnect: NOTHING_FORWARDED,
      });
    } finally {
      restoreUserSettings(saved);
    }
  });
});
