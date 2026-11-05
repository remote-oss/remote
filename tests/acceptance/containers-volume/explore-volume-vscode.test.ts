/**
 * @fileoverview The vscode volume explored in a Dev Container (card containers-155, part B): exploring it mounts it
 * at /volume and at /vscode. Rows are prefixed `c155-`.
 */

import {deepStrictEqual} from 'node:assert';
import {closeWindow} from '../windows/harness.ts';
import {docker} from '../windows/dev-containers-view.ts';
import {explorersOf, explored, WINDOW} from './explore-support.ts';

describe('Explore a Volume in a Dev Container (card containers-155)', function () {
  this.timeout(1_800_000);

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
      for (const container of await explorersOf('vscode')) {
        await docker('rm', '-f', container).catch(() => undefined);
      }
    }
  });
});
