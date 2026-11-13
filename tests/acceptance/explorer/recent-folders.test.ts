/**
 * @fileoverview The recent folders under a target: the rows the view builds from Remote - SSH's folder history, their
 * order and look, and its remove action (card coverage-122, F-5104). The file runs after the gate rows, so the
 * launch's local window is an SSH one; every row opens the windows it needs from the reloaded one.
 */

import {deepStrictEqual} from 'node:assert';
import {mkdirSync, writeFileSync} from 'node:fs';
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
  windowNames,
  windowState,
} from '../windows/harness.ts';
import {
  actionTooltip,
  hoverRow,
  notifications,
  quickPickFacts,
  rowAction,
  rowContextMenu,
  rowDetails,
  rowMenuAction,
  rowTooltip,
  shownRowActionTitles,
  titleAction,
  toggleRow,
  viewRows,
  windowTitle,
} from '../windows/renderer.ts';
import {VIEW} from '../windows/explorer-rows.ts';
import {
  connectedTo,
  folderRowsOf,
  foldersSettled,
  HOME,
  historyOf,
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
      async () => (await historyOf(driver))[alias]?.[0]?.path === target,
      120_000,
    );
    await closeWindow(windowName);
  }

  /** Closes the window `name` when it is open: a window a row reloaded away, or never made, is not. */
  async function closeIfOpen(name: string): Promise<void> {
    if (windowNames().includes(name)) {
      await closeWindow(name);
    }
  }

  /** The expanded state of the host row `label` in window `window`: a leaf is undefined, a collapsed row false. */
  async function hostExpanded(
    window: string,
    label: string,
  ): Promise<boolean | undefined> {
    const rows = (await viewRows(window, VIEW)) ?? [];
    return rows.find(entry => entry.level === 2 && entry.label === label)
      ?.expanded;
  }

  it('F-5104 AC-1 (c122-mru): folders opened on a host in order come back most recent first under its expanded row', async () => {
    const window = await viewWindowIn('c122-mru');
    const scope = `${HOME}/c122-mru-`;
    try {
      for (const name of ['a', 'b', 'c']) {
        await recordVisit('harness', `${scope}${name}`, `c122-mru-${name}`);
      }
      await titleAction(window, VIEW, REFRESH);
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
      await titleAction(window, VIEW, REFRESH);
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
      await recordVisit('harness', folder, 'c122-ws');
      await recordVisit('harness', target, 'c122-ws');
      await titleAction(window, VIEW, REFRESH);
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
      await titleAction(window, VIEW, REFRESH);
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
      await titleAction(window, VIEW, REFRESH);
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

  it('F-5104 AC-19 (c122-remove): a removed folder row is gone at once, with no notice, and stays gone in a restarted window', async function () {
    this.timeout(600_000);
    const window = await viewWindowIn('c122-remove');
    const target = `${HOME}/c122-remove-1`;
    try {
      await recordVisit('harness', target, 'c122-remove-1');
      await titleAction(window, VIEW, REFRESH);
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
            (await historyOf(driver)).harness?.filter(entry =>
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

  it('F-5104 AC-21 (c122-solo-leaf): removing the last folder row of a host leaves the host row a leaf without a twisty', async function () {
    this.timeout(600_000);
    const window = await viewWindowIn('c122-solo-view');
    const target = `${HOME}/c122-solo`;
    try {
      await recordVisit('jumped', target, 'c122-solo');
      await titleAction(window, VIEW, REFRESH);
      await foldersSettled(window, 'jumped', [target]);
      await rowMenuAction(window, VIEW, 'c122-solo', REMOVE);
      await foldersSettled(window, 'jumped', []);
      const rows = (await viewRows(window, VIEW)) ?? [];
      const host = rows.find(
        entry => entry.level === 2 && entry.label === 'jumped',
      );
      deepStrictEqual(
        [
          host?.expanded,
          (await folderRowsOf(window, 'jumped')).length,
          (await historyOf(driver)).jumped,
        ],
        [undefined, 0, undefined],
      );
    } finally {
      await closeWindow(window);
    }
  });

  it('F-5104 AC-7 (c122-current): a current-window connect on a reachable folder reloads the same window into it, with no other window and no notice', async function () {
    this.timeout(600_000);
    const window = await viewWindowIn('c122-current');
    const target = `${HOME}/c122-current-a`;
    try {
      await recordVisit('harness', target, 'c122-current-a');
      await titleAction(window, VIEW, REFRESH);
      await foldersSettled(
        window,
        'harness',
        [target],
        `${HOME}/c122-current-`,
      );
      const before = windowNames();
      await rowAction(window, VIEW, 'c122-current-a', CURRENT);
      await waitFor(
        `window c122-current-a to stand on ssh-remote+harness`,
        async () =>
          windowNames().includes('c122-current-a') &&
          (await windowState('c122-current-a')).remoteAuthority ===
            'ssh-remote+harness',
        120_000,
      );
      deepStrictEqual(
        [
          before.includes(window),
          windowNames().includes(window),
          windowNames().filter(name => !before.includes(name)),
          await notifications('c122-current-a'),
          await quickPickFacts('c122-current-a'),
        ],
        [true, false, ['c122-current-a'], [], undefined],
      );
    } finally {
      await closeIfOpen('c122-current-a');
      await closeIfOpen(window);
    }
  });

  it('F-5104 AC-8 (c122-first): after a current-window connect, the reloaded window lists the folder first under its host, unmarked', async function () {
    this.timeout(600_000);
    const window = await viewWindowIn('c122-first-view');
    const older = `${HOME}/c122-first-a`;
    const newer = `${HOME}/c122-first-b`;
    try {
      await recordVisit('harness', older, 'c122-first-a');
      await recordVisit('harness', newer, 'c122-first-b');
      await titleAction(window, VIEW, REFRESH);
      await foldersSettled(
        window,
        'harness',
        [newer, older],
        `${HOME}/c122-first-`,
      );
      await rowAction(window, VIEW, 'c122-first-b', CURRENT);
      await waitFor(
        `window c122-first-b to stand on ssh-remote+harness`,
        async () =>
          windowNames().includes('c122-first-b') &&
          (await windowState('c122-first-b')).remoteAuthority ===
            'ssh-remote+harness',
        120_000,
      );
      const reloaded = 'c122-first-b';
      await inWindow(reloaded, 'workbench.view.remote');
      await titleAction(reloaded, VIEW, REFRESH);
      await foldersSettled(
        reloaded,
        'harness',
        [newer, older],
        `${HOME}/c122-first-`,
      );
      const detail = ((await rowDetails(reloaded, VIEW)) ?? []).find(
        each => each.label === 'c122-first-b',
      );
      deepStrictEqual(
        [
          (await folderRowsOf(reloaded, 'harness'))
            .map(entry => entry.description)
            .filter(each => each.startsWith(`${HOME}/c122-first-`)),
          detail?.icon,
          detail?.ariaLabel,
        ],
        [[newer, older], '', `'${newer}' on harness, has actions`],
      );
    } finally {
      await closeIfOpen('c122-first-b');
      await closeIfOpen(window);
    }
  });

  it('F-5104 AC-9 (c122-newwin): a new-window connect opens exactly one window on the remote folder, and the acting window keeps its folder and view', async function () {
    this.timeout(600_000);
    const window = await viewWindowIn('c122-newwin');
    const target = `${HOME}/c122-newwin-a`;
    try {
      await recordVisit('harness', target, 'c122-newwin-a');
      await titleAction(window, VIEW, REFRESH);
      await foldersSettled(window, 'harness', [target], `${HOME}/c122-newwin-`);
      const before = windowNames();
      await rowAction(window, VIEW, 'c122-newwin-a', IN_NEW);
      await waitFor(
        `window c122-newwin-a to stand on ssh-remote+harness`,
        async () =>
          windowNames().includes('c122-newwin-a') &&
          (await windowState('c122-newwin-a')).remoteAuthority ===
            'ssh-remote+harness',
        120_000,
      );
      deepStrictEqual(
        [
          windowNames().filter(name => !before.includes(name)),
          (await windowState(window)).remoteAuthority,
          (await windowState(window)).folders.length,
          ((await viewRows(window, VIEW)) ?? []).length > 0,
        ],
        [['c122-newwin-a'], null, 1, true],
      );
    } finally {
      await closeIfOpen('c122-newwin-a');
      await closeIfOpen(window);
    }
  });

  it('F-5104 AC-10 (c122-newwin-open): a new-window connect on a folder already open opens no window, shows no notice and changes no order', async function () {
    this.timeout(600_000);
    const window = await viewWindowIn('c122-nwo-view');
    const target = `${HOME}/c122-nwo-a`;
    const open = 'c122-nwo-a';
    try {
      await onHost('mkdir', '-p', path.posix.dirname(target));
      await inWindow(
        driver,
        'acceptance.agent.openWindow',
        `vscode-remote://ssh-remote+harness${target}`,
      );
      await waitFor(
        `window ${open} to activate its agent`,
        () => windowEvents(open).some(each => each.event === 'activated'),
        120_000,
      );
      await connectedTo(open, 'harness');
      await titleAction(window, VIEW, REFRESH);
      await foldersSettled(window, 'harness', [target], `${HOME}/c122-nwo-`);
      const before = windowNames();
      await rowAction(window, VIEW, 'c122-nwo-a', IN_NEW);
      deepStrictEqual(
        [
          windowNames().filter(name => !before.includes(name)),
          await notifications(window),
          ((await historyOf(driver)).harness ?? [])
            .map(entry => entry.path)
            .filter(each => each.startsWith(`${HOME}/c122-nwo-`)),
        ],
        [[], [], [target]],
      );
    } finally {
      await closeIfOpen(open);
      await closeIfOpen(window);
    }
  });

  it('F-5104 AC-11 (c122-current-same): a current-window connect on the folder the acting window is already on does nothing', async function () {
    this.timeout(600_000);
    const window = await viewWindowIn('c122-cs-view');
    const acted = `${HOME}/c122-cs-a`;
    const other = `${HOME}/c122-cs-b`;
    try {
      await recordVisit('harness', acted, 'c122-cs-a');
      await recordVisit('harness', other, 'c122-cs-b');
      await inWindow(
        driver,
        'acceptance.agent.openWindow',
        `vscode-remote://ssh-remote+harness${acted}`,
      );
      await waitFor(
        `window c122-cs-a to activate its agent`,
        () =>
          windowEvents('c122-cs-a').some(each => each.event === 'activated'),
        120_000,
      );
      await connectedTo('c122-cs-a', 'harness');
      await inWindow('c122-cs-a', 'workbench.view.remote');
      await titleAction('c122-cs-a', VIEW, REFRESH);
      await foldersSettled(
        'c122-cs-a',
        'harness',
        [other, acted],
        `${HOME}/c122-cs-`,
      );
      const before = windowNames();
      await rowAction('c122-cs-a', VIEW, 'c122-cs-a', CURRENT);
      await foldersSettled(
        'c122-cs-a',
        'harness',
        [other, acted],
        `${HOME}/c122-cs-`,
      );
      deepStrictEqual(
        [
          windowNames().filter(name => !before.includes(name)),
          await notifications('c122-cs-a'),
          (await windowState('c122-cs-a')).remoteAuthority,
          ((await historyOf(driver)).harness ?? [])
            .map(entry => entry.path)
            .filter(each => each.startsWith(`${HOME}/c122-cs-`)),
        ],
        [[], [], 'ssh-remote+harness', [other, acted]],
      );
    } finally {
      await closeIfOpen('c122-cs-a');
      await closeIfOpen(window);
    }
  });

  it('F-5104 AC-12 (c122-ws-current): a current-window connect on a workspace row opens the workspace', async function () {
    this.timeout(600_000);
    const window = await viewWindowIn('c122-wsc-view');
    const folder = `${HOME}/c122-wsc`;
    const target = `${folder}/y.code-workspace`;
    try {
      await onHost('mkdir', '-p', folder);
      await onHost(
        'bash',
        '-c',
        `printf '%s' '{"folders":[{"path":"${folder}"}]}' > '${target}'`,
      );
      await recordVisit('harness', target, 'c122-wsc');
      await titleAction(window, VIEW, REFRESH);
      await foldersSettled(window, 'harness', [target], folder);
      await rowAction(window, VIEW, 'y (Workspace)', CURRENT);
      await waitFor(
        `window c122-wsc to stand on the workspace`,
        async () =>
          windowNames().includes('c122-wsc') &&
          (await windowState('c122-wsc')).remoteAuthority ===
            'ssh-remote+harness',
        120_000,
      );
      const state = await windowState('c122-wsc');
      deepStrictEqual(
        [
          await windowTitle('c122-wsc'),
          state.workspaceFile,
          state.remoteAuthority,
        ],
        ['y (Workspace) [SSH: harness]', target, 'ssh-remote+harness'],
      );
    } finally {
      await closeIfOpen('c122-wsc');
      await closeIfOpen(window);
    }
  });

  it('F-5104 AC-14 (c122-sort-change): a changed sort order keeps standing until the next Refresh, then follows the new value in both directions', async function () {
    this.timeout(600_000);
    const saved = readUserSettings();
    const window = await viewWindowIn('c122-sort-change');
    const first = `${HOME}/c122-sc-alpha`;
    const second = `${HOME}/c122-sc-bravo`;
    try {
      await recordVisit('harness', first, 'c122-sc-alpha');
      await recordVisit('harness', second, 'c122-sc-bravo');
      await titleAction(window, VIEW, REFRESH);
      await foldersSettled(
        window,
        'harness',
        [second, first],
        `${HOME}/c122-sc-`,
      );
      async function orderOf(): Promise<string[]> {
        return (await folderRowsOf(window, 'harness'))
          .map(entry => entry.description)
          .filter(each => each.startsWith(`${HOME}/c122-sc-`));
      }
      const before = await orderOf();
      await userSettings({'remote-explorer.foldersSortOrder': 'alphabetical'});
      const unchanged = await orderOf();
      await titleAction(window, VIEW, REFRESH);
      await foldersSettled(
        window,
        'harness',
        [first, second],
        `${HOME}/c122-sc-`,
      );
      const alphabetical = await orderOf();
      await userSettings({
        'remote-explorer.foldersSortOrder': 'most recently used',
      });
      await titleAction(window, VIEW, REFRESH);
      await foldersSettled(
        window,
        'harness',
        [second, first],
        `${HOME}/c122-sc-`,
      );
      const back = await orderOf();
      deepStrictEqual(
        [before, unchanged, alphabetical, back],
        [
          [second, first],
          [second, first],
          [first, second],
          [second, first],
        ],
      );
    } finally {
      restoreUserSettings(saved);
      await closeIfOpen(window);
    }
  });

  it('F-5104 AC-15 (c122-sort-invalid): a mis-cased value, a folder-setting value and the legacy key all keep the most-recently-used order', async function () {
    this.timeout(600_000);
    const saved = readUserSettings();
    const window = await viewWindowIn('c122-sort-invalid');
    const folder = path.join(
      variable('HARNESS_RUN_FOLDER'),
      'explorer-folders',
      'c122-sort-invalid',
    );
    const first = `${HOME}/c122-si-alpha`;
    const second = `${HOME}/c122-si-bravo`;
    try {
      mkdirSync(path.join(folder, '.vscode'), {recursive: true});
      writeFileSync(
        path.join(folder, '.vscode', 'settings.json'),
        '{"remote-explorer.foldersSortOrder": "alphabetical"}',
      );
      await recordVisit('harness', first, 'c122-si-alpha');
      await recordVisit('harness', second, 'c122-si-bravo');
      async function orderOf(): Promise<string[]> {
        return (await folderRowsOf(window, 'harness'))
          .map(entry => entry.description)
          .filter(each => each.startsWith(`${HOME}/c122-si-`));
      }
      // The window started on the folder with the folder-setting value: the rows stand in the most-recently-used order.
      await titleAction(window, VIEW, REFRESH);
      await foldersSettled(
        window,
        'harness',
        [second, first],
        `${HOME}/c122-si-`,
      );
      const fromFolderSetting = await orderOf();
      await userSettings({
        'remote-explorer.foldersSortOrder': 'Alphabetical',
      });
      await titleAction(window, VIEW, REFRESH);
      await foldersSettled(
        window,
        'harness',
        [second, first],
        `${HOME}/c122-si-`,
      );
      const fromMisCased = await orderOf();
      await userSettings({
        'remote-explorer.foldersSortOrder': undefined,
        'remote.SSH.foldersSortOrder': 'alphabetical',
      });
      await titleAction(window, VIEW, REFRESH);
      await foldersSettled(
        window,
        'harness',
        [second, first],
        `${HOME}/c122-si-`,
      );
      const fromLegacyKey = await orderOf();
      deepStrictEqual(
        [fromFolderSetting, fromMisCased, fromLegacyKey],
        [
          [second, first],
          [second, first],
          [second, first],
        ],
      );
    } finally {
      restoreUserSettings(saved);
      await closeIfOpen(window);
    }
  });

  it('F-5104 AC-17 (c122-collapse-refresh): with collapse on, a Refresh keeps the history hosts as they stand and makes the bare hosts collapsed, and back again', async function () {
    this.timeout(600_000);
    const saved = readUserSettings();
    const window = await viewWindowIn('c122-collapse-refresh');
    const target = `${HOME}/c122-cfr-a`;
    try {
      await recordVisit('harness', target, 'c122-cfr-a');
      await titleAction(window, VIEW, REFRESH);
      await foldersSettled(window, 'harness', [target], `${HOME}/c122-cfr-`);
      const atStart = [
        await hostExpanded(window, 'harness'),
        await hostExpanded(window, 'refused'),
      ];
      await userSettings({'remote-explorer.collapseRecentFolders': true});
      await titleAction(window, VIEW, REFRESH);
      await waitFor(
        `the collapsed start of refused in window ${window}`,
        async () =>
          (await hostExpanded(window, 'refused')) === false &&
          (await hostExpanded(window, 'harness')) === true,
        30_000,
      );
      const collapseOn = [
        await hostExpanded(window, 'harness'),
        await hostExpanded(window, 'refused'),
      ];
      await toggleRow(window, VIEW, 'harness');
      await userSettings({'remote-explorer.collapseRecentFolders': false});
      await titleAction(window, VIEW, REFRESH);
      await waitFor(
        `the leaf start of refused and the kept collapse of harness in window ${window}`,
        async () =>
          (await hostExpanded(window, 'refused')) === undefined &&
          (await hostExpanded(window, 'harness')) === false,
        30_000,
      );
      const collapseOff = [
        await hostExpanded(window, 'harness'),
        await hostExpanded(window, 'refused'),
      ];
      deepStrictEqual(
        [atStart, collapseOn, collapseOff],
        [
          [true, undefined],
          [true, false],
          [false, undefined],
        ],
      );
    } finally {
      restoreUserSettings(saved);
      await closeIfOpen(window);
    }
  });

  it('F-5104 AC-18 (c122-collapse-restart): a manual expansion keeps standing through a Refresh and is back to the default after a window restart', async function () {
    this.timeout(600_000);
    const saved = readUserSettings();
    let window = await viewWindowIn('c122-collapse-restart');
    const target = `${HOME}/c122-cpr-a`;
    try {
      await recordVisit('harness', target, 'c122-cpr-a');
      await titleAction(window, VIEW, REFRESH);
      await foldersSettled(window, 'harness', [target], `${HOME}/c122-cpr-`);
      await toggleRow(window, VIEW, 'harness');
      await waitFor(
        `the manual collapse of harness in window ${window}`,
        async () => (await hostExpanded(window, 'harness')) === false,
        30_000,
      );
      await titleAction(window, VIEW, REFRESH);
      await waitFor(
        `harness to keep its manual collapse in window ${window}`,
        async () => (await hostExpanded(window, 'harness')) === false,
        30_000,
      );
      const keptByRefresh = await hostExpanded(window, 'harness');
      await closeWindow(window);
      window = await viewWindowIn('c122-collapse-restart');
      await titleAction(window, VIEW, REFRESH);
      await waitFor(
        `harness to stand expanded again in window ${window}`,
        async () => (await hostExpanded(window, 'harness')) === true,
        30_000,
      );
      const afterRestart = await hostExpanded(window, 'harness');
      await userSettings({'remote-explorer.collapseRecentFolders': true});
      await titleAction(window, VIEW, REFRESH);
      await waitFor(
        `refused to stand collapsed in window ${window}`,
        async () => (await hostExpanded(window, 'refused')) === false,
        30_000,
      );
      await toggleRow(window, VIEW, 'refused');
      await waitFor(
        `the manual expansion of refused in window ${window}`,
        async () => (await hostExpanded(window, 'refused')) === true,
        30_000,
      );
      await titleAction(window, VIEW, REFRESH);
      await waitFor(
        `refused to keep its manual expansion in window ${window}`,
        async () => (await hostExpanded(window, 'refused')) === true,
        30_000,
      );
      const keptExpanded = await hostExpanded(window, 'refused');
      await closeWindow(window);
      window = await viewWindowIn('c122-collapse-restart');
      await waitFor(
        `refused to stand collapsed again in window ${window}`,
        async () => (await hostExpanded(window, 'refused')) === false,
        30_000,
      );
      const afterSecondRestart = await hostExpanded(window, 'refused');
      deepStrictEqual(
        [keptByRefresh, afterRestart, keptExpanded, afterSecondRestart],
        [false, true, true, false],
      );
    } finally {
      restoreUserSettings(saved);
      await closeIfOpen(window);
    }
  });
});
