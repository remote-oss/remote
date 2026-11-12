/**
 * @fileoverview The recent folders under a host row (card coverage-102, part 1): F-2503's history store as the view
 * shows it, in the rows that remove an entry and that open folders from other windows. The history of a run outlives a row, so each row
 * names its folders with a prefix of its own and counts only the entries that start with it.
 */

import {deepStrictEqual} from 'node:assert';
import {
  inWindow,
  onHost,
  recentlyOpenedIn,
  waitFor,
} from '../windows/harness.ts';
import {activations} from '../windows/folder-windows.ts';
import {
  dialogOf,
  notifications,
  rememberPage,
  rowMenuAction,
  titleAction,
  toggleRow,
} from '../windows/renderer.ts';
import {VIEW} from '../windows/explorer-rows.ts';
import {
  appearsAfter,
  closeIfOpen,
  folderRowsOf,
  foldersSettled,
  HOME,
  ownPathsOf,
  pathsOf,
  viewWindow,
  visit,
} from '../windows/explorer-folders.ts';
import {HOST_B, HOST_C, HOST_D, REMOVE, refreshed} from './folders-support.ts';

describe('the recent folders under a host (card coverage-102, part 1)', function () {
  this.timeout(600_000);

  // The history of a run outlives a row, and other files of the launch visit folders of their own: each row counts only
  // the entries that start with its own prefix.
  before(() => rememberPage('local'));

  it("F-2503 AC-9, AC-10, AC-31 (remove): Remove from Recent List drops the row at once without a dialog or notification, keeps the others' order and the editor's Open Recent entry, a reopened folder is first again, and a host's only entry leaves the row with no children", async () => {
    const first = `${HOME}/c102-r1`;
    const second = `${HOME}/c102-r2`;
    const third = `${HOME}/c102-r3`;
    const scope = `${HOME}/c102-r`;
    let window = '';
    try {
      await visit(HOST_B, 'c102-r1');
      await visit(HOST_B, 'c102-r2');
      await visit(HOST_B, 'c102-r3');
      await visit(HOST_C, 'c102-r4');
      window = await viewWindow('c102-remove');
      await foldersSettled(window, HOST_B, [third, second, first], scope);
      await rowMenuAction(window, VIEW, 'c102-r2', REMOVE);
      await foldersSettled(window, HOST_B, [third, first], scope);
      const shown = [
        await notifications(window),
        await dialogOf(window),
        await ownPathsOf(HOST_B, scope),
      ];
      const recent = (await recentlyOpenedIn('local')).map(entry =>
        decodeURIComponent(entry.uri),
      );
      await visit(HOST_B, 'c102-r2');
      await titleAction(window, VIEW, 'Refresh');
      await foldersSettled(window, HOST_B, [second, third, first], scope);
      // The rows of the host above are many by now: fold them, so that the next host's row is drawn.
      await toggleRow(window, VIEW, HOST_B);
      await rowMenuAction(window, VIEW, 'c102-r4', REMOVE);
      await foldersSettled(window, HOST_C, []);
      deepStrictEqual(
        [
          shown,
          recent.some(address => address.endsWith(second)),
          await pathsOf(HOST_C),
        ],
        [[[], undefined, [third, first]], true, []],
      );
    } finally {
      await closeIfOpen(window);
    }
  });

  it('F-2503 AC-22, AC-27, AC-32, F-5902 AC-10 (other-windows): a folder another window opens is not in this view until Refresh and then is, and two windows that open folders a few seconds apart are both recorded', async () => {
    const first = `${HOME}/c102-o1`;
    const second = `${HOME}/c102-o2`;
    const third = `${HOME}/c102-o3`;
    const fourth = `${HOME}/c102-o4`;
    const scope = `${HOME}/c102-o`;
    await visit(HOST_B, 'c102-o1');
    await refreshed();
    await foldersSettled('local', HOST_B, [first], scope);
    await visit(HOST_B, 'c102-o2');
    await new Promise(resolve => setTimeout(resolve, 15_000));
    const unchanged = (await folderRowsOf('local', HOST_B))
      .map(entry => entry.description)
      .filter(description => description.startsWith(scope));
    await titleAction('local', VIEW, 'Refresh');
    await foldersSettled('local', HOST_B, [second, first], scope);
    // Two windows, a few seconds apart, on two hosts.
    await onHost('mkdir', '-p', third, fourth);
    const early = activations('c102-o3');
    await inWindow(
      'local',
      'acceptance.agent.openWindow',
      `vscode-remote://ssh-remote+${HOST_B}${third}`,
    );
    await new Promise(resolve => setTimeout(resolve, 3_000));
    const late = activations('c102-o4');
    await inWindow(
      'local',
      'acceptance.agent.openWindow',
      `vscode-remote://ssh-remote+${HOST_D}${fourth}`,
    );
    await appearsAfter('c102-o3', early);
    await appearsAfter('c102-o4', late);
    await waitFor(
      'both windows to be recorded',
      async () =>
        (await pathsOf(HOST_B)).includes(third) &&
        (await pathsOf(HOST_D)).includes(fourth),
      60_000,
    );
    await closeIfOpen('c102-o3');
    await closeIfOpen('c102-o4');
    deepStrictEqual(
      [
        unchanged,
        (await pathsOf(HOST_B)).includes(third),
        (await pathsOf(HOST_D)).includes(fourth),
      ],
      [[first], true, true],
    );
  });
});
