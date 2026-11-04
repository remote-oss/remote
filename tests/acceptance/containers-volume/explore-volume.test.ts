/**
 * @fileoverview Explore a Volume in a Dev Container (card containers-155, part B): a volume is opened in the shared
 * Alpine definition, found again by its labels, untrusted, and left stopped when its window goes. Rows are prefixed
 * `c155-`.
 */

import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  connectedToContainer,
  hexOf,
  inWindow,
  isTrusted,
  runScopedName,
  waitFor,
} from '../windows/harness.ts';
import {docker, stateOf} from '../windows/dev-containers-view.ts';

/** The window of an explored volume is named after the folder `/volume`. */
const WINDOW = 'volume';

/** The address of the window that explores the volume `volumeName`, as the command or a link opens it. */
function exploreUri(volumeName: string): string {
  return `vscode-remote://dev-container+${hexOf({
    repositoryPath: '',
    volumeName,
    folder: 'volume',
    inspectVolume: true,
  })}/volume`;
}

/** The ids of the containers that carry the label `vsch.local.volume=<volumeName>`, stopped or not. */
async function explorersOf(volumeName: string): Promise<string[]> {
  const output = await docker(
    'ps',
    '-a',
    '-q',
    '--no-trunc',
    '--filter',
    `label=vsch.local.volume=${volumeName}`,
  );
  return output === '' ? [] : output.split('\n');
}

/** Opens the explore window of `volumeName` and waits until it is connected. */
async function explored(volumeName: string): Promise<void> {
  await inWindow(
    'local',
    'acceptance.agent.openWindow',
    exploreUri(volumeName),
  );
  await connectedToContainer(WINDOW, 900_000);
}

describe('Explore a Volume in a Dev Container (card containers-155)', function () {
  this.timeout(1_800_000);
  const volumes: string[] = [];

  afterEach(async () => {
    await closeWindow(WINDOW).catch(() => undefined);
    for (const name of volumes.splice(0)) {
      for (const id of await explorersOf(name)) {
        await docker('rm', '-f', id).catch(() => undefined);
      }
      await docker('volume', 'rm', '-f', name).catch(() => undefined);
    }
  });

  it('F-0705 AC-8, AC-11, AC-12, AC-17, AC-29 (c155-explore): a plain volume opens as root with the volume at /volume and no Docker socket, in Restricted Mode, the same volume again runs the same container, and another volume gets its own', async () => {
    const first = runScopedName('c155-first');
    const second = runScopedName('c155-second');
    volumes.push(first, second);
    await docker('volume', 'create', first);
    await docker('volume', 'create', second);
    await explored(first);
    const [container] = await explorersOf(first);
    const inspected = JSON.parse(
      await docker('inspect', container ?? '', '--format', '{{json .}}'),
    ) as {
      Config: {Labels: Record<string, string>};
      Mounts: Array<{Type: string; Name?: string; Destination: string}>;
    };
    const trusted = await isTrusted(WINDOW);
    const metadata = JSON.parse(
      inspected.Config.Labels['devcontainer.metadata'] ?? '[]',
    ) as Array<{remoteUser?: string}>;
    await closeWindow(WINDOW);
    await explored(first);
    const again = await explorersOf(first);
    await closeWindow(WINDOW);
    await explored(second);
    deepStrictEqual(
      {
        mounts: inspected.Mounts.filter(
          mount => mount.Destination === '/volume',
        ).map(mount => [mount.Type, mount.Name]),
        cache: inspected.Mounts.filter(
          mount => mount.Destination === '/vscode',
        ).map(mount => [mount.Type, mount.Name]),
        socket: inspected.Mounts.some(mount =>
          mount.Destination.includes('docker.sock'),
        ),
        remoteUser: metadata.at(-1)?.remoteUser,
        trusted,
        again: again.length === 1 && again[0] === container,
        other: (await explorersOf(second)).length,
      },
      {
        mounts: [['volume', first]],
        cache: [['volume', 'vscode']],
        socket: false,
        remoteUser: 'root',
        trusted: false,
        again: true,
        other: 1,
      },
    );
  });

  it('F-0705 AC-13, AC-32 (c155-stop): when the window goes the container stops within about 30 s and is not removed', async () => {
    const name = runScopedName('c155-stop');
    volumes.push(name);
    await docker('volume', 'create', name);
    await explored(name);
    const [container] = await explorersOf(name);
    await closeWindow(WINDOW);
    await waitFor(
      'the explore container to exit',
      async () => (await stateOf(container ?? '')) === 'exited',
      60_000,
    );
    deepStrictEqual(await stateOf(container ?? ''), 'exited');
  });

  it('F-0705 AC-8b (c155-vscode): exploring the vscode volume itself mounts it at /volume and at /vscode', async () => {
    await docker('volume', 'create', 'vscode');
    try {
      await explored('vscode');
      const [container] = await explorersOf('vscode');
      const mounts = JSON.parse(
        await docker(
          'inspect',
          container ?? '',
          '--format',
          '{{json .Mounts}}',
        ),
      ) as Array<{Type: string; Name?: string; Destination: string}>;
      deepStrictEqual(
        mounts
          .filter(mount => ['/volume', '/vscode'].includes(mount.Destination))
          .map(mount => [mount.Destination, mount.Type, mount.Name])
          .sort(),
        [
          ['/volume', 'volume', 'vscode'],
          ['/vscode', 'volume', 'vscode'],
        ],
      );
    } finally {
      await closeWindow(WINDOW).catch(() => undefined);
      for (const id of await explorersOf('vscode')) {
        await docker('rm', '-f', id).catch(() => undefined);
      }
    }
  });
});
