/**
 * @fileoverview How a host row starts when it gains its first folder (card explorer-10, F-5104 BR-7): the row was a leaf
 * when the view was first drawn, and Refresh draws it expanded with the folder as its child.
 * It runs before the gate rows, which reload the launch's local window into an SSH one.
 */

import {deepStrictEqual} from 'node:assert';
import {
  printWalkTraces,
  rememberPage,
  titleAction,
  viewRows,
} from '../windows/renderer.ts';
import {inWindow} from '../windows/harness.ts';
import {VIEW} from '../windows/explorer-rows.ts';
import {
  folderRowsOf,
  foldersSettled,
  HOME,
  visit,
} from '../windows/explorer-folders.ts';

// This launch's reads print their walk trace (card #2960), so a row cut by its timeout tells from the log where its
// walk stood: each bundled file holds its own copy of the renderer, so every file of the launch turns it on.
printWalkTraces(true);

/**
 * The wait under its start and end stamps (card #2960): the runner timestamps every line it echoes, so a row cut by
 * its timeout tells which wait held.
 */
async function stamped<Value>(
  label: string,
  wait: () => Promise<Value>,
): Promise<Value> {
  console.log(`leaf-to-parent: ${label} begins`);
  try {
    return await wait();
  } finally {
    console.log(`leaf-to-parent: ${label} ends`);
  }
}

describe('the host row that gains its first folder (card explorer-10)', function () {
  this.timeout(300_000);

  it('F-5104 AC-2 (leaf-to-parent): by BR-7 a host with no history is a leaf, and after a folder is opened on it and the view is refreshed the row is expanded with that folder as its child', async () => {
    const alias = 'harness';
    const folder = `${HOME}/ex10-first`;
    await stamped('rememberPage', () => rememberPage('local'));
    await stamped('the remote view', () =>
      inWindow('local', 'workbench.view.remote'),
    );
    const leaf = await stamped('the first walk', async () =>
      ((await viewRows('local', VIEW)) ?? []).find(
        entry => entry.level === 2 && entry.label === alias,
      ),
    );
    await stamped('visit', () => visit(alias, 'ex10-first'));
    await stamped('Refresh', () => titleAction('local', VIEW, 'Refresh'));
    await stamped('foldersSettled', () =>
      foldersSettled('local', alias, [folder]),
    );
    const parent = await stamped('the second walk', async () =>
      ((await viewRows('local', VIEW)) ?? []).find(
        entry => entry.level === 2 && entry.label === alias,
      ),
    );
    const children = await stamped('the folder rows', () =>
      folderRowsOf('local', alias),
    );
    deepStrictEqual(
      [leaf?.expanded, parent?.expanded, children],
      [undefined, true, [{label: 'ex10-first', description: folder}]],
    );
  });
});
