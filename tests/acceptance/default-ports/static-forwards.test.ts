import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {connect, createServer} from 'node:net';
import {promisify} from 'node:util';
import {
  closeWindow,
  connectedWithin,
  connectionLog,
  inWindow,
  onHost,
  openWindow,
  readUserSettings,
  restoreUserSettings,
  userSettings,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {
  dialogOf,
  notificationCentre,
  panelBadge,
  portsRows,
  statusItem,
} from '../windows/renderer.ts';
import {
  holdLocal,
  listenOnHost,
  showPorts,
  tunnelFor,
} from './forward-support.ts';
import {greetingOf} from './greeting.ts';

const execFileAsync = promisify(execFile);

/** The setting of the default forwarded ports. */
const ENTRIES = 'remote.SSH.defaultForwardedPorts';

/** The listeners of the client (`ss`), as lines of the program, the address and the port. */
async function listeners(): Promise<string[]> {
  const {stdout} = await execFileAsync('ss', ['-tlnpH']);
  return stdout.split('\n').filter(line => line.trim() !== '');
}

/** Whether a listener of the client holds `port` on `address`, and the program that does. */
async function holder(
  port: number,
  address: string,
): Promise<string | undefined> {
  const line = (await listeners()).find(entry =>
    new RegExp(`\\s${address.replace('*', '\\*')}:${String(port)}\\s`).test(
      entry,
    ),
  );
  return /users:\(\("([^"]+)"/.exec(line ?? '')?.[1];
}

/** Holds the client's local `port` and keeps what its connections send; `text()` gives it. */
async function receiveOnLocal(
  port: number,
): Promise<{text(): string; release(): Promise<void>}> {
  const chunks: Buffer[] = [];
  const server = createServer(socket => {
    socket.on('data', (chunk: Buffer) => chunks.push(chunk));
    socket.on('error', () => undefined);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    text: () => Buffer.concat(chunks).toString().trim(),
    release: () =>
      new Promise(resolve => {
        server.close(() => {
          resolve();
        });
      }),
  };
}

/** Opens a SOCKS5 connection to `proxy` for `target` on the loopback and gives what the target says first. */
function throughSocks(
  proxy: number,
  target: number,
): Promise<string | undefined> {
  return new Promise(resolve => {
    const socket = connect(proxy, '127.0.0.1');
    const received: Buffer[] = [];
    let stage = 0;
    socket.setTimeout(8000, () => {
      socket.destroy();
    });
    socket.on('connect', () => {
      socket.write(Buffer.from([5, 1, 0]));
    });
    socket.on('data', (chunk: Buffer) => {
      if (stage === 0) {
        stage = 1;
        socket.write(
          Buffer.from([5, 1, 0, 1, 127, 0, 0, 1, target >> 8, target & 255]),
        );
      } else if (stage === 1) {
        stage = chunk[1] === 0 ? 2 : 3;
        if (stage === 3) {
          socket.destroy();
        }
        if (chunk.length > 10) {
          received.push(chunk.subarray(10));
        }
      } else {
        received.push(chunk);
      }
    });
    socket.on('error', () => undefined);
    socket.on('close', () => {
      const text = Buffer.concat(received).toString().trim();
      resolve(text === '' ? undefined : text);
    });
  });
}

describe('the static forwards of the ssh configuration (card coverage-83)', function () {
  this.timeout(300_000);

  let settingsBefore: string | undefined;

  /** Waits until the previous window's forwards are released, which happens a moment after it closes; a row reads these ports as its own. */
  async function portsFree(): Promise<void> {
    await waitFor(
      'the default and static ports to be free',
      async () =>
        (await holder(18632, '127.0.0.1')) === undefined &&
        (await holder(13010, '127.0.0.1')) === undefined,
      90_000,
    );
  }

  before(async () => {
    settingsBefore = readUserSettings();
    await portsFree();
  });

  afterEach(async () => {
    restoreUserSettings(settingsBefore);
    await onHost('sh', '-c', "pkill -f 'n[c] -lk -p 86[0-9][0-9]'; true");
    await portsFree();
  });

  it('F-2507 AC-25 (c83-busy-local): a LocalForward whose local port is in use, without ExitOnForwardFailure, leaves the connection working and shows nothing', async () => {
    // Both loopback names are held, so that no bind of the LocalForward succeeds.
    const releases = [await holdLocal(13020), await holdLocal(13020, '::1')];
    try {
      await openWindow('fwd-busy', 'c83-s25');
      await connectedWithin('c83-s25', 120_000);
      deepStrictEqual(
        {
          dialog: await dialogOf('c83-s25'),
          notices: await notificationCentre('c83-s25'),
        },
        {dialog: undefined, notices: []},
      );
    } finally {
      for (const release of releases) {
        await release();
      }
      await closeWindow('c83-s25');
    }
  });

  it('F-2507 AC-28 (c83-default-and-static): a default entry for a port a LocalForward already covers shows the static local port, with Origin Remote - SSH, and no second listener', async () => {
    await listenOnHost(8657, 'c83-8657');
    await userSettings({
      [ENTRIES]: [{name: 'twin', remotePort: 8657, localPort: 18301}],
    });
    try {
      await openWindow('fwd-static', 'c83-s28');
      await connectedWithin('c83-s28', 120_000);
      await showPorts('c83-s28');
      await waitFor(
        'the row',
        async () =>
          (await portsRows('c83-s28').catch(() => [])).some(entry =>
            entry.port.includes('8657'),
          ),
        30_000,
      );
      const rows = (await portsRows('c83-s28')).filter(
        entry => entry.origin === 'Remote - SSH',
      );
      deepStrictEqual(
        {
          rows: rows.map(entry => [entry.forwardedAddress, entry.origin]),
          named: await greetingOf(18301),
          static: await greetingOf(13010),
        },
        {
          rows: [['localhost:13010', 'Remote - SSH']],
          named: undefined,
          static: 'c83-8657',
        },
      );
    } finally {
      await closeWindow('c83-s28');
    }
  });

  it('F-2507 AC-31 (c83-no-local-server): with remote.SSH.useLocalServer false the default forward listens and the static row is forwarded', async () => {
    await listenOnHost(8651, 'c83-8651');
    await listenOnHost(8657, 'c83-8657');
    await userSettings({
      'remote.SSH.useLocalServer': false,
      // Without the shared connection the platform is asked, unless the settings name it.
      'remote.SSH.remotePlatform': {'fwd-static': 'linux'},
      [ENTRIES]: [{name: 'plain', remotePort: 8651, localPort: 18651}],
    });
    try {
      await openWindow('fwd-static', 'c83-s31');
      await tunnelFor('c83-s31', 8651);
      await showPorts('c83-s31');
      await waitFor(
        'the static row',
        async () =>
          (await portsRows('c83-s31').catch(() => [])).some(
            entry => entry.origin === 'Statically Forwarded',
          ),
        30_000,
      );
      deepStrictEqual(
        {
          default: await greetingOf(18651),
          static: await greetingOf(13010),
          staticRows: (await portsRows('c83-s31'))
            .filter(entry => entry.origin === 'Statically Forwarded')
            .map(entry => [entry.port, entry.forwardedAddress]),
        },
        {
          default: 'c83-8651',
          static: 'c83-8657',
          staticRows: [['8657', 'localhost:13010']],
        },
      );
    } finally {
      await closeWindow('c83-s31');
    }
  });

  it('F-2507 AC-32 (c83-static-writes-nothing): connecting with LocalForward entries writes no settings file and no SSH configuration file', async () => {
    await userSettings({[ENTRIES]: []});
    const configuration = variable('HARNESS_SSH_CONFIG');
    const settingsBefore = readUserSettings();
    const configurationBefore = readFileSync(configuration, 'utf8');
    try {
      await openWindow('fwd-static', 'c83-s32');
      await connectedWithin('c83-s32', 120_000);
      await showPorts('c83-s32');
      await new Promise(resolve => setTimeout(resolve, 5000));
      deepStrictEqual(
        [
          readUserSettings() === settingsBefore,
          readFileSync(configuration, 'utf8') === configurationBefore,
        ],
        [true, true],
      );
    } finally {
      await closeWindow('c83-s32');
    }
  });

  it('F-2507 AC-34 (c83-count): with only LocalForward entries the status bar item counts the static rows and the Ports tab shows no count badge', async () => {
    await userSettings({[ENTRIES]: []});
    try {
      await openWindow('fwd-static', 'c83-s34');
      await connectedWithin('c83-s34', 120_000);
      await showPorts('c83-s34');
      await new Promise(resolve => setTimeout(resolve, 5000));
      deepStrictEqual(
        {
          status: (await statusItem('c83-s34', 'status.forwardedPorts')).text,
          badge: await panelBadge('c83-s34', 'Ports'),
        },
        {status: '1', badge: undefined},
      );
    } finally {
      await closeWindow('c83-s34');
    }
  });

  it('F-2507 AC-36 (c83-close-remote): Close Remote Connection leaves no listener of the editor’s and no LocalForward’s on the client', async () => {
    await listenOnHost(8632, 'c83-8632');
    await listenOnHost(8657, 'c83-8657');
    try {
      await openWindow('fwd-static', 'c83-s36');
      await connectedWithin('c83-s36', 120_000);
      await waitFor(
        'the default forward',
        async () => (await holder(18632, '127.0.0.1')) !== undefined,
        30_000,
      );
      const before = {
        editor: await holder(18632, '127.0.0.1'),
        client: await holder(13010, '127.0.0.1'),
      };
      const closed = Date.now();
      await inWindow('c83-s36', 'workbench.action.remote.close');
      const goneAfter: Record<string, number> = {};
      await waitFor(
        'the listeners to go',
        async () => {
          for (const [label, port] of [
            ['editor', 18632],
            ['client', 13010],
          ] as const) {
            if (
              goneAfter[label] === undefined &&
              (await holder(port, '127.0.0.1')) === undefined
            ) {
              goneAfter[label] = (Date.now() - closed) / 1000;
            }
          }
          return Object.keys(goneAfter).length === 2;
        },
        180_000,
      );
      deepStrictEqual(
        {
          before: [before.editor !== undefined, before.client],
          after: [
            await holder(18632, '127.0.0.1'),
            await holder(13010, '127.0.0.1'),
          ],
        },
        {before: [true, 'ssh'], after: [undefined, undefined]},
      );
    } finally {
      await closeWindow('c83-s36').catch(() => undefined);
    }
  });

  it('F-2507 AC-27, AC-39 (c83-remote-forward): a RemoteForward makes the host’s 127.0.0.1:19000 reach the client’s port, with the connection unaffected and no row or notification', async () => {
    await userSettings({[ENTRIES]: []});
    const received = await receiveOnLocal(19101);
    try {
      await openWindow('fwd-remote', 'c83-s39');
      await connectedWithin('c83-s39', 120_000);
      await showPorts('c83-s39');
      await onHost(
        'sh',
        '-c',
        '(echo c83-ping | timeout 4 nc 127.0.0.1 19000 >/dev/null 2>&1); true',
      );
      await new Promise(resolve => setTimeout(resolve, 1000));
      deepStrictEqual(
        {
          reached: received.text(),
          rows: (await portsRows('c83-s39').catch(() => [])).map(
            entry => entry.port,
          ),
          dialog: await dialogOf('c83-s39'),
          notices: await notificationCentre('c83-s39'),
        },
        {reached: 'c83-ping', rows: [], dialog: undefined, notices: []},
      );
    } finally {
      await received.release();
      await closeWindow('c83-s39');
    }
  });

  it('F-2507 AC-27, AC-40 (c83-dynamic-forward): a DynamicForward opens a SOCKS listener on the client’s 11080, separate from the connection’s own, through which the host’s services are reachable, with no row or notification', async () => {
    await userSettings({[ENTRIES]: []});
    await listenOnHost(8662, 'c83-8662');
    try {
      const mark = connectionLog().length;
      await openWindow('fwd-dynamic', 'c83-s40');
      await connectedWithin('c83-s40', 120_000);
      await showPorts('c83-s40');
      const own = Number(
        /(\d+)$/.exec(
          connectionLog()
            .slice(mark)
            .findLast(entry => entry.startsWith('Resolved ssh-remote+')) ?? '',
        )?.[1],
      );
      deepStrictEqual(
        {
          holder: await holder(11080, '127.0.0.1'),
          separate: own !== 11080,
          reached: await throughSocks(11080, 8662),
          rows: (await portsRows('c83-s40').catch(() => [])).map(
            entry => entry.port,
          ),
          dialog: await dialogOf('c83-s40'),
          notices: await notificationCentre('c83-s40'),
        },
        {
          holder: 'ssh',
          separate: true,
          reached: 'c83-8662',
          rows: [],
          dialog: undefined,
          notices: [],
        },
      );
    } finally {
      await closeWindow('c83-s40');
    }
  });

  it('F-2507 AC-27, AC-41 (c83-gateway): GatewayPorts yes makes ssh listen on all interfaces for the LocalForward, and the static row still shows localhost', async () => {
    await userSettings({[ENTRIES]: []});
    await listenOnHost(8661, 'c83-8661');
    try {
      await openWindow('fwd-gateway', 'c83-s41');
      await connectedWithin('c83-s41', 120_000);
      await showPorts('c83-s41');
      await waitFor(
        'the row',
        async () =>
          (await portsRows('c83-s41').catch(() => [])).some(entry =>
            entry.port.includes('8661'),
          ),
        30_000,
      );
      deepStrictEqual(
        {
          allInterfaces: await holder(13001, '0.0.0.0'),
          rows: (await portsRows('c83-s41'))
            .filter(entry => entry.port.includes('8661'))
            .map(entry => entry.forwardedAddress),
        },
        {allInterfaces: 'ssh', rows: ['localhost:13001']},
      );
    } finally {
      await closeWindow('c83-s41');
    }
  });

  /** The first two reply bytes of a SOCKS5 request on the host to the client's `target` through the dynamic RemoteForward, as hex. */
  async function requestOnHost(target: number, proxy: number): Promise<string> {
    const request = [
      5,
      1,
      0,
      5,
      1,
      0,
      1,
      127,
      0,
      0,
      1,
      Math.floor(target / 256),
      target % 256,
    ]
      .map(byte => `\\${byte.toString(8).padStart(3, '0')}`)
      .join('');
    const reply = await onHost(
      'sh',
      '-c',
      `(printf '${request}'; sleep 2) | nc 127.0.0.1 ${String(proxy)} 2>/dev/null | od -An -tx1 | tr -d ' \\n'; true`,
    );
    return reply.slice(4, 8);
  }

  /** A SOCKS request on the host through the dynamic RemoteForward of `alias` towards the client: whether it was granted, and what the window showed. */
  async function remoteOpen(
    alias: string,
    window: string,
    proxy: number,
  ): Promise<{granted: boolean; dialog: unknown; notices: string[]}> {
    const release = await holdLocal(19102);
    try {
      await openWindow(alias, window);
      await connectedWithin(window, 120_000);
      const answer = await requestOnHost(19102, proxy);
      return {
        granted: answer === '0500',
        dialog: await dialogOf(window),
        notices: await notificationCentre(window),
      };
    } finally {
      await release();
      await closeWindow(window);
    }
  }

  it('F-2507 AC-27, AC-42 (c83-remote-open-none): a SOCKS request on the host towards the client fails with PermitRemoteOpen none, and the connection is unaffected and the extension shows nothing', async () => {
    deepStrictEqual(await remoteOpen('fwd-noopen', 'c83-s42n', 19200), {
      granted: false,
      dialog: undefined,
      notices: [],
    });
  });

  it('F-2507 AC-27, AC-42 (c83-remote-open-any): a SOCKS request on the host towards the client succeeds with PermitRemoteOpen any, and the connection is unaffected and the extension shows nothing', async () => {
    deepStrictEqual(await remoteOpen('fwd-open', 'c83-s42a', 19201), {
      granted: true,
      dialog: undefined,
      notices: [],
    });
  });
});
