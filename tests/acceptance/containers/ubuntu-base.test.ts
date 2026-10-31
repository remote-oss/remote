import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {createServer} from 'node:net';
import path from 'node:path';
import {promisify} from 'node:util';
import {volumeServerFolder} from 'lib-product';
import {
  closeWindow,
  commandsOf,
  devContainerFolder,
  devContainersOf,
  editorProduct,
  inWindow,
  reopenInContainer,
  runProcessTask,
  terminalBuffer,
  UBUNTU_IMAGE,
  variable,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {portsRows, typeInTerminal} from '../windows/renderer.ts';
import {runTemplatesReady} from '../windows/run-templates.ts';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';

const execFileAsync = promisify(execFile);

/** A free port of this machine, for a listener of the container that the editor forwards. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port =
        typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => {
        resolve(port);
      });
    });
  });
}

/** What `sh -c script` prints in container `containerId`, trimmed. */
async function inContainer(
  containerId: string,
  script: string,
): Promise<string> {
  const {stdout} = await execFileAsync('docker', [
    'exec',
    containerId,
    'sh',
    '-c',
    script,
  ]);
  return stdout.trim();
}

/** A folder of the run whose configuration names the Ubuntu image, with `configuration` over it. */
function ubuntuFolder(
  name: string,
  configuration: Readonly<Record<string, unknown>> = {},
): string {
  return devContainerFolder(name, {
    name,
    image: UBUNTU_IMAGE,
    ...configuration,
  });
}

/** Opens `folder`, reopens it in its container, runs `body` over the window and the container, and cleans up. */
async function inUbuntu(
  folder: string,
  body: (window: string, containerId: string) => Promise<void>,
): Promise<void> {
  try {
    const window = await openFolderWindow(folder);
    try {
      await reopenInContainer(window);
      const [containerId = ''] = await devContainersOf(folder);
      await body(window, containerId);
    } finally {
      await closeWindow(window).catch(() => undefined);
    }
  } finally {
    await removeContainers(folder);
  }
}

describe('a dev container on ubuntu:26.04 (card containers-100)', function () {
  this.timeout(900_000);

  it('#1382: an ubuntu:26.04 dev container connects, installs the server into the vscode volume and opens a terminal', async () => {
    await inUbuntu(
      ubuntuFolder('u100-connect'),
      async (window, containerId) => {
        const product = editorProduct();
        const tree = await inContainer(
          containerId,
          `ls -d /vscode/${volumeServerFolder(product.applicationName)}/bin/linux-*/${product.commit}`,
        );
        await inWindow(window, 'workbench.action.terminal.new');
        await typeInTerminal(window, 'echo ubuntu-$((20 + 22))-ok\n');
        await waitFor(
          'the echo in the terminal',
          async () =>
            (await terminalBuffer(window))
              .split('\n')
              .some(line => line.trim() === 'ubuntu-42-ok'),
          60_000,
        );
        deepStrictEqual(
          [
            (await windowState(window)).remoteName,
            /\/bin\/linux-(x64|arm64)\//.test(tree),
          ],
          ['dev-container', true],
        );
      },
    );
  });

  it('#1382: its lifecycle commands, an exec channel and a forwarded port work', async () => {
    const port = await freePort();
    const folder = ubuntuFolder('u100-lifecycle', {
      postCreateCommand: 'echo created > /tmp/u100-marker',
      forwardPorts: [port],
    });
    await inUbuntu(folder, async (window, containerId) => {
      const product = editorProduct();
      const node = await inContainer(
        containerId,
        `ls -d /vscode/${volumeServerFolder(product.applicationName)}/bin/linux-*/${product.commit}/node`,
      );
      await execFileAsync('docker', [
        'exec',
        '--detach',
        containerId,
        node,
        '-e',
        `require('node:net').createServer().listen(${String(port)}, '127.0.0.1')`,
      ]);
      const exitCode = await runProcessTask(window, '/bin/sh', [
        '-c',
        'echo u100-task > /tmp/u100-task',
      ]);
      await waitFor(
        'core to register the Ports view',
        async () =>
          (await commandsOf(window, '~remote.forwardedPorts.focus')).includes(
            '~remote.forwardedPorts.focus',
          ),
        30_000,
      );
      await inWindow(window, '~remote.forwardedPorts.focus');
      let forwarded: Awaited<ReturnType<typeof portsRows>>[number] | undefined;
      await waitFor(
        `a Ports row for ${String(port)}`,
        async () => {
          forwarded = (await portsRows(window).catch(() => [])).find(
            each => each.port === String(port),
          );
          return (
            forwarded?.forwardedAddress !== undefined &&
            forwarded.forwardedAddress !== ''
          );
        },
        60_000,
      );
      deepStrictEqual(
        [
          await inContainer(containerId, 'cat /tmp/u100-marker'),
          exitCode,
          await inContainer(containerId, 'cat /tmp/u100-task'),
          forwarded?.forwardedAddress !== '',
        ],
        ['created', 0, 'u100-task', true],
      );
    });
  });

  it('F-0416 AC-28 (ubuntu-26-04): userEnvProbe loginInteractiveShell hands a task the variable the image user’s .profile exports', async () => {
    const folder = devContainerFolder('u100-env', {
      name: 'u100-env',
      image: undefined,
      build: {dockerfile: 'Dockerfile'},
      userEnvProbe: 'loginInteractiveShell',
    });
    writeFileSync(
      path.join(folder, '.devcontainer', 'Dockerfile'),
      `FROM ${UBUNTU_IMAGE}\nRUN echo 'export U100_PROBE=from-profile' >> /root/.profile\n`,
    );
    await inUbuntu(folder, async (window, containerId) => {
      const exitCode = await runProcessTask(window, '/bin/sh', [
        '-c',
        'printenv U100_PROBE > /tmp/u100-env',
      ]);
      deepStrictEqual(
        [exitCode, await inContainer(containerId, 'cat /tmp/u100-env')],
        [0, 'from-profile'],
      );
    });
  });

  it('F-0414 AC-1 (ubuntu-26-04): the run’s lab-options Feature builds into an Ubuntu 26.04 container and leaves its environment file', async () => {
    await runTemplatesReady();
    const feature = `${variable('HARNESS_TEMPLATE_REGISTRY')}/remote-oss-run/features/lab-options:1`;
    const folder = ubuntuFolder('u100-feature', {
      features: {[feature]: {level: 'high'}},
    });
    await inUbuntu(folder, async (window, containerId) => {
      const environment = await inContainer(
        containerId,
        'cat /usr/local/share/remote-oss-run/lab-options.env',
      );
      deepStrictEqual(environment.split('\n').includes('LEVEL=high'), true);
    });
  });
});
