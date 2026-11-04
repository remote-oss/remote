import {deepStrictEqual} from 'node:assert';
import path from 'node:path';
import {closeWindow, runScopedName} from '../windows/harness.ts';
import {docker} from '../windows/dev-containers-view.ts';
import {imageWithLabel, textOfFile} from './support.ts';
import {connectedWindow, removeContainers} from '../windows/folder-windows.ts';

/** The parts of `docker inspect` that the rows read. */
interface Inspected {
  Config: {Env: string[]; Hostname: string; Labels: Record<string, string>};
  HostConfig: {
    CapAdd: string[] | null;
    Init: boolean | null;
    Privileged: boolean;
    PortBindings: Record<string, unknown> | null;
  };
  Mounts: Array<{Type: string; Name?: string; Destination: string}>;
}

/** What `docker inspect` gives for `container`. */
async function inspected(container: string): Promise<Inspected> {
  const [first] = JSON.parse(await docker('inspect', container)) as Inspected[];
  if (first === undefined) {
    throw new Error(`docker inspect gave nothing for ${container}`);
  }
  return first;
}

describe('The image’s metadata label merged into the container (card coverage-112)', function () {
  this.timeout(1_200_000);
  const first = runScopedName('c112-first');
  const second = runScopedName('c112-second');
  const own = runScopedName('c112-own');
  const layers = [
    {
      containerEnv: {C112_IMAGE: 'image', C112_BOTH: 'image'},
      capAdd: ['SYS_PTRACE'],
      init: true,
      mounts: [`type=volume,source=${first},target=/c112-dest`],
      onCreateCommand: 'echo first >> /tmp/c112-create',
      postCreateCommand: 'echo first >> /tmp/c112-order',
      runArgs: ['--hostname=c112-host'],
      appPort: 5123,
      workspaceFolder: '/c112-ignored',
    },
    {
      capAdd: ['NET_ADMIN'],
      privileged: true,
      mounts: [{type: 'volume', source: second, target: '/c112-dest'}],
      onCreateCommand: 'echo second >> /tmp/c112-create',
      postCreateCommand: 'echo second >> /tmp/c112-order',
    },
  ];
  let image = '';

  before(async () => {
    image = await imageWithLabel('c112-layers', layers);
  });

  after(async () => {
    await docker('rmi', '--force', image).catch(() => undefined);
    await docker('volume', 'rm', '--force', first, second, own).catch(
      () => undefined,
    );
  });

  it('F-0306 AC-2, AC-3, AC-13, AC-14, AC-19, AC-20, AC-40 (c112-merge): a bare configuration over a two-layer label gives the union of the capabilities, both flags, the last layer’s mount at a shared destination, the layers’ commands in order, and a label equal to the image’s, and runArgs, appPort and workspaceFolder of the label do nothing', async () => {
    const {name, containerId, folder} = await connectedWindow('c112-merge', {
      image,
    });
    try {
      const container = await inspected(containerId);
      const imageLabel = JSON.parse(
        await docker(
          'image',
          'inspect',
          '--format',
          '{{index .Config.Labels "devcontainer.metadata"}}',
          image,
        ),
      ) as unknown[];
      deepStrictEqual(
        {
          capabilities: [...(container.HostConfig.CapAdd ?? [])].sort(),
          init: container.HostConfig.Init,
          privileged: container.HostConfig.Privileged,
          environment: container.Config.Env.filter(line =>
            line.startsWith('C112_'),
          ).sort(),
          destination: container.Mounts.filter(
            mount => mount.Destination === '/c112-dest',
          ).map(mount => mount.Name),
          label: JSON.parse(
            container.Config.Labels['devcontainer.metadata'] ?? '[]',
          ) as unknown[],
          created: await textOfFile(containerId, '/tmp/c112-create'),
          hostname: container.Config.Hostname.startsWith(
            containerId.slice(0, 12),
          ),
          ports: Object.keys(container.HostConfig.PortBindings ?? {}),
          workspace: container.Mounts.some(
            mount =>
              mount.Destination === `/workspaces/${path.basename(folder)}`,
          ),
        },
        {
          capabilities: ['CAP_NET_ADMIN', 'CAP_SYS_PTRACE'],
          init: true,
          privileged: true,
          environment: ['C112_BOTH=image', 'C112_IMAGE=image'],
          destination: [second],
          label: imageLabel,
          created: 'first\nsecond',
          hostname: true,
          ports: [],
          workspace: true,
        },
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
      await removeContainers(folder);
    }
  });

  it('F-0306 AC-5, AC-6, AC-29, AC-35 (c112-override): devcontainer.json wins a variable and a mount destination over the label, the variable only the image sets stays, every layer’s postCreateCommand runs with the file’s last, and the label holds the layers and then the file’s properties as written', async () => {
    const entry = {
      containerEnv: {C112_BOTH: 'config'},
      mounts: [{type: 'volume', source: own, target: '/c112-dest'}],
      postCreateCommand: 'echo config >> /tmp/c112-order',
      customizations: {vscode: {extensions: ['-a.b']}},
    };
    const {name, containerId, folder} = await connectedWindow('c112-override', {
      image,
      ...entry,
    });
    try {
      const container = await inspected(containerId);
      deepStrictEqual(
        {
          environment: container.Config.Env.filter(line =>
            line.startsWith('C112_'),
          ).sort(),
          destination: container.Mounts.filter(
            mount => mount.Destination === '/c112-dest',
          ).map(mount => mount.Name),
          order: await textOfFile(containerId, '/tmp/c112-order'),
          label: JSON.parse(
            container.Config.Labels['devcontainer.metadata'] ?? '[]',
          ) as unknown[],
        },
        {
          environment: ['C112_BOTH=config', 'C112_IMAGE=image'],
          destination: [own],
          order: 'first\nsecond\nconfig',
          label: [...layers, entry],
        },
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
      await removeContainers(folder);
    }
  });
});
