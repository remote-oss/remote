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
  waitFor,
} from '../windows/harness.ts';
import {
  extensionsViewSections,
  extensionStatusShown,
  titleAction,
} from '../windows/renderer.ts';

/** The display name of the explorer in the Extensions view. */
const EXPLORER_NAME = 'Remote Explorer';

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
  it('F-5001 AC-9 (workspace-unsupported): in an untrusted folder core’s @workspaceUnsupported list does not hold the explorer, and its Extensions-view entry carries no Restricted-Mode marker', async () => {
    const folder = path.join(variable('HARNESS_RUN_FOLDER'), 'restricted-list');
    mkdirSync(folder, {recursive: true});
    const name = await openFolderWindow(folder);
    try {
      const trusted = await isTrusted(name);
      await inWindow(name, 'workbench.view.extensions');
      await inWindow(
        name,
        'workbench.extensions.action.clearExtensionsSearchResults',
      );
      await waitFor(
        'the Extensions view to list the explorer',
        async () =>
          (await extensionsViewSections(name)).some(section =>
            section.entries.includes(EXPLORER_NAME),
          ),
        30_000,
      );
      const marker = await extensionStatusShown(name, EXPLORER_NAME);
      // The command the Workspace Trust editor's extensions link runs.
      await inWindow(
        name,
        'workbench.extensions.action.listWorkspaceUnsupportedExtensions',
      );
      await waitFor(
        'the @workspaceUnsupported list',
        async () =>
          (await extensionsViewSections(name)).some(
            section =>
              section.title === 'Disabled in Restricted Mode' &&
              section.entries.length > 0,
          ),
        30_000,
      );
      const listed = (await extensionsViewSections(name)).flatMap(
        section => section.entries,
      );
      deepStrictEqual(
        [trusted, marker, listed.includes(EXPLORER_NAME), listed.length > 0],
        [false, false, false, true],
      );
    } finally {
      await closeWindow(name);
    }
  });
});
