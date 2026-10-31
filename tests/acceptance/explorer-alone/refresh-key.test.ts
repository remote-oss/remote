/**
 * @fileoverview The refresh key in set C0 (card coverage-25e, #1348): with the SSH companion absent and the launch's
 * one empty window, pressing the key runs the command and changes nothing.
 */

import {deepStrictEqual} from 'node:assert';
import {
  bindRefreshKey,
  NO_EFFECTS,
  nothingFails,
  pressRefreshKey,
  VIEW,
} from '../windows/explorer-rows.ts';
import {inWindow} from '../windows/harness.ts';
import {viewRows} from '../windows/renderer.ts';

/** The launch's first window, which has no folder. */
const LOCAL = 'local';

describe('the refresh key in set C0 (card coverage-25e)', function () {
  this.timeout(180_000);
  let unbind: () => void;

  before(() => {
    unbind = bindRefreshKey();
  });

  after(() => {
    unbind();
  });

  it('F-5101 AC-21 (key-c0): in an empty window without the companion the key does nothing, and the view stays empty', async () => {
    await inWindow(LOCAL, 'remoteTargets.focus');
    const effects = await pressRefreshKey(LOCAL);
    await nothingFails(LOCAL);
    deepStrictEqual([effects, await viewRows(LOCAL, VIEW)], [NO_EFFECTS, []]);
  });
});
