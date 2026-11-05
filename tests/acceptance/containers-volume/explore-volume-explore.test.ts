/**
 * @fileoverview A plain volume explored in a Dev Container (card containers-155, part B): it opens as root with the
 * volume at /volume and no Docker socket, in Restricted Mode, the same volume again runs the same container, and
 * another volume gets its own. Rows are prefixed `c155-`.
 */

import {deepStrictEqual} from 'node:assert';
import {closeWindow, isTrusted, runScopedName} from '../windows/harness.ts';
import {docker} from '../windows/dev-containers-view.ts';
import {explorersOf, explored, WINDOW} from './explore-support.ts';

describe('Explore a Volume in a Dev Container (card containers-155)', function () {
  this.timeout(1_800_000);
  const volumes: string[] = [];

  afterEach(async () => {
    await closeWindow(WINDOW).catch(() => undefined);
    for (const name of volumes.splice(0)) {
      for (const container of await explorersOf(name)) {
        await docker('rm', '-f', container).catch(() => undefined);
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
});
