/**
 * @fileoverview The recent folders under a target: the rows the view builds from Remote - SSH's folder history, their
 * order and look, and its remove action (card coverage-122, F-5104). The file runs after the gate rows, so the
 * launch's local window is an SSH one; every row opens the windows it needs from the reloaded one.
 */

import {deepStrictEqual} from 'node:assert';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {
  closeWindow,
  inWindow,
  onHost,
  readUserSettings,
  recordLines,
  restoreUserSettings,
  userSettings,
  variable,
  waitFor,
  windowEvents,
} from '../windows/harness.ts';
import {
  actionTooltip,
  hoverRow,
  rowContextMenu,
  rowDetails,
  rowMenuAction,
  rowTooltip,
  shownRowActionTitles,
  titleAction,
  toggleRow,
  viewRows,
} from '../windows/renderer.ts';
import {VIEW} from '../windows/explorer-rows.ts';
import {
  connectedTo,
  folderRowsOf,
  foldersSettled,
  HOME,
  historyOf,
  pathsOf,
} from '../windows/explorer-folders.ts';
import {reloadedWindow} from './reloaded-window.ts';

/** The view's actions and refresh, and the host of a second, reachable alias. */
const CURRENT = 'Connect in Current Window...';
const IN_NEW = 'Connect in New Window...';
const REMOVE = 'Remove from Recent List';
const REFRESH = 'Refresh';

/** The window every row opens its own from: the launch's local window reloaded into an SSH one. */
let driver = '';

