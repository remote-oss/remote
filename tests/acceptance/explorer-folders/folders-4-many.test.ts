/**
 * @fileoverview The recent folders under a host row (card coverage-102, part 1): F-2503's history store as the view
 * shows it, in the row that opens 122 folders on one host. The history of a run outlives a row, so each row
 * names its folders with a prefix of its own and counts only the entries that start with it.
 */

import {deepStrictEqual} from 'node:assert';
import {rememberPage} from '../windows/renderer.ts';
import {
  foldersSettled,
  HOME,
  ownPathsOf,
  visit,
} from '../windows/explorer-folders.ts';
import {HOST_B, refreshed} from './folders-support.ts';

describe('the recent folders under a host (card coverage-102, part 1)', function () {
  this.timeout(600_000);

  // The history of a run outlives a row, and other files of the launch visit folders of their own: each row counts only
  // the entries that start with its own prefix.
  before(() => rememberPage('local'));

  it('F-2503 AC-21 (many-folders): 122 different folders opened one after another on one host are all listed, most recent first, none dropped', async function () {
    this.timeout(2_400_000);
    const scope = `${HOME}/c102-m`;
    const names = [...Array(122).keys()].map(
      position => `c102-m${String(position).padStart(3, '0')}`,
    );
    for (const name of names) {
      await visit(HOST_B, name);
    }
    const stored = await ownPathsOf(HOST_B, scope);
    await refreshed();
    await foldersSettled('local', HOST_B, stored, scope);
    deepStrictEqual(
      [stored.length, stored.toReversed()],
      [122, names.map(name => `${HOME}/${name}`)],
    );
  });
});
