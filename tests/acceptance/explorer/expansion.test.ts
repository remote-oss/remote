/**
 * @fileoverview How a host row starts when it gains its first folder (card explorer-10, F-5104 BR-7): the row was a leaf
 * when the view was first drawn, and Refresh draws it expanded with the folder as its child.
 * It runs before the gate rows, which reload the launch's local window into an SSH one.
 */

import {deepStrictEqual} from 'node:assert';
import {rememberPage, titleAction, viewRows} from '../windows/renderer.ts';
import {inWindow} from '../windows/harness.ts';
import {VIEW} from '../windows/explorer-rows.ts';
import {
  folderRowsOf,
  foldersSettled,
  HOME,
  visit,
} from '../windows/explorer-folders.ts';

describe('the host row that gains its first folder (card explorer-10)', function () {
  this.timeout(300_000);

  it('F-5104 AC-2 (leaf-to-parent): by BR-7 a host with no history is a leaf, and after a folder is opened on it and the view is refreshed the row is expanded with that folder as its child', async () => {
    const alias = 'harness';
    const folder = `${HOME}/ex10-first`;
    await rememberPage('local');
    await inWindow('local', 'workbench.view.remote');
    const leaf = ((await viewRows('local', VIEW)) ?? []).find(
      entry => entry.level === 2 && entry.label === alias,
    );
    await visit(alias, 'ex10-first');
    await titleAction('local', VIEW, 'Refresh');
    await foldersSettled('local', alias, [folder]);
    const parent = ((await viewRows('local', VIEW)) ?? []).find(
      entry => entry.level === 2 && entry.label === alias,
    );
    deepStrictEqual(
      [leaf?.expanded, parent?.expanded, await folderRowsOf('local', alias)],
      [undefined, true, [{label: 'ex10-first', description: folder}]],
    );
  });
});
