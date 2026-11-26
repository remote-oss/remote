/**
 * @fileoverview A Remote-SSH window on an SSH host that has Docker (card #3081): the host is the run's second engine
 * with OpenSSH's server (`tests/acceptance/ssh-engine`), whose image is that of the Docker daemon and not the harness
 * host's. This row is the probe the card asks for first: it shows that the editor's server installs and starts there,
 * so that the rows of containers in a Remote-SSH window (F-0207 AC-28 and later) have a host.
 */

import {deepStrictEqual} from 'node:assert';
import {rmSync} from 'node:fs';
import {
  closeWindow,
  inWindow,
  readUserSettings,
  reopenInContainer,
  restoreUserSettings,
  userSettings,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {
  dialogOf,
  notifications,
  statusItemText,
  windowTitle,
} from '../windows/renderer.ts';
import {
  ASK_WITHOUT,
  freshKnown,
  hostBlock,
  writeConfig,
} from '../windows/config-keywords-support.ts';
import {
  ownEngineDocker,
  sshEngine,
  type SshEngine,
} from '../windows/engine-fixture.ts';

/** The account of the host that logs in by the run's key. */
const ACCOUNT = 'engine';

/** The processes of container `container`, by their command lines. */
async function processesOf(container: string): Promise<string[]> {
  return (await ownEngineDocker('exec', container, 'ps', '-o', 'args'))
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '');
}

/** What a row's window on the host is: its name (the folder's too), the host, and the folder's path on the host. */
interface HostWindow {
  host: SshEngine;
  name: string;
  folder: string;
}

/**
 * Runs `body` with a window connected over SSH, through the alias `name`, to a folder of a new Docker host's home that
 * holds the dev container configuration `configuration` when one is given. The row's own config and known hosts file
 * and its settings go when it ends, and so does the host.
 */
async function onDockerHost(
  name: string,
  configuration: Record<string, unknown> | undefined,
  settings: Record<string, unknown>,
  body: (window: HostWindow) => Promise<void>,
): Promise<void> {
  const host = await sshEngine();
  const saved = readUserSettings();
  const known = freshKnown(name);
  const folder = `/home/${ACCOUNT}/${name}`;
  let file = '';
  try {
    const port = host.address(ACCOUNT).split(':').pop() ?? '';
    file = writeConfig(name, [
      hostBlock(
        name,
        [
          `Port ${port}`,
          `User ${ACCOUNT}`,
          'StrictHostKeyChecking accept-new',
          `UserKnownHostsFile ${known}`,
        ],
        ['Port', 'User', ...ASK_WITHOUT],
      ),
    ]);
    await userSettings({
      'remote.SSH.configFile': file,
      'remote.SSH.remotePlatform': {[name]: 'linux'},
      ...settings,
    });
    await ownEngineDocker(
      'exec',
      host.container,
      'sh',
      '-c',
      `mkdir -p ${folder}/.devcontainer && chown -R ${ACCOUNT} ${folder}`,
    );
    if (configuration !== undefined) {
      await ownEngineDocker(
        'exec',
        '-u',
        ACCOUNT,
        host.container,
        'sh',
        '-c',
        `printf '%s' '${JSON.stringify(configuration)}' > ${folder}/.devcontainer/devcontainer.json`,
      );
    }
    void inWindow(
      'local',
      'acceptance.agent.openWindow',
      `vscode-remote://ssh-remote+${name}${folder}`,
    );
    // The window carries the remote's name from the start, so it is connected once a file it writes through its remote
    // file system reaches the host's container.
    await waitFor(
      `window ${name} to connect through ${name}`,
      async () => {
        try {
          await inWindow(name, 'acceptance.agent.writeFile', 'probe.txt', name);
          return (
            (await ownEngineDocker(
              'exec',
              host.container,
              'cat',
              `${folder}/probe.txt`,
            )) === name
          );
        } catch {
          return false;
        }
      },
      240_000,
    ).catch(async (caught: unknown) => {
      throw new Error(
        `${String(caught)}; the host's processes: ${JSON.stringify(await processesOf(host.container))}`,
        {cause: caught},
      );
    });
    await body({host, name, folder});
  } finally {
    await closeWindow(name).catch(() => undefined);
    restoreUserSettings(saved);
    // The row's own config and known hosts file go with it: nothing of it stays in the run's folder.
    rmSync(file, {force: true});
    rmSync(known, {force: true});
    await host.stop();
  }
}

describe('a Remote-SSH window on an SSH host with Docker (card #3081)', function () {
  this.timeout(900_000);

  it('c3081-probe: a window connects to the second engine host over SSH, and the editor’s server runs in its container', async () => {
    await onDockerHost(
      'c3081-docker-host',
      undefined,
      {},
      async ({host, name, folder}) => {
        const probe = await ownEngineDocker(
          'exec',
          host.container,
          'cat',
          `${folder}/probe.txt`,
        );
        const running = (await processesOf(host.container)).filter(line =>
          line.includes('server'),
        );
        deepStrictEqual(
          {probe, serverRuns: running.length > 0},
          {probe: name, serverRuns: true},
          `the host's processes: ${JSON.stringify(await processesOf(host.container))}`,
        );
      },
    );
  });

  it('F-0207 AC-28 (c3081-ac28): in a Remote-SSH window on a Linux host, with executeInWSL true, a distro that does not exist and forwardWSLServices false, Reopen in Container opens the container as with the defaults: the title and the remote indicator name the container and the SSH host, the container has only the vscode volume and the workspace bind, and no dialog or notification appears', async () => {
    const label = 'Ssh Host';
    await onDockerHost(
      'c3081-dh',
      {name: label, image: variable('HARNESS_DEVCONTAINER_IMAGE')},
      {
        'dev.containers.executeInWSL': true,
        'dev.containers.executeInWSLDistro': 'NoSuchDistro',
        'dev.containers.forwardWSLServices': false,
      },
      async ({host, name, folder}) => {
        await reopenInContainer(name);
        const [container = ''] = (
          await ownEngineDocker(
            'exec',
            host.container,
            'docker',
            'ps',
            '-aq',
            '--filter',
            `label=devcontainer.local_folder=${folder}`,
          )
        )
          .split('\n')
          .filter(line => line !== '');
        const mounts = (
          JSON.parse(
            await ownEngineDocker(
              'exec',
              host.container,
              'docker',
              'inspect',
              '--format',
              '{{json .Mounts}}',
              container,
            ),
          ) as Array<{Type: string; Destination: string}>
        )
          .map(mount => `${mount.Type} ${mount.Destination}`)
          .sort();
        deepStrictEqual(
          {
            title: (await windowTitle(name)).includes(
              `[Dev Container: ${label} @ ${name}]`,
            ),
            indicator: await statusItemText(
              name,
              'status.host',
              `Dev Container: ${label}`,
              60_000,
            ),
            mounts,
            dialog: await dialogOf(name),
            notifications: await notifications(name),
          },
          {
            title: true,
            indicator: `Dev Container: ${label} @ ${name}`,
            mounts: [`bind /workspaces/${name}`, 'volume /vscode'],
            dialog: undefined,
            notifications: [],
          },
        );
      },
    );
  });
});
