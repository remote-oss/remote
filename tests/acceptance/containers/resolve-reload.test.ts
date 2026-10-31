import {deepStrictEqual} from 'node:assert';
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {
  closeWindow,
  containersLog,
  devContainerFolder,
  reloadWindow,
  reopenStarted,
  variable,
  connectedToContainer,
} from '../windows/harness.ts';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';
import {
  dialogOf,
  statusBarText,
  toastDetails,
  windowTitle,
} from '../windows/renderer.ts';
import {
  connectedWindow,
  docker,
  logSince,
  serverPortsOf,
  serverProcessesOf,
  SETTLE_MILLISECONDS,
  showsNotice,
  shownContaining,
  untilNoServer,
  whenShown,
} from './resolve-support.ts';
import {labelsOf, mark} from './lifecycle-support.ts';

/** STR:S058, which a refused token must not show. */
const CANNOT_RECONNECT = 'Cannot reconnect to remote host.';

/** The log line that a container which this connect made gives (S-less: our own line, connector.ts). */
const NEWLY_STARTED = /^container [0-9a-f]+ was newly started$/;

/** The log line that a container which ran already gives. */
const ALREADY_RUNNING = /^container [0-9a-f]+ was already running$/;

/** The lines of `lines` that match `pattern`. */
function matching(lines: readonly string[], pattern: RegExp): string[] {
  return lines.filter(line => pattern.test(line));
}

/** The milliseconds that the last "Resolving Remote: N ms" line of `lines` gives. */
function resolvedMilliseconds(lines: readonly string[]): number {
  const last = matching(lines, /^Resolving Remote: \d+ ms$/).at(-1) ?? '';
  return Number(/\d+/.exec(last)?.[0]);
}

/** A folder `label` of the run whose only configuration is the image's, in `file` below the folder. */
function folderWith(label: string, file: string): string {
  const folder = path.join(variable('HARNESS_RUN_FOLDER'), label);
  mkdirSync(path.dirname(path.join(folder, file)), {recursive: true});
  writeFileSync(
    path.join(folder, file),
    JSON.stringify({image: variable('HARNESS_DEVCONTAINER_IMAGE')}),
  );
  return folder;
}

