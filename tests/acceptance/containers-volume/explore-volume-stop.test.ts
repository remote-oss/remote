/**
 * @fileoverview An explored volume left stopped (card containers-155, part B): when the window goes the container
 * stops within about 30 s and is not removed. Rows are prefixed `c155-`.
 */

import {deepStrictEqual} from 'node:assert';
import {closeWindow, runScopedName, waitFor} from '../windows/harness.ts';
import {docker, stateOf} from '../windows/dev-containers-view.ts';
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
});
