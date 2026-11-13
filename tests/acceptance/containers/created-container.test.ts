import {deepStrictEqual} from 'node:assert';
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {closeWindow, runLabelArguments, variable} from '../windows/harness.ts';
import {removeContainers} from '../windows/folder-windows.ts';
import {hostIdentityOf} from './host-identity.ts';
import {connectedWindow, docker, serverProcessesOf} from './resolve-support.ts';

/** The host the rows run on: a Linux host has a user and a group id, which the remote user takes; a Windows host has none. */
const HOST = hostIdentityOf(process);

/** Builds an image from the run's with a non-root `vscode` user named by its metadata label, and a label of its own; gives its tag. */
async function imageWithUser(label: string): Promise<string> {
  const context = path.join(variable('HARNESS_RUN_FOLDER'), label);
  mkdirSync(context, {recursive: true});
  writeFileSync(
    path.join(context, 'Dockerfile'),
    [
      `FROM ${variable('HARNESS_DEVCONTAINER_IMAGE')}`,
      // The remote user is on the host's UID, as the reference's is, so the UID update changes nothing; the run's own `node` user may hold that UID. A host with no UID (Windows) has no such update: the remote user is on 1000.
      `RUN (deluser node || true) && adduser -D -u ${String(HOST.userId)} vscode`,
      'LABEL c71.base="present"',
      `LABEL devcontainer.metadata='[{"remoteUser":"vscode"}]'`,
      '',
    ].join('\n'),
  );
  const imageTag = `${label}:${variable('HARNESS_RUN_ID')}`;
  await docker('build', '--tag', imageTag, ...runLabelArguments(), context);
  return imageTag;
}

/** The digest of a layer that holds no file: the empty tar archive, which a build step that changes nothing leaves, whichever image store lists it. */
const EMPTY_LAYER =
  'sha256:5f70bf18a086007016e948b04aed3b82103a36bea41755b6cddfaf10ace3c6ef';

/** The digests of the layers of the image `reference` names, bottom first. */
async function layersOf(reference: string): Promise<string[]> {
  return JSON.parse(
    await docker(
      'image',
      'inspect',
      '--format',
      '{{json .RootFS.Layers}}',
      reference,
    ),
  ) as string[];
}

/** The number `id` prints for `vscode` with `option` (`-u` or `-g`) in container `containerId`. */
async function userIdOf(containerId: string, option: string): Promise<string> {
  return (await docker('exec', containerId, 'id', option, 'vscode')).trim();
}

describe('F-0403 the container Open Folder in Container creates (card coverage-71)', function () {
  this.timeout(600_000);

  it('F-0403 AC-11 (c71-inspect): the created container has a random name, the folder labels and the metadata with the remote user, the base image’s labels, the folder bind and the vscode volume; the derived -uid image adds only empty layers; the remote user has the host’s UID and GID and the server runs as it, while the container runs as root', async () => {
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
      // Only a host with a user id gets the derived image of the UID update (F-0403 BR-6); on a host without one the
      // container runs the configuration's image as it is.
      const derived = HOST.synchronised
        ? await docker(
            'image',
            'inspect',
            '--format',
            '{{index .RepoTags 0}}',
            container?.Config.Image ?? '',
          )
        : undefined;
      const derivedInspect =
        derived === undefined
          ? undefined
          : (JSON.parse(await docker('inspect', derived)) as Array<{
              Config: {Labels: Record<string, string>; User: string};
            }>);
      const baseLayers = await layersOf(image);
      const derivedLayers =
        derived === undefined ? [] : await layersOf(derived);
      const added = derivedLayers.slice(baseLayers.length);
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
          derivedName:
            derived === undefined
              ? undefined
              : /^vsc-c71-inspect-[0-9a-f]{64}-uid:latest$/.test(derived),
          configuredImage:
            derived === undefined
              ? container?.Config.Image === image
              : undefined,
          addsOnlyEmptyLayers:
            derived === undefined
              ? undefined
              : derivedLayers.slice(0, baseLayers.length).join() ===
                  baseLayers.join() &&
                added.every(layer => layer === EMPTY_LAYER),
          derivedLabelsKept:
            derivedInspect === undefined
              ? undefined
              : derivedInspect[0]?.Config.Labels['c71.base'] === 'present',
          derivedUser: derivedInspect?.[0]?.Config.User,
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
          derivedName: HOST.synchronised ? true : undefined,
          configuredImage: HOST.synchronised ? undefined : true,
          addsOnlyEmptyLayers: HOST.synchronised ? true : undefined,
          derivedLabelsKept: HOST.synchronised ? true : undefined,
          derivedUser: HOST.synchronised ? 'root' : undefined,
          userId: String(HOST.userId),
          groupId: String(HOST.groupId),
          containerUser: 'root',
          serverUser: 'vscode',
        },
        `the layers of the derived image ${JSON.stringify(derivedLayers)} and of the base ${JSON.stringify(baseLayers)}`,
      );
    } finally {
      await removeContainers(folder);
    }
  });
});
