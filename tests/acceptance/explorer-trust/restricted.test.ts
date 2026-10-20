/**
 * @fileoverview The explorer in a folder in Restricted Mode (card coverage-25c, part b): the launch turns workspace trust
 * on, so a new folder window starts untrusted.
 */

import {deepStrictEqual} from 'node:assert';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {
  nothingFails,
  rowsOf,
  rowsSettled,
  VIEW,
} from '../windows/explorer-rows.ts';
import {
  closeWindow,
  hostAliases,
  inWindow,
  isTrusted,
  variable,
} from '../windows/harness.ts';
import {titleAction} from '../windows/renderer.ts';

describe('the explorer in Restricted Mode (card coverage-25c, part b)', function () {
  this.timeout(180_000);

  it('F-5901 AC-10 (restricted): in an untrusted folder the view shows the SSH group and its hosts as in a trusted one, and Refresh works', async () => {
    const folder = path.join(variable('HARNESS_RUN_FOLDER'), 'restricted-view');
    mkdirSync(folder, {recursive: true});
    const name = await openFolderWindow(folder);
    try {
      const trusted = await isTrusted(name);
      await inWindow(name, 'workbench.view.remote');
      await rowsSettled(name, rowsOf(hostAliases(), undefined));
      await titleAction(name, VIEW, 'Refresh');
      await rowsSettled(name, rowsOf(hostAliases(), undefined));
      await nothingFails(name);
      deepStrictEqual(trusted, false);
    } finally {
      await closeWindow(name);
    }
  });
});
