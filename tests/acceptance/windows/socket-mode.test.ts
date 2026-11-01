import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {
  acceptedKeyLogins,
  closeWindow,
  connectedWithin,
  connectionHelpers,
  connectionLog,
  hostPort,
  noHelperWithin,
  onHost,
  openWindow,
  readUserSettings,
  reloadWindow,
  restoreUserSettings,
  userSettings,
} from './harness.ts';
import {DATA_FOLDER, freshHost, INSTALL_MILLISECONDS} from './maintenance.ts';

const execFileAsync = promisify(execFile);

/** The user settings of socket mode with the host's platform named, so that no pick is asked. */
const SOCKET_MODE = {
  'remote.SSH.remoteServerListenOnSocket': true,
  'remote.SSH.remotePlatform': {harness: 'linux'},
};

/** The sockets the server proper listens on in the host's `/tmp`, as `/tmp/code-<uuid>`, from the kernel's list. */
async function listeningSockets(): Promise<string[]> {
  return (
    await onHost(
      'sh',
      '-c',
      'awk \'$4=="00010000" && $8 ~ /^\\/tmp\\/code-/ {print $8}\' /proc/net/unix | sort',
    )
  )
    .split('\n')
    .filter(line => line !== '');
}

/** The files `/tmp/code-<uuid>` of the host, whatever their type. */
async function socketFiles(): Promise<string[]> {
  return (await onHost('sh', '-c', 'ls -d /tmp/code-* 2>/dev/null; true'))
    .split('\n')
    .filter(line => line !== '');
}

/** The process id the server of the socket kind has in its pid file, or nothing while it has none. */
async function socketServerPid(): Promise<string> {
  return (
    await onHost(
      'sh',
      '-c',
      `cat ${DATA_FOLDER}/.*.socket.pid 2>/dev/null; true`,
    )
  ).trim();
}

/** The process ids of the server of the port kind, from its pid file. */
async function portServerPid(): Promise<string> {
  return (
    await onHost(
      'sh',
      '-c',
      `for f in ${DATA_FOLDER}/.*.pid; do case "$f" in *.socket.pid) ;; *) cat "$f";; esac; done 2>/dev/null; true`,
    )
  ).trim();
}

/** A TCP socket of this machine with the program and the process that hold it. */
interface Held {
  address: string;
  peer: string;
  program: string;
  processId: number;
}

/** The sockets `ss` lists with `options`, with the program and process of each. */
async function sockets(options: string[]): Promise<Held[]> {
  const {stdout} = await execFileAsync('ss', ['-tnpH', ...options]);
  return stdout.split('\n').flatMap(line => {
    const match =
      /^\d+\s+\d+\s+(\S+)\s+(\S+)\s+users:\(\("([^"]+)",pid=(\d+)/.exec(
        line.trimStart(),
      );
    return match?.[1] === undefined
      ? []
      : [
          {
            address: match[1],
            peer: match[2] ?? '',
            program: match[3] ?? '',
            processId: Number(match[4]),
          },
        ];
  });
}

/** The connections this machine holds to the host's SSH port, with the process of each. */
async function connectionsToHost(): Promise<Held[]> {
  return (await sockets(['state', 'established'])).filter(
    held => held.peer === `127.0.0.1:${String(hostPort())}`,
  );
}

/** The local port a window's resolve logged after `mark` lines of the connection log. */
function resolvedPortSince(mark: number): number {
  const line = connectionLog()
    .slice(mark)
    .findLast(entry =>
      /^Resolved ssh-remote\+harness to local port \d+$/.test(entry),
    );
  return Number(/(\d+)$/.exec(line ?? '')?.[1]);
}

/** Waits for the window to be connected and for the number of key logins of the user harness since `since`. */
async function loginsAfterConnect(
  name: string,
  since: string,
): Promise<number> {
  await connectedWithin(name, INSTALL_MILLISECONDS);
  return acceptedKeyLogins(since);
}

