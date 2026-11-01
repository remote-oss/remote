import {deepStrictEqual} from 'node:assert';
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {closeWindow, runLabelArguments, variable} from '../windows/harness.ts';
import {removeContainers} from '../windows/folder-windows.ts';
import {connectedWindow, docker, serverProcessesOf} from './resolve-support.ts';

/** Builds an image from the run's with a non-root `vscode` user named by its metadata label, and a label of its own; gives its tag. */
async function imageWithUser(label: string): Promise<string> {
  const context = path.join(variable('HARNESS_RUN_FOLDER'), label);
  mkdirSync(context, {recursive: true});
  writeFileSync(
    path.join(context, 'Dockerfile'),
    [
      `FROM ${variable('HARNESS_DEVCONTAINER_IMAGE')}`,
      // The remote user is on the host's UID, as the reference's is, so the UID update changes nothing; the run's own `node` user may hold that UID.
      `RUN (deluser node || true) && adduser -D -u ${String(process.getuid?.())} vscode`,
      'LABEL c71.base="present"',
      `LABEL devcontainer.metadata='[{"remoteUser":"vscode"}]'`,
      '',
    ].join('\n'),
  );
  const imageTag = `${label}:${variable('HARNESS_RUN_ID')}`;
  await docker('build', '--tag', imageTag, ...runLabelArguments(), context);
  return imageTag;
}

/** The number `id` prints for `vscode` with `option` (`-u` or `-g`) in container `containerId`. */
async function userIdOf(containerId: string, option: string): Promise<string> {
  return (await docker('exec', containerId, 'id', option, 'vscode')).trim();
}

describe('F-0403 the container Open Folder in Container creates (card coverage-71)', function () {
  this.timeout(600_000);

  it('F-0403 AC-11 (c71-inspect): the created container has a random name, the folder labels and the metadata with the remote user, the base image’s labels, the folder bind and the vscode volume; the derived -uid image adds only zero-size layers; the remote user has the host’s UID and GID and the server runs as it, while the container runs as root', async () => {
    const image = await imageWithUser('c71-uid');
    const {name, containerId, folder} = await connectedWindow('c71-inspect', {
      image,
    });
    try {
      const inspected = JSON.parse(
        await docker('inspect', containerId),
      ) as Array<{
        Name: string;
        Config: {Labels: Record<string, string>; User: string; Image: string};
        Mounts: Array<{
          Type: string;
          Source: string;
          Destination: string;
          RW: boolean;
          Name?: string;
        }>;
      }>;
      const [container] = inspected;
      const derived = await docker(
        'image',
        'inspect',
        '--format',
        '{{index .RepoTags 0}}',
        container?.Config.Image ?? '',
      );
      const derivedInspect = JSON.parse(
        await docker('inspect', derived),
      ) as Array<{
        Config: {Labels: Record<string, string>; User: string};
      }>;
      const history = (
        await docker('history', '--no-trunc', '--format', '{{.Size}}', derived)
      ).split('\n');
      const baseHistory = (
        await docker('history', '--no-trunc', '--format', '{{.Size}}', image)
      ).split('\n');
      const onTop = history.slice(0, history.length - baseHistory.length);
      const [server] = await serverProcessesOf(containerId);
      const serverUser = await docker(
        'exec',
        containerId,
        'sh',
        '-c',
        `stat -c %U /proc/${String(server?.processId)}`,
      );
      await closeWindow(name);
      deepStrictEqual(
        {
          randomName: /^\/[a-z]+_[a-z]+$/.test(container?.Name ?? ''),
          folder: container?.Config.Labels['devcontainer.local_folder'],
          configFile: container?.Config.Labels['devcontainer.config_file'],
          remoteUserInMetadata: (
            JSON.parse(
              container?.Config.Labels['devcontainer.metadata'] ?? '[]',
            ) as Array<{remoteUser?: string}>
          ).some(entry => entry.remoteUser === 'vscode'),
          inherited: container?.Config.Labels['c71.base'],
          bind: container?.Mounts.filter(
            mount =>
              mount.Destination === `/workspaces/${path.basename(folder)}`,
          ).map(mount => [mount.Type, mount.Source, mount.RW]),
          volume: container?.Mounts.filter(
            mount => mount.Destination === '/vscode',
          ).map(mount => [mount.Type, mount.Name]),
          derivedName: /^vsc-c71-inspect-[0-9a-f]{64}-uid:latest$/.test(
            derived,
          ),
          zeroLayers: onTop.every(size => size === '0B'),
          derivedLabelsKept:
            derivedInspect[0]?.Config.Labels['c71.base'] === 'present',
          derivedUser: derivedInspect[0]?.Config.User,
          userId: await userIdOf(containerId, '-u'),
          groupId: await userIdOf(containerId, '-g'),
          containerUser: container?.Config.User,
          serverUser,
        },
        {
          randomName: true,
          folder,
          configFile: path.join(folder, '.devcontainer', 'devcontainer.json'),
          remoteUserInMetadata: true,
          inherited: 'present',
          bind: [['bind', folder, true]],
          volume: [['volume', 'vscode']],
          derivedName: true,
          zeroLayers: true,
          derivedLabelsKept: true,
          derivedUser: 'root',
          userId: String(process.getuid?.()),
          groupId: String(process.getgid?.()),
          containerUser: 'root',
          serverUser: 'vscode',
        },
      );
    } finally {
      await removeContainers(folder);
    }
  });
});
