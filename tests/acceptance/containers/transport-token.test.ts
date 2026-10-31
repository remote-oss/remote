import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {
  closeWindow,
  connectedToContainer,
  containersLog,
  reloadWindow,
  variable,
} from '../windows/harness.ts';
import {removeContainers, setUserSetting} from '../windows/folder-windows.ts';
import {
  connectedWindow,
  docker,
  logSince,
  serverProcessesOf,
  SETTLE_MILLISECONDS,
} from './resolve-support.ts';

const execFileAsync = promisify(execFile);

/** The path of every non-empty file named `fileName` below `folder` on this machine. */
async function nonEmptyFiles(
  folder: string,
  fileName: string,
): Promise<string[]> {
  const {stdout} = await execFileAsync('find', [
    folder,
    '-name',
    fileName,
    '-size',
    '+0',
  ]);
  return stdout.split('\n').filter(line => line !== '');
}

/** The path of every non-empty file named `fileName` in container `containerId`. */
async function nonEmptyFilesIn(
  containerId: string,
  fileName: string,
): Promise<string[]> {
  const output = await docker(
    'exec',
    containerId,
    'sh',
    '-c',
    `find / -xdev -name ${fileName} -size +0 2>/dev/null || true`,
  );
  return output.split('\n').filter(line => line !== '');
}

/** The non-empty telemetry logs of the editor on this machine and of the server in container `containerId`. */
async function telemetryLogs(containerId: string): Promise<string[]> {
  return [
    ...(await nonEmptyFiles(variable('HARNESS_USER_DATA'), 'telemetry.log')),
    ...(await nonEmptyFilesIn(containerId, 'remoteTelemetry.log')),
  ];
}

describe('F-0502 the transport, the token and the log (card containers-43)', function () {
  this.timeout(900_000);

  it('F-0502 AC-15 (ruling-11): with telemetry.telemetryLevel all, the server starts with --telemetry-level off (R-28), and neither telemetry log gets a byte through connect, disconnect and recovery', async () => {
    await setUserSetting('telemetry.telemetryLevel', 'all');
    const {name, containerId, folder} = await connectedWindow('c43-telemetry');
    try {
      await new Promise(resolve => setTimeout(resolve, SETTLE_MILLISECONDS));
      const [server] = await serverProcessesOf(containerId);
      const argv = server?.argv ?? [];
      const levelAt = argv.indexOf('--telemetry-level');
      const connected = await telemetryLogs(containerId);
      await docker('stop', '--time', '2', containerId);
      await docker('start', containerId);
      await reloadWindow(name);
      await connectedToContainer(name);
      const recovered = await telemetryLogs(containerId);
      await closeWindow(name);
      deepStrictEqual(
        {level: argv[levelAt + 1], connected, recovered},
        {level: 'off', connected: [], recovered: []},
      );
    } finally {
      await setUserSetting('telemetry.telemetryLevel', undefined);
      await removeContainers(folder);
    }
  });

  it('F-0502 AC-42 (c43-forward): one forward listens on 127.0.0.1 on the server’s port number, nothing else listens on it, the container publishes no port, and the window stays connected', async () => {
    const mark = containersLog().length;
    const {name, containerId, folder} = await connectedWindow('c43-forward');
    try {
      await new Promise(resolve => setTimeout(resolve, SETTLE_MILLISECONDS));
      const forwards = logSince(mark).flatMap(line => {
        const match =
          /^forwarding local port (\d+) to container port (\d+)$/.exec(line);
        return match === null ? [] : [[Number(match[1]), Number(match[2])]];
      });
      const [hostPort = 0, containerPort = 0] = forwards[0] ?? [];
      const {stdout} = await execFileAsync('ss', ['-ltn']);
      const listeners = stdout
        .split('\n')
        .map(line => line.trim().split(/\s+/)[3] ?? '')
        .filter(address => address.endsWith(`:${String(hostPort)}`));
      const published = await docker('port', containerId);
      await connectedToContainer(name);
      await closeWindow(name);
      deepStrictEqual(
        {
          forwards: forwards.length,
          samePort: hostPort === containerPort,
          listeners,
          published,
        },
        {
          forwards: 1,
          samePort: true,
          listeners: [`127.0.0.1:${String(hostPort)}`],
          published: '',
        },
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('containers-43 (token-file): the server’s command line and environment hold no token value, and it reads the token from a file', async () => {
    const {name, containerId, folder} = await connectedWindow('c43-token-file');
    try {
      const tokenFile = await docker(
        'exec',
        containerId,
        'sh',
        '-c',
        "find / -name '*.token' -not -path '/proc/*' 2>/dev/null | head -n 1",
      );
      const token = await docker('exec', containerId, 'cat', tokenFile);
      const servers = await serverProcessesOf(containerId);
      const environments = await Promise.all(
        servers.map(server =>
          docker(
            'exec',
            containerId,
            'sh',
            '-c',
            `tr "\\0" "\\n" < /proc/${String(server.processId)}/environ`,
          ),
        ),
      );
      await closeWindow(name);
      deepStrictEqual(
        {
          servers: servers.length > 0,
          tokenLength: token.length > 0,
          inArguments: servers.some(server =>
            server.argv.some(word => word.includes(token)),
          ),
          inEnvironment: environments.some(text => text.includes(token)),
          fileOption: servers.some(server =>
            server.argv.includes('--connection-token-file'),
          ),
        },
        {
          servers: true,
          tokenLength: true,
          inArguments: false,
          inEnvironment: false,
          fileOption: true,
        },
      );
    } finally {
      await removeContainers(folder);
    }
  });
});