describe('F-0502 the resolution of a dev container window (card containers-43)', function () {
  this.timeout(900_000);

  it('F-0502 AC-1, AC-31 (c43-first): Reopen in Container shows the progress notification and Opening Remote..., logs Resolving Remote and a newly started container, and ends connected under the folder and configuration name', async () => {
    const folder = devContainerFolder('c43-first', {
      name: 'C43 First',
      onCreateCommand: 'sleep 8',
    });
    const name = await openFolderWindow(folder);
    try {
      const logMark = containersLog().length;
      await reopenStarted(name);
      await whenShown(
        'the Opening Remote... indicator',
        async () =>
          (await statusBarText(name, 'status.host')) === 'Opening Remote...',
        60_000,
      );
      await whenShown(
        'the progress notification',
        async () =>
          (await toastDetails(name)).some(toast =>
            toast.message.startsWith('Connecting to Dev Container'),
          ),
        60_000,
      );
      await connectedToContainer(name);
      const lines = logSince(logMark);
      const state = {
        resolving: lines.includes('Resolving Remote'),
        newlyStarted: matching(lines, NEWLY_STARTED).length,
        alreadyRunning: matching(lines, ALREADY_RUNNING).length,
        title: (await windowTitle(name)).startsWith(
          '[c43-first [Dev Container: C43 First]]',
        ),
        indicator: await statusBarText(name, 'status.host'),
        dialog: await dialogOf(name),
      };
      await closeWindow(name);
      deepStrictEqual(state, {
        resolving: true,
        newlyStarted: 1,
        alreadyRunning: 0,
        title: true,
        indicator: 'Dev Container: C43 First',
        dialog: undefined,
      });
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0502 AC-31 (c43-reload): Reload Window reuses the running server on the same port within 2 s, logs the container as already running, and reconnects under the same title and indicator', async () => {
    const connectMark = containersLog().length;
    const {name, folder} = await connectedWindow('c43-reload');
    try {
      const firstPorts = serverPortsOf(logSince(connectMark));
      const logMark = containersLog().length;
      await reloadWindow(name);
      await connectedToContainer(name);
      const lines = logSince(logMark);
      const state = {
        ports: [...new Set([...firstPorts, ...serverPortsOf(lines)])].length,
        reused: lines.includes('reusing the running server'),
        alreadyRunning: matching(lines, ALREADY_RUNNING).length,
        newlyStarted: matching(lines, NEWLY_STARTED).length,
        underTwoSeconds: resolvedMilliseconds(lines) < 2000,
        title: (await windowTitle(name)).startsWith(
          '[c43-reload [Dev Container: c43-reload]]',
        ),
        indicator: await statusBarText(name, 'status.host'),
      };
      await closeWindow(name);
      deepStrictEqual(state, {
        ports: 1,
        reused: true,
        alreadyRunning: 1,
        newlyStarted: 0,
        underTwoSeconds: true,
        title: true,
        indicator: 'Dev Container: c43-reload',
      });
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0502 AC-2 (c43-reload-phase): a reload logs no Starting VS Code Server phase, only the reuse line, and the same server port as before', async () => {
    const connectMark = containersLog().length;
    const {name, folder} = await connectedWindow('c43-reload-phase');
    try {
      const firstPorts = serverPortsOf(logSince(connectMark));
      const logMark = containersLog().length;
      await reloadWindow(name);
      await connectedToContainer(name);
      const lines = logSince(logMark);
      await closeWindow(name);
      deepStrictEqual(
        [
          lines.includes('Starting VS Code Server'),
          lines.includes('reusing the running server'),
          [...new Set([...firstPorts, ...serverPortsOf(lines)])].length,
        ],
        [false, true, 1],
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0502 AC-13 (c43-oncreate-once): a container stopped and started again, then reconnected by a reload, does not run its onCreateCommand again', async () => {
    const {name, containerId, folder} = await connectedWindow(
      'c43-oncreate-once',
      {onCreateCommand: mark('onCreate')},
    );
    try {
      await new Promise(resolve => setTimeout(resolve, SETTLE_MILLISECONDS));
      await docker('stop', '--time', '2', containerId);
      await docker('start', containerId);
      const logMark = containersLog().length;
      await reloadWindow(name);
      await connectedToContainer(name);
      const lines = logSince(logMark);
      const state = {
        labels: await labelsOf(containerId, folder),
        underTwoSeconds: resolvedMilliseconds(lines) < 2000,
      };
      await closeWindow(name);
      deepStrictEqual(state, {labels: ['onCreate'], underTwoSeconds: true});
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0502 AC-19 (c43-port-taken): an unrelated program on the dead server’s port is ignored: a new server starts on another port and the program keeps listening', async () => {
    const connectMark = containersLog().length;
    const {name, containerId, folder} = await connectedWindow('c43-port-taken');
    try {
      const [oldPort = 0] = serverPortsOf(logSince(connectMark));
      const servers = await serverProcessesOf(containerId);
      const nodePath =
        servers.find(server => server.argv[0]?.endsWith('/node'))?.argv[0] ??
        '';
      await docker(
        'exec',
        containerId,
        'kill',
        '-9',
        ...servers.map(server => String(server.processId)),
      );
      await untilNoServer(containerId);
      await docker(
        'exec',
        '--detach',
        containerId,
        nodePath,
        '-e',
        `require('net').createServer().listen(${String(oldPort)}, '127.0.0.1')`,
      );
      const logMark = containersLog().length;
      await reloadWindow(name);
      await connectedToContainer(name);
      const lines = logSince(logMark);
      const listening = await docker(
        'exec',
        containerId,
        'sh',
        '-c',
        `grep -c ":${oldPort.toString(16).toUpperCase().padStart(4, '0')} " /proc/net/tcp`,
      );
      await closeWindow(name);
      deepStrictEqual(
        {
          started: lines.includes('Starting VS Code Server'),
          reused: lines.includes('reusing the running server'),
          otherPort: serverPortsOf(lines).every(port => port !== oldPort),
          stillListening: Number(listening) > 0,
        },
        {started: true, reused: false, otherPort: true, stillListening: true},
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0502 AC-20 (c43-token): a running server that refuses the window’s token gives core’s auth mismatch error after a re-resolution without a server start, and ending that server and reloading connects to a new one on a new port', async () => {
    const connectMark = containersLog().length;
    const {name, containerId, folder} = await connectedWindow('c43-token');
    try {
      const [oldPort = 0] = serverPortsOf(logSince(connectMark));
      const tokenFile = await docker(
        'exec',
        containerId,
        'sh',
        '-c',
        "find / -name '*.token' -not -path '/proc/*' 2>/dev/null | head -n 1",
      );
      await docker(
        'exec',
        containerId,
        'sh',
        '-c',
        `printf 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345' > ${tokenFile}`,
      );
      const logMark = containersLog().length;
      await reloadWindow(name);
      const failure = await shownContaining(name, 'auth mismatch', 90_000);
      const lines = logSince(logMark);
      const mismatch = {
        noReconnectDialog: !(await shownContaining(
          name,
          CANNOT_RECONNECT,
          3000,
        ).then(
          () => true,
          () => false,
        )),
        failure,
        reused: lines.includes('reusing the running server'),
        samePort: serverPortsOf(lines).every(port => port === oldPort),
      };
      const servers = await serverProcessesOf(containerId);
      await docker(
        'exec',
        containerId,
        'kill',
        '-9',
        ...servers.map(server => String(server.processId)),
      );
      await untilNoServer(containerId);
      const nextMark = containersLog().length;
      await reloadWindow(name);
      await connectedToContainer(name);
      const next = logSince(nextMark);
      await closeWindow(name);
      deepStrictEqual(
        {
          mismatch,
          started: next.includes('Starting VS Code Server'),
          newPort: serverPortsOf(next).every(port => port !== oldPort),
        },
        {
          mismatch: {
            noReconnectDialog: true,
            failure:
              'Failed to connect to the remote extension host server (Error: Connection error: Unauthorized client refused: auth mismatch)',
            reused: true,
            samePort: true,
          },
          started: true,
          newPort: true,
        },
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0502 AC-32 (c43-inspect): a fresh container has a Docker default name, the folder and configuration labels, the metadata label, the workspace mounted under its folder name and no published port', async () => {
    const {name, containerId, folder} = await connectedWindow('c43-inspect');
    try {
      const [
        containerName = '',
        labels = '',
        mounts = '',
        ports = '',
        bindings = '',
      ] = (
        await docker(
          'inspect',
          '--format',
          '{{.Name}}|{{json .Config.Labels}}|{{json .Mounts}}|{{json .NetworkSettings.Ports}}|{{json .HostConfig.PortBindings}}',
          containerId,
        )
      ).split('|');
      const parsedLabels = JSON.parse(labels) as Record<string, string>;
      const parsedMounts = JSON.parse(mounts) as Array<{
        Destination: string;
        Source: string;
      }>;
      await closeWindow(name);
      deepStrictEqual(
        {
          defaultName: /^\/[a-z]+_[a-z]+$/.test(containerName),
          folder: parsedLabels['devcontainer.local_folder'],
          config: parsedLabels['devcontainer.config_file'],
          metadata: 'devcontainer.metadata' in parsedLabels,
          workspace: parsedMounts.find(
            mount => mount.Destination === '/workspaces/c43-inspect',
          )?.Source,
          ports: JSON.parse(ports) as unknown,
          bindings: JSON.parse(bindings) as unknown,
        },
        {
          defaultName: true,
          folder,
          config: path.join(folder, '.devcontainer', 'devcontainer.json'),
          metadata: true,
          workspace: folder,
          ports: {},
          bindings: {},
        },
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0502 AC-33 (c43-places): configurations at .devcontainer/, at .devcontainer.json and in a subfolder of .devcontainer/ show the reopen prompt, and a root-level devcontainer.json does not', async () => {
    const folders = {
      folderLevel: folderWith('c43-place-a', '.devcontainer/devcontainer.json'),
      dotFile: folderWith('c43-place-b', '.devcontainer.json'),
      subfolder: folderWith(
        'c43-place-c',
        '.devcontainer/sub/devcontainer.json',
      ),
      rootOnly: folderWith('c43-place-d', 'devcontainer.json'),
    };
    const shown: Record<string, boolean> = {};
    for (const [label, folder] of Object.entries(folders)) {
      const name = await openFolderWindow(folder);
      shown[label] = await showsNotice(name);
      await closeWindow(name);
    }
    deepStrictEqual(shown, {
      folderLevel: true,
      dotFile: true,
      subfolder: true,
      rootOnly: false,
    });
  });
});