describe('the recent folders under a target (card coverage-122)', function () {
  this.timeout(300_000);

  before(async () => {
    driver = await reloadedWindow();
  });

  /** The row's own local window on a new folder of the run, showing the Remotes view; its name. */
  async function viewWindowIn(label: string): Promise<string> {
    const folder = path.join(
      variable('HARNESS_RUN_FOLDER'),
      'explorer-folders',
      label,
    );
    mkdirSync(folder, {recursive: true});
    await inWindow(
      driver,
      'acceptance.agent.openWindow',
      pathToFileURL(folder).href,
    );
    await waitFor(
      `window ${label} to activate its agent`,
      () => windowEvents(label).some(each => each.event === 'activated'),
      120_000,
    );
    await inWindow(label, 'workbench.view.remote');
    return label;
  }

  /**
   * Opens `target` (an absolute path on `alias`) in a window of its own named `windowName`, waits until the history
   * holds it first, then closes the window: a window of the run is a recorded visit.
   */
  async function recordVisit(
    alias: string,
    target: string,
    windowName: string,
  ): Promise<void> {
    await onHost('mkdir', '-p', path.posix.dirname(target));
    await inWindow(
      driver,
      'acceptance.agent.openWindow',
      `vscode-remote://ssh-remote+${alias}${target}`,
    );
    await waitFor(
      `window ${windowName} to activate its agent`,
      () => windowEvents(windowName).some(each => each.event === 'activated'),
      120_000,
    );
    await connectedTo(windowName, alias);
    await waitFor(
      `the history of ${alias} to start with ${target}`,
      async () => (await pathsOf(alias))[0] === target,
      120_000,
    );
    await closeWindow(windowName);
  }

  it('F-5104 AC-1 (c122-mru): folders opened on a host in order come back most recent first under its expanded row', async () => {
    const window = await viewWindowIn('c122-mru');
    const scope = `${HOME}/c122-mru-`;
    try {
      for (const name of ['a', 'b', 'c']) {
        await recordVisit('harness', `${scope}${name}`, `c122-mru-${name}`);
      }
      await foldersSettled(
        window,
        'harness',
        [`${scope}c`, `${scope}b`, `${scope}a`],
        scope,
      );
      const rows = (await viewRows(window, VIEW)) ?? [];
      const host = rows.find(
        entry => entry.level === 2 && entry.label === 'harness',
      );
      deepStrictEqual(
        [
          host?.expanded,
          (await folderRowsOf(window, 'harness'))
            .map(entry => entry.description)
            .filter(each => each.startsWith(scope)),
        ],
        [true, [`${scope}c`, `${scope}b`, `${scope}a`]],
      );
    } finally {
      await closeWindow(window);
    }
  });

  it('F-5104 AC-3 (c122-row): a folder row is labelled with the base name, describes the full path, has no icon and its tooltip', async () => {
    const window = await viewWindowIn('c122-row');
    const target = `${HOME}/c122-row-alpha`;
    try {
      await recordVisit('harness', target, 'c122-row-alpha');
      await foldersSettled(window, 'harness', [target], `${HOME}/c122-row-`);
      const detail = ((await rowDetails(window, VIEW)) ?? []).find(
        each => each.label === 'c122-row-alpha',
      );
      const tooltip = await rowTooltip(window, VIEW, 'c122-row-alpha');
      deepStrictEqual(
        [detail?.label, detail?.description, detail?.icon, tooltip],
        ['c122-row-alpha', target, '', `'${target}' on harness`],
      );
    } finally {
      await closeWindow(window);
    }
  });

  it('F-5104 AC-4 (c122-ws): a workspace-file row is the file name plus (Workspace) with its path and the folder row two actions', async () => {
    const window = await viewWindowIn('c122-ws-view');
    const folder = `${HOME}/c122-ws`;
    const target = `${folder}/x.code-workspace`;
    try {
      await onHost('mkdir', '-p', folder);
      await onHost(
        'bash',
        '-c',
        `printf '%s' '{"folders":[{"path":"${folder}"}]}' > '${target}'`,
      );
      await recordVisit('harness', folder, 'c122-ws-folder');
      await recordVisit('harness', target, 'c122-ws');
      await foldersSettled(window, 'harness', [target, folder], folder);
      await hoverRow(window, VIEW, 'x (Workspace)');
      const wsTitles = await shownRowActionTitles(
        window,
        VIEW,
        'x (Workspace)',
      );
      await hoverRow(window, VIEW, 'c122-ws');
      const folderTitles = await shownRowActionTitles(window, VIEW, 'c122-ws');
      const detail = ((await rowDetails(window, VIEW)) ?? []).find(
        each => each.label === 'x (Workspace)',
      );
      const tooltip = await rowTooltip(window, VIEW, 'x (Workspace)');
      deepStrictEqual(
        [detail?.description, detail?.icon, tooltip, wsTitles, folderTitles],
        [
          target,
          '',
          `'${target}' on harness`,
          [CURRENT, IN_NEW],
          [CURRENT, IN_NEW],
        ],
      );
    } finally {
      await closeWindow(window);
    }
  });

  it('F-5104 AC-5 (c122-buttons): a folder row shows no inline action until it is hovered, then the two connect buttons with their tooltips', async () => {
    const window = await viewWindowIn('c122-buttons');
    const target = `${HOME}/c122-buttons-alpha`;
    try {
      await recordVisit('harness', target, 'c122-buttons-alpha');
      await foldersSettled(
        window,
        'harness',
        [target],
        `${HOME}/c122-buttons-`,
      );
      await hoverRow(window, VIEW, undefined);
      const before = await shownRowActionTitles(
        window,
        VIEW,
        'c122-buttons-alpha',
      );
      await hoverRow(window, VIEW, 'c122-buttons-alpha');
      const shown = await shownRowActionTitles(
        window,
        VIEW,
        'c122-buttons-alpha',
      );
      const currentTooltip = await actionTooltip(
        window,
        VIEW,
        'c122-buttons-alpha',
        CURRENT,
      );
      const newTooltip = await actionTooltip(
        window,
        VIEW,
        'c122-buttons-alpha',
        IN_NEW,
      );
      deepStrictEqual(
        [before, shown, currentTooltip, newTooltip],
        [[], [CURRENT, IN_NEW], CURRENT, IN_NEW],
      );
    } finally {
      await closeWindow(window);
    }
  });

  it('F-5104 AC-6 (c122-menu): the context menu of a folder row holds the three entries in order, and no host row offers Remove', async () => {
    const window = await viewWindowIn('c122-menu');
    const target = `${HOME}/c122-menu-alpha`;
    try {
      await recordVisit('harness', target, 'c122-menu-alpha');
      await foldersSettled(window, 'harness', [target], `${HOME}/c122-menu-`);
      const folderMenu = await rowContextMenu(window, VIEW, 'c122-menu-alpha');
      const hostMenu = await rowContextMenu(window, VIEW, 'harness');
      deepStrictEqual(
        [folderMenu, hostMenu.includes(REMOVE)],
        [[CURRENT, IN_NEW, REMOVE], false],
      );
    } finally {
      await closeWindow(window);
    }
  });

  it('F-5104 AC-13 (c122-alpha): with the sort order alphabetical the rows come in recorded-path code order, case-sensitive', async () => {
    const saved = readUserSettings();
    const window = await viewWindowIn('c122-alpha');
    try {
      await userSettings({
        'remote-explorer.foldersSortOrder': 'alphabetical',
      });
      const names = ['Charlie', '_under', 'alpha', 'bravo', 'zz/aaa-label'];
      for (const name of names) {
        await recordVisit(
          'harness',
          `${HOME}/c122-alpha/${name}`,
          path.posix.basename(name),
        );
      }
      await titleAction(window, VIEW, REFRESH);
      await foldersSettled(
        window,
        'harness',
        names.map(each => `${HOME}/c122-alpha/${each}`),
        `${HOME}/c122-alpha/`,
      );
    } finally {
      restoreUserSettings(saved);
      await closeWindow(window);
    }
  });

  it('F-5104 AC-16 (c122-collapsed): with the collapse setting every host starts collapsed with a twisty, and a host without history shows no child row', async () => {
    const saved = readUserSettings();
    try {
      await userSettings({'remote-explorer.collapseRecentFolders': true});
      const window = await viewWindowIn('c122-collapsed');
      try {
        await waitFor(
          `window ${window} to render its hosts collapsed`,
          async () => {
            const rows = (await viewRows(window, VIEW)) ?? [];
            const hosts = rows.filter(entry => entry.level === 2);
            return (
              hosts.length > 0 && hosts.every(entry => entry.expanded === false)
            );
          },
          30_000,
        );
        await toggleRow(window, VIEW, 'refused');
        const rows = (await viewRows(window, VIEW)) ?? [];
        const hosts = rows.filter(entry => entry.level === 2);
        const refused = hosts.find(entry => entry.label === 'refused');
        const children = rows.filter(entry => entry.level > 2);
        deepStrictEqual(
          [
            hosts.every(entry => entry.expanded === false) ||
              refused?.expanded === true,
            children.length,
            (await folderRowsOf(window, 'refused')).length,
          ],
          [true, 0, 0],
        );
      } finally {
        await closeWindow(window);
      }
    } finally {
      restoreUserSettings(saved);
    }
  });

  it('F-5104 AC-19 (c122-remove): a removed folder row is gone at once, with no notice, and stays gone in a restarted window', async () => {
    const window = await viewWindowIn('c122-remove');
    const target = `${HOME}/c122-remove-1`;
    try {
      await recordVisit('harness', target, 'c122-remove-1');
      await foldersSettled(window, 'harness', [target], `${HOME}/c122-remove-`);
      await rowMenuAction(window, VIEW, 'c122-remove-1', REMOVE);
      await foldersSettled(window, 'harness', [], `${HOME}/c122-remove-`);
      const second = await viewWindowIn('c122-remove-2');
      try {
        await waitFor(
          `window ${second} to show the earlier rows`,
          async () =>
            (await folderRowsOf(second, 'harness')).some(each =>
              each.description.startsWith(`${HOME}/c122-mru-`),
            ),
          15_000,
        );
        await foldersSettled(second, 'harness', [], `${HOME}/c122-remove-`);
        deepStrictEqual(
          [
            recordLines('notice', window),
            (await historyOf()).harness?.filter(entry =>
              entry.path.startsWith(`${HOME}/c122-remove-`),
            ) ?? [],
          ],
          [[], []],
        );
      } finally {
        await closeWindow(second);
      }
    } finally {
      await closeWindow(window);
    }
  });

  it('F-5104 AC-21 (c122-solo-leaf): removing the last folder row of a host leaves the host row a leaf without a twisty', async () => {
    const window = await viewWindowIn('c122-solo-view');
    const target = `${HOME}/c122-solo`;
    try {
      await recordVisit('jumped', target, 'c122-solo');
      await foldersSettled(window, 'jumped', [target]);
      await rowMenuAction(window, VIEW, 'c122-solo', REMOVE);
      const rows = (await viewRows(window, VIEW)) ?? [];
      const host = rows.find(
        entry => entry.level === 2 && entry.label === 'jumped',
      );
      deepStrictEqual(
        [
          host?.expanded,
          (await folderRowsOf(window, 'jumped')).length,
          (await historyOf()).jumped,
        ],
        [undefined, 0, undefined],
      );
    } finally {
      await closeWindow(window);
    }
  });
});