describe('the server on a socket (card coverage-81)', function () {
  this.timeout(600_000);

  let saved: string | undefined;

  before(async () => {
    saved = readUserSettings();
    await freshHost();
    await onHost('sh', '-c', 'rm -f /tmp/code-*');
    await userSettings(SOCKET_MODE);
  });

  after(async () => {
    restoreUserSettings(saved);
    await freshHost();
  });

  it('F-2410 AC-4: the window’s port is held by an ssh process, the client has two ssh connections to the host, one of them that process, no helper runs, and the host logged two logins', async () => {
    const mark = connectionLog().length;
    const since = new Date().toISOString();
    await openWindow('harness', 's4');
    const logins = await loginsAfterConnect('s4', since);
    const port = resolvedPortSince(mark);
    const listeners = (await sockets(['state', 'listening'])).filter(
      held => held.address === `127.0.0.1:${String(port)}`,
    );
    const connections = await connectionsToHost();
    deepStrictEqual(
      {
        listenerPrograms: listeners.map(held => held.program),
        connectionPrograms: connections.map(held => held.program),
        listenerIsOneOfTheTwo: connections.some(
          held => held.processId === listeners[0]?.processId,
        ),
        helpers: await connectionHelpers(),
        logins,
      },
      {
        listenerPrograms: ['ssh'],
        connectionPrograms: ['ssh', 'ssh'],
        listenerIsOneOfTheTwo: true,
        helpers: [],
        logins: 2,
      },
    );
  });

  it('F-2410 AC-8 (ruling-299-socket-reuse): a reload reconnects within seconds with two logins, on the same server process, and its socket is the one the server already listened on', async () => {
    const processBefore = await socketServerPid();
    const socketsBefore = await listeningSockets();
    const since = new Date().toISOString();
    const start = Date.now();
    await reloadWindow('s4');
    await connectedWithin('s4', 60_000);
    const elapsed = Date.now() - start;
    deepStrictEqual(
      {
        quick: elapsed < 10_000,
        logins: await acceptedKeyLogins(since),
        sameProcess: (await socketServerPid()) === processBefore,
        processKnown: processBefore !== '',
        oneSocket: socketsBefore.length,
        sameSockets: (await listeningSockets()).join() === socketsBefore.join(),
      },
      {
        quick: true,
        logins: 2,
        sameProcess: true,
        processKnown: true,
        oneSocket: 1,
        sameSockets: true,
      },
    );
  });

  it('F-2410 AC-26 (ruling-299-socket-reuse): after the reload the earlier connect’s socket still listens and is still a file in /tmp, and nothing removed it', async () => {
    const [socket] = await listeningSockets();
    await reloadWindow('s4');
    await connectedWithin('s4', 60_000);
    deepStrictEqual(
      [await listeningSockets(), await socketFiles()],
      [[socket], [socket]],
    );
  });

  it('F-2410 AC-11 (ruling-299-socket-reuse): a second window has two logins of its own and the sockets and the server proper are shared, with two ssh connections for each window', async () => {
    const processBefore = await socketServerPid();
    const socketsBefore = await listeningSockets();
    const connectionsBefore = (await connectionsToHost()).length;
    const since = new Date().toISOString();
    await openWindow('harness', 's11');
    const logins = await loginsAfterConnect('s11', since);
    deepStrictEqual(
      {
        logins,
        connections: (await connectionsToHost()).length - connectionsBefore,
        sameProcess: (await socketServerPid()) === processBefore,
        sockets: (await listeningSockets()).join() === socketsBefore.join(),
        socketCount: socketsBefore.length,
      },
      {
        logins: 2,
        connections: 2,
        sameProcess: true,
        sockets: true,
        socketCount: 1,
      },
    );
  });

  it('F-2410 AC-10: with the setting off, the reload reconnects through the local connection server, which the next window reuses, and the server of the port kind starts beside the one of the socket kind', async () => {
    await closeWindow('s11');
    await userSettings({'remote.SSH.remoteServerListenOnSocket': false});
    const socketProcess = await socketServerPid();
    const mark = connectionLog().length;
    const since = new Date().toISOString();
    await reloadWindow('s4');
    await connectedWithin('s4', INSTALL_MILLISECONDS);
    const port = resolvedPortSince(mark);
    const listeners = (await sockets(['state', 'listening'])).filter(
      held => held.address === `127.0.0.1:${String(port)}`,
    );
    const first = {
      loopbackPortListeners: listeners.length,
      loopbackPortHeldBySsh: listeners.some(held => held.program === 'ssh'),
      logins: await acceptedKeyLogins(since),
      helpers: (await connectionHelpers()).length,
      portServer: (await portServerPid()) !== '',
      socketServer: (await socketServerPid()) === socketProcess,
    };
    const helpers = await connectionHelpers();
    const laterSince = new Date().toISOString();
    await openWindow('harness', 's10');
    await connectedWithin('s10', INSTALL_MILLISECONDS);
    deepStrictEqual(
      [
        first,
        {
          logins: await acceptedKeyLogins(laterSince),
          sameHelpers: (await connectionHelpers()).join() === helpers.join(),
        },
      ],
      [
        {
          loopbackPortListeners: 1,
          loopbackPortHeldBySsh: false,
          logins: 1,
          helpers: 1,
          portServer: true,
          socketServer: true,
        },
        {logins: 0, sameHelpers: true},
      ],
    );
  });

  it('F-2410 AC-28: with the setting off the first window adds one connection to the host and a second window adds none, where with it on each window adds two (AC-11)', async () => {
    await closeWindow('s10');
    await closeWindow('s4');
    await noHelperWithin(60_000);
    const connectionsBefore = (await connectionsToHost()).length;
    const since = new Date().toISOString();
    await openWindow('harness', 's28a');
    await connectedWithin('s28a', INSTALL_MILLISECONDS);
    const first = (await connectionsToHost()).length - connectionsBefore;
    await openWindow('harness', 's28b');
    await connectedWithin('s28b', INSTALL_MILLISECONDS);
    deepStrictEqual(
      [
        await acceptedKeyLogins(since),
        first,
        (await connectionsToHost()).length - connectionsBefore,
      ],
      [1, 1, 1],
    );
  });
});
