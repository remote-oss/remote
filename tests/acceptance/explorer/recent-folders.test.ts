/**
 * @fileoverview The recent folders under a target: the rows the view builds from Remote - SSH's folder history, their
 * order and look, and its remove action (card coverage-122, F-5104). The file runs after the gate rows, so the
 * launch's local window is an SSH one; every row opens the windows it needs from the reloaded one.
 */

import {deepStrictEqual} from 'node:assert';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {
  closeWindow,
  inWindow,
  isOpen,
  moveFocusAway,
  onHost,
  readUserSettings,
  recordLines,
  relaunch,
  startInWindow,
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
  clickDialogButton,
  clickRowLabel,
  chooseSettingOption,
  hoverRow,
  notifications,
  pressControlAltF,
  pressEnter,
  pressEscape,
  pressShiftArrow,
  pressSpace,
  quickPickFacts,
  quickPickRows,
  rowAction,
  rowContextMenu,
  rowContextMenuByKey,
  rowDetails,
  rowMenuAction,
  rowTooltip,
  selectedRows,
  shownRowActionTitles,
  settingsItems,
  titleAction,
  toggleRow,
  viewRows,
  waitForDialog,
  windowTitle,
} from '../windows/renderer.ts';
import {VIEW} from '../windows/explorer-rows.ts';
import {
  bindKeys,
  connectedTo,
  folderRowsOf,
  foldersSettled,
  HOME,
  historyOf,
} from '../windows/explorer-folders.ts';
import {stateKeyNames} from '../windows/global-state.ts';
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
    // closeWindow resolves once the window is gone, so the visit stands on its close.
    await closeWindow(windowName);
  }

  /** Closes the window `name` when it is open: a window a row reloaded away, or never made, is not. */
  async function closeIfOpen(name: string): Promise<void> {
    if (isOpen(name)) {
      await closeWindow(name, 120_000);
    }
  }

  /**
   * Seeds the SSH companion's folder history with `hosts`, the whole history: the relaunch restarts the launch's
   * editor and writes it between the stop and the start, so the earlier rows' entries are wiped, and reopens the
   * window on its folder. The view is shown in the window again. The relaunch stops the launch's whole editor, so the
   * driver is the new start's own window, which the relaunch names in its answer, or the rows after this one send
   * their commands to a dead window.
   */
  async function seedHistory(
    window: string,
    hosts: ReadonlyArray<{
      hostKey: string;
      entries: ReadonlyArray<{path: string; kind: 'folder' | 'workspace'}>;
    }>,
  ): Promise<void> {
    const own = await relaunch(window, {
      environment: {},
      globalState: {
        extension: 'remote-oss.remote-ssh',
        entries: {'folder.history.v1': {hosts}},
      },
    });
    const before = driver;
    driver = own;
    console.log(
      `the launch's own window stands after the relaunch: ${driver} (it was ${before})`,
    );
    await inWindow(driver, 'acceptance.agent.activeEditorText');
    await inWindow(window, 'workbench.view.remote');
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
      const openBefore = windowNames().filter(isOpen);
      await rowAction(window, VIEW, 'c122-current-a', CURRENT);
      await waitFor(
        `window c122-current-a to stand on ssh-remote+harness`,
        async () =>
          (await windowState('c122-current-a')).remoteAuthority ===
          'ssh-remote+harness',
        120_000,
      );
      deepStrictEqual(
        [
          openBefore.includes(window),
          isOpen(window),
          windowNames().filter(
            name => isOpen(name) && !openBefore.includes(name),
          ),
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
      const openBefore = windowNames().filter(isOpen);
      await rowAction(window, VIEW, 'c122-newwin-a', IN_NEW);
      await waitFor(
        `window c122-newwin-a to stand on ssh-remote+harness`,
        async () =>
          (await windowState('c122-newwin-a')).remoteAuthority ===
          'ssh-remote+harness',
        120_000,
      );
      deepStrictEqual(
        [
          windowNames().filter(
            name => isOpen(name) && !openBefore.includes(name),
          ),
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
      await onHost('mkdir', '-p', path.posix.dirname(acted));
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
      await recordVisit('harness', other, 'c122-cs-b');
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
        [
          '[y (Workspace) [SSH: harness]]SSH: harness',
          `vscode-remote://ssh-remote%2Bharness${target}`,
          'ssh-remote+harness',
        ],
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

  it('F-5104 AC-22 (c122-core-recent): the view remove leaves File Open Recent unchanged, and the core clear leaves the view rows unchanged', async function () {
    this.timeout(600_000);
    const window = await viewWindowIn('c122-core');
    const target = `${HOME}/c122-core-a`;
    try {
      await recordVisit('harness', target, 'c122-core-a');
      await titleAction(window, VIEW, REFRESH);
      await foldersSettled(window, 'harness', [target], `${HOME}/c122-core-`);
      async function holds(): Promise<boolean> {
        return (await quickPickRows(window)).some(
          each =>
            each.label.includes('c122-core-a') ||
            each.description.includes(target),
        );
      }
      await startInWindow(window, 'workbench.action.openRecent');
      await waitFor(
        `the recent list of window ${window} to hold the visited folder`,
        holds,
        15_000,
      );
      const recentBefore = await holds();
      await pressEscape(window);
      await waitFor(
        `the recent quick pick of window ${window} to close`,
        async () => (await quickPickFacts(window)) === undefined,
        15_000,
      );
      await rowMenuAction(window, VIEW, 'c122-core-a', REMOVE);
      await foldersSettled(window, 'harness', [], `${HOME}/c122-core-`);
      await startInWindow(window, 'workbench.action.openRecent');
      await waitFor(
        `the recent list of window ${window} to keep the removed folder`,
        holds,
        15_000,
      );
      const recentAfterRemove = await holds();
      await pressEscape(window);
      await waitFor(
        `the recent quick pick of window ${window} to close`,
        async () => (await quickPickFacts(window)) === undefined,
        15_000,
      );
      const beforeClear = (await folderRowsOf(window, 'harness')).map(
        each => each.description,
      );
      await inWindow(window, 'workbench.action.clearRecentFiles');
      await clickDialogButton(window, 'Clear');
      await titleAction(window, VIEW, REFRESH);
      const afterClear = (await folderRowsOf(window, 'harness')).map(
        each => each.description,
      );
      deepStrictEqual(
        [recentBefore, recentAfterRemove, beforeClear, afterClear],
        [true, true, beforeClear, beforeClear],
      );
    } finally {
      await closeWindow(window);
    }
  });

  it('F-5104 AC-23 (c122-remove-reconnect): a removed row stays gone on Refresh and comes back when its window reloads and reconnects', async function () {
    this.timeout(600_000);
    const view = await viewWindowIn('c122-rer');
    const opened = 'c122-rer-a';
    const target = `${HOME}/c122-rer-a`;
    try {
      await onHost('mkdir', '-p', path.posix.dirname(target));
      await inWindow(
        driver,
        'acceptance.agent.openWindow',
        `vscode-remote://ssh-remote+harness${target}`,
      );
      await waitFor(
        `window ${opened} to activate its agent`,
        () => windowEvents(opened).some(each => each.event === 'activated'),
        120_000,
      );
      await connectedTo(opened, 'harness');
      await titleAction(view, VIEW, REFRESH);
      await foldersSettled(view, 'harness', [target], `${HOME}/c122-rer-`);
      await rowMenuAction(view, VIEW, 'c122-rer-a', REMOVE);
      await foldersSettled(view, 'harness', [], `${HOME}/c122-rer-`);
      await titleAction(view, VIEW, REFRESH);
      await foldersSettled(view, 'harness', [], `${HOME}/c122-rer-`);
      const afterRemove =
        (await historyOf(driver)).harness?.filter(entry =>
          entry.path.startsWith(`${HOME}/c122-rer-`),
        ) ?? [];
      try {
        await inWindow(opened, 'workbench.action.reloadWindow');
      } catch (error) {
        console.log(
          `window ${opened} answered the reload with ${String(error)}: its last events are ` +
            `${JSON.stringify(windowEvents(opened).slice(-15))}, its state is ` +
            `${JSON.stringify(await windowState(opened).catch(() => 'unreachable'))}, ` +
            `its open pick is ${JSON.stringify(await quickPickFacts(opened).catch(() => 'unreachable'))}, ` +
            `its notifications are ${JSON.stringify(await notifications(opened).catch(() => 'unreachable'))}`,
        );
        throw error;
      }
      await waitFor(
        `window ${opened} to reconnect after its reload`,
        async () => {
          try {
            return (
              (await windowState(opened)).remoteAuthority ===
              'ssh-remote+harness'
            );
          } catch {
            return false;
          }
        },
        180_000,
      );
      await waitFor(
        `the history of harness to hold the reconnected folder`,
        async () =>
          (await historyOf(driver)).harness?.some(
            entry => entry.path === target,
          ) ?? false,
        120_000,
      );
      const afterReload =
        (await historyOf(driver)).harness?.filter(entry =>
          entry.path.startsWith(`${HOME}/c122-rer-`),
        ) ?? [];
      deepStrictEqual(
        [afterRemove, afterReload],
        [[], [{path: target, kind: 'folder'}]],
      );
    } finally {
      await closeIfOpen(opened);
      await closeWindow(view);
    }
  });

  it('F-5104 AC-24 (c122-two-windows): a folder opened or removed in one window reaches the other only on its Refresh or restart', async function () {
    this.timeout(600_000);
    const first = await viewWindowIn('c122-tw-1');
    const second = await viewWindowIn('c122-tw-2');
    const target = `${HOME}/c122-tw-a`;
    try {
      await recordVisit('harness', target, 'c122-tw-a');
      await titleAction(first, VIEW, REFRESH);
      await foldersSettled(first, 'harness', [target], `${HOME}/c122-tw-`);
      const firstHas = (await folderRowsOf(first, 'harness')).some(
        each => each.description === target,
      );
      const secondNotYet = (await folderRowsOf(second, 'harness')).some(
        each => each.description === target,
      );
      await titleAction(second, VIEW, REFRESH);
      const secondAfterRefresh = (await folderRowsOf(second, 'harness')).some(
        each => each.description === target,
      );
      await rowMenuAction(first, VIEW, 'c122-tw-a', REMOVE);
      await foldersSettled(first, 'harness', [], `${HOME}/c122-tw-`);
      const secondStillThere = (await folderRowsOf(second, 'harness')).some(
        each => each.description === target,
      );
      await closeWindow(second);
      const restarted = await viewWindowIn('c122-tw-2');
      try {
        await waitFor(
          `the hosts of window ${restarted} to stand at their start`,
          async () => {
            const rows = (await viewRows(restarted, VIEW)) ?? [];
            return rows.some(
              entry => entry.level === 2 && entry.label === 'harness',
            );
          },
          30_000,
        );
        const restartedGone = (await folderRowsOf(restarted, 'harness')).some(
          each => each.description === target,
        );
        deepStrictEqual(
          [
            firstHas,
            secondNotYet,
            secondAfterRefresh,
            secondStillThere,
            restartedGone,
          ],
          [true, false, true, true, false],
        );
      } finally {
        await closeWindow(restarted);
      }
    } finally {
      await closeIfOpen(second);
      await closeWindow(first);
    }
  });

  it('F-5104 AC-25 (c122-keys): Enter and Space on a focused folder row run nothing, open no window and change no history', async function () {
    this.timeout(600_000);
    const window = await viewWindowIn('c122-keys');
    const target = `${HOME}/c122-keys-a`;
    try {
      await recordVisit('harness', target, 'c122-keys-a');
      await titleAction(window, VIEW, REFRESH);
      await foldersSettled(window, 'harness', [target], `${HOME}/c122-keys-`);
      await clickRowLabel(window, VIEW, 'c122-keys-a');
      const windowsBefore = windowNames();
      const historyBefore = await historyOf(driver);
      const settingsBefore = readUserSettings();
      await pressEnter(window);
      await pressSpace(window);
      deepStrictEqual(
        [
          windowNames(),
          await historyOf(driver),
          readUserSettings(),
          await notifications(window),
          await quickPickFacts(window),
        ],
        [windowsBefore, historyBefore, settingsBefore, [], undefined],
      );
    } finally {
      await closeWindow(window);
    }
  });

  it('F-5104 AC-33 (c122-keybindings): the bound connect and remove keys run nothing from the editor, a host row or a folder row', async function () {
    this.timeout(600_000);
    const window = await viewWindowIn('c122-kbd');
    const target = `${HOME}/c122-kbd-a`;
    const unbind = await bindKeys([
      {
        key: 'ctrl+alt+f1',
        command: 'remote-explorer.connectToFolderInCurrentWindow',
      },
      {
        key: 'ctrl+alt+f2',
        command: 'remote-explorer.connectToFolderInNewWindow',
      },
      {key: 'ctrl+alt+f3', command: 'remote-explorer.deleteFolderHistoryItem'},
    ]);
    try {
      await recordVisit('harness', target, 'c122-kbd-a');
      await titleAction(window, VIEW, REFRESH);
      await foldersSettled(window, 'harness', [target], `${HOME}/c122-kbd-`);
      const windowsBefore = windowNames();
      const historyBefore = await historyOf(driver);
      const settingsBefore = readUserSettings();
      const configBefore = readFileSync(variable('HARNESS_SSH_CONFIG'));
      const stateBefore = await windowState(window);
      async function press(
        keyNumber: number,
        focus: (name: string) => Promise<void>,
      ): Promise<void> {
        await focus(window);
        await pressControlAltF(window, keyNumber);
        await new Promise(resolve => setTimeout(resolve, 2_000));
      }
      for (const keyNumber of [1, 2, 3]) {
        await press(keyNumber, async name => {
          await moveFocusAway(name);
        });
        await press(keyNumber, async name => {
          // The label click that focuses the host row also toggles it (VS Code core tree [oss]): the twistie opens
          // it again, so the key press and the folder-row click after stand on the host as it stood before.
          await clickRowLabel(name, VIEW, 'harness');
          await toggleRow(name, VIEW, 'harness');
        });
        await press(keyNumber, async name => {
          await clickRowLabel(name, VIEW, 'c122-kbd-a');
        });
      }
      const stateAfter = await windowState(window);
      deepStrictEqual(
        [
          windowNames(),
          await historyOf(driver),
          readUserSettings(),
          readFileSync(variable('HARNESS_SSH_CONFIG')),
          [stateAfter.remoteAuthority, stateAfter.folders],
          await notifications(window),
          ((await viewRows(window, VIEW)) ?? []).length > 0,
        ],
        [
          windowsBefore,
          historyBefore,
          settingsBefore,
          configBefore,
          [stateBefore.remoteAuthority, stateBefore.folders],
          [],
          true,
        ],
      );
    } finally {
      unbind();
      await closeWindow(window);
    }
  });

  it('F-5104 AC-35 (c122-settings-editor): the two settings show the exact texts with the all-profiles mark, and the dropdown writes the user file', async function () {
    this.timeout(600_000);
    const window = await viewWindowIn('c122-set');
    const saved = readUserSettings();
    try {
      await inWindow(
        window,
        'workbench.action.openSettings',
        '@ext:remote-oss',
      );
      try {
        await waitFor(
          `the two settings of the extension in the editor of window ${window}`,
          async () => (await settingsItems(window)).length === 2,
          30_000,
        );
      } catch (error) {
        console.log(
          `the settings editor of window ${window} stood at ` +
            `${JSON.stringify(await settingsItems(window).catch(() => 'unreadable'))} ` +
            `under the title ${JSON.stringify(await windowTitle(window).catch(() => 'unreadable'))}`,
        );
        throw error;
      }
      const items = await settingsItems(window);
      const sort = items.find(each =>
        each.title.includes('Folders Sort Order'),
      );
      const collapse = items.find(each =>
        each.title.includes('Collapse Recent Folders'),
      );
      await chooseSettingOption(window, 'alphabetical');
      await waitFor(
        `the user settings to hold the chosen sort order`,
        () =>
          (readUserSettings() ?? '').includes(
            '"remote-explorer.foldersSortOrder": "alphabetical"',
          ),
        15_000,
      );
      const written = (readUserSettings() ?? '').includes(
        '"remote-explorer.foldersSortOrder": "alphabetical"',
      );
      deepStrictEqual(
        [
          sort?.title,
          sort?.description,
          collapse?.title,
          collapse?.description,
          (sort?.control ?? []).includes('most recently used'),
          (sort?.control ?? []).includes('alphabetical'),
          (sort?.control ?? []).includes(
            'Display folders in order of the most recently opened at the top',
          ),
          written,
        ],
        [
          'Remote-explorer: Folders Sort Order (Applies to all profiles)',
          'Specifies the order in which to display folders under Remote targets in the Remote Explorer.',
          'Remote-explorer: Collapse Recent Folders (Applies to all profiles)',
          'Collapse the recent folders under Remote targets in the Remote Explorer.',
          true,
          true,
          true,
          true,
        ],
      );
    } finally {
      restoreUserSettings(saved);
      await closeWindow(window);
    }
  });

  it('F-5104 AC-36 (c122-no-own-state): a connect and a remove write no state of the extension and show no notice of its own', async function () {
    this.timeout(600_000);
    const window = await viewWindowIn('c122-state');
    const target = `${HOME}/c122-state-a`;
    const saved = readUserSettings();
    try {
      await recordVisit('harness', target, 'c122-state-a');
      await titleAction(window, VIEW, REFRESH);
      await foldersSettled(window, 'harness', [target], `${HOME}/c122-state-`);
      await rowAction(window, VIEW, 'c122-state-a', IN_NEW);
      await waitFor(
        `window c122-state-a to stand on ssh-remote+harness`,
        async () =>
          windowNames().includes('c122-state-a') &&
          (await windowState('c122-state-a')).remoteAuthority ===
            'ssh-remote+harness',
        120_000,
      );
      await rowMenuAction(window, VIEW, 'c122-state-a', REMOVE);
      await foldersSettled(window, 'harness', [], `${HOME}/c122-state-`);
      deepStrictEqual(
        [
          existsSync(
            path.join(
              variable('HARNESS_USER_DATA'),
              'User',
              'globalStorage',
              'remote-oss.remote-explorer',
            ),
          ),
          await stateKeyNames('remote-oss.remote-explorer'),
          readUserSettings(),
          await notifications(window),
          await notifications('c122-state-a'),
        ],
        [false, [], saved, [], []],
      );
    } finally {
      await closeIfOpen('c122-state-a');
      await closeWindow(window);
    }
  });

  it('F-5104 AC-37 (c122-ws-newwin): a new-window connect on a workspace row opens one window on the workspace and the acting window stays as it was', async function () {
    this.timeout(600_000);
    const window = await viewWindowIn('c122-wn-view');
    const folder = `${HOME}/c122-wn`;
    const target = `${folder}/z.code-workspace`;
    const opened = 'c122-wn';
    try {
      await onHost('mkdir', '-p', folder);
      await onHost(
        'bash',
        '-c',
        `printf '%s' '{"folders":[{"path":"${folder}"}]}' > '${target}'`,
      );
      await recordVisit('harness', target, opened);
      await titleAction(window, VIEW, REFRESH);
      await foldersSettled(window, 'harness', [target], folder);
      const openBefore = windowNames().filter(isOpen);
      const actingBefore = await windowState(window);
      await rowAction(window, VIEW, 'z (Workspace)', IN_NEW);
      await waitFor(
        `window ${opened} to stand on the workspace`,
        async () =>
          (await windowState(opened)).remoteAuthority === 'ssh-remote+harness',
        120_000,
      );
      deepStrictEqual(
        [
          windowNames().filter(
            name => isOpen(name) && !openBefore.includes(name),
          ),
          await windowTitle(opened),
          (await windowState(opened)).workspaceFile,
          [
            (await windowState(window)).remoteAuthority,
            (await windowState(window)).folders,
          ],
          await notifications(window),
        ],
        [
          [opened],
          '[z (Workspace) [SSH: harness]]SSH: harness',
          `vscode-remote://ssh-remote%2Bharness${target}`,
          [actingBefore.remoteAuthority, actingBefore.folders],
          [],
        ],
      );
    } finally {
      await closeIfOpen(opened);
      await closeWindow(window);
    }
  });

  it('F-5104 AC-38 (c122-stale-connect): a connect on a row removed in another window opens the folder and records it again at the front', async function () {
    this.timeout(600_000);
    const first = await viewWindowIn('c122-stc-1');
    const second = await viewWindowIn('c122-stc-2');
    const opened = 'c122-stc-a';
    const target = `${HOME}/c122-stc-a`;
    try {
      await recordVisit('harness', target, opened);
      await titleAction(first, VIEW, REFRESH);
      await titleAction(second, VIEW, REFRESH);
      await foldersSettled(first, 'harness', [target], `${HOME}/c122-stc-`);
      await foldersSettled(second, 'harness', [target], `${HOME}/c122-stc-`);
      await rowMenuAction(second, VIEW, 'c122-stc-a', REMOVE);
      await foldersSettled(second, 'harness', [], `${HOME}/c122-stc-`);
      const openBefore = windowNames().filter(isOpen);
      await rowAction(first, VIEW, 'c122-stc-a', IN_NEW);
      await waitFor(
        `window ${opened} to stand on ssh-remote+harness`,
        async () =>
          (await windowState(opened)).remoteAuthority === 'ssh-remote+harness',
        120_000,
      );
      await waitFor(
        `the history of harness to re-record ${target} at the front`,
        async () =>
          ((await historyOf(driver)).harness ?? [])[0]?.path === target,
        120_000,
      );
      const recorded = (await historyOf(driver)).harness ?? [];
      deepStrictEqual(
        [
          windowNames().filter(
            name => isOpen(name) && !openBefore.includes(name),
          ),
          await notifications(first),
          recorded[0]?.path,
          recorded.filter(entry => entry.path.startsWith(`${HOME}/c122-stc-`))
            .length,
        ],
        [[opened], [], target, 1],
      );
    } finally {
      await closeIfOpen(opened);
      await closeIfOpen(first);
      await closeIfOpen(second);
    }
  });

  it('F-5104 AC-39 (c122-stale-remove): a remove on a row removed in another window disappears at once and touches only that entry', async function () {
    this.timeout(600_000);
    const first = await viewWindowIn('c122-str-1');
    const second = await viewWindowIn('c122-str-2');
    const older = `${HOME}/c122-str-a`;
    const newer = `${HOME}/c122-str-b`;
    try {
      await recordVisit('harness', older, 'c122-str-a');
      await recordVisit('harness', newer, 'c122-str-b');
      await titleAction(first, VIEW, REFRESH);
      await titleAction(second, VIEW, REFRESH);
      await foldersSettled(
        first,
        'harness',
        [newer, older],
        `${HOME}/c122-str-`,
      );
      await foldersSettled(
        second,
        'harness',
        [newer, older],
        `${HOME}/c122-str-`,
      );
      await rowMenuAction(second, VIEW, 'c122-str-b', REMOVE);
      await foldersSettled(second, 'harness', [older], `${HOME}/c122-str-`);
      await rowMenuAction(first, VIEW, 'c122-str-b', REMOVE);
      await foldersSettled(first, 'harness', [older], `${HOME}/c122-str-`);
      deepStrictEqual(
        [
          (await folderRowsOf(first, 'harness'))
            .filter(each => each.description.startsWith(`${HOME}/c122-str-`))
            .map(each => each.description),
          await notifications(first),
          (await historyOf(driver)).harness
            ?.map(entry => entry.path)
            .filter(each => each.startsWith(`${HOME}/c122-str-`)) ?? [],
        ],
        [[older], [], [older]],
      );
    } finally {
      await closeIfOpen(first);
      await closeIfOpen(second);
    }
  });

  it('F-5104 AC-40 (c122-nomulti): the Shift arrows keep the single selection and the remove that follows acts on one row only', async function () {
    this.timeout(600_000);
    const window = await viewWindowIn('c122-nm');
    const older = `${HOME}/c122-nm-a`;
    const newer = `${HOME}/c122-nm-b`;
    try {
      await recordVisit('harness', older, 'c122-nm-a');
      await recordVisit('harness', newer, 'c122-nm-b');
      await titleAction(window, VIEW, REFRESH);
      await foldersSettled(
        window,
        'harness',
        [newer, older],
        `${HOME}/c122-nm-`,
      );
      await clickRowLabel(window, VIEW, 'c122-nm-b');
      const focusedBefore = await selectedRows(window, VIEW);
      await pressShiftArrow(window, 'ArrowDown');
      await pressShiftArrow(window, 'ArrowUp');
      const selectionAfter = await selectedRows(window, VIEW);
      await rowMenuAction(window, VIEW, 'c122-nm-b', REMOVE);
      await foldersSettled(window, 'harness', [older], `${HOME}/c122-nm-`);
      deepStrictEqual(
        [
          focusedBefore,
          selectionAfter,
          (await historyOf(driver)).harness
            ?.map(entry => entry.path)
            .filter(each => each.startsWith(`${HOME}/c122-nm-`)) ?? [],
        ],
        [['c122-nm-b'], ['c122-nm-b'], [older]],
      );
    } finally {
      await closeWindow(window);
    }
  });

  it('F-5104 AC-41 (c122-aria): the accessible name of a folder row is its tooltip with has actions appended', async () => {
    const window = await viewWindowIn('c122-aria');
    const target = `${HOME}/c122-aria-a`;
    try {
      await recordVisit('harness', target, 'c122-aria-a');
      await titleAction(window, VIEW, REFRESH);
      await foldersSettled(window, 'harness', [target], `${HOME}/c122-aria-`);
      const detail = ((await rowDetails(window, VIEW)) ?? []).find(
        each => each.label === 'c122-aria-a',
      );
      deepStrictEqual(detail?.ariaLabel, `'${target}' on harness, has actions`);
    } finally {
      await closeWindow(window);
    }
  });

  it('F-5104 AC-42 (c122-empty-ssh): an empty SSH window on the host adds no folder row and no history entry', async function () {
    this.timeout(600_000);
    const window = await viewWindowIn('c122-es');
    const target = `${HOME}/c122-es-a`;
    let empty = '';
    try {
      await recordVisit('harness', target, 'c122-es-a');
      await titleAction(window, VIEW, REFRESH);
      await foldersSettled(window, 'harness', [target], `${HOME}/c122-es-`);
      const before = windowNames();
      const historyBefore = await historyOf(driver);
      await inWindow(
        driver,
        'acceptance.agent.openWindow',
        'vscode-remote://ssh-remote+harness',
      );
      await waitFor(
        `an empty window to connect to harness`,
        async () => {
          const name = windowNames().find(each => !before.includes(each));
          if (name === undefined) {
            return false;
          }
          empty = name;
          try {
            return (
              (await windowState(name)).remoteAuthority === 'ssh-remote+harness'
            );
          } catch {
            return false;
          }
        },
        120_000,
      );
      await inWindow(empty, 'workbench.view.remote');
      await titleAction(empty, VIEW, REFRESH);
      await foldersSettled(empty, 'harness', [target], `${HOME}/c122-es-`);
      deepStrictEqual(
        [
          (await folderRowsOf(empty, 'harness')).map(each => each.description),
          await historyOf(driver),
          windowNames().filter(name => !before.includes(name)),
        ],
        [[target], historyBefore, [empty]],
      );
    } finally {
      await closeIfOpen(empty);
      await closeWindow(window);
    }
  });

  it('F-5104 AC-43 (c122-cfs): the collapse value set only in a folder setting leaves the hosts at their default at the window start', async () => {
    const window = 'c122-cfs';
    const target = `${HOME}/c122-cfs-a`;
    const folder = path.join(
      variable('HARNESS_RUN_FOLDER'),
      'explorer-folders',
      'c122-cfs',
    );
    try {
      mkdirSync(path.join(folder, '.vscode'), {recursive: true});
      writeFileSync(
        path.join(folder, '.vscode', 'settings.json'),
        '{"remote-explorer.collapseRecentFolders": true}',
      );
      await recordVisit('harness', target, 'c122-cfs-a');
      await inWindow(
        driver,
        'acceptance.agent.openWindow',
        pathToFileURL(folder).href,
      );
      await waitFor(
        `window ${window} to activate its agent`,
        () => windowEvents(window).some(each => each.event === 'activated'),
        120_000,
      );
      await inWindow(window, 'workbench.view.remote');
      await waitFor(
        `the hosts of window ${window} to stand at their start`,
        async () => {
          const rows = (await viewRows(window, VIEW)) ?? [];
          return (
            rows.some(
              entry => entry.level === 2 && entry.label === 'harness',
            ) &&
            rows.some(entry => entry.level === 2 && entry.label === 'refused')
          );
        },
        30_000,
      );
      const atStart = [
        await hostExpanded(window, 'harness'),
        await hostExpanded(window, 'refused'),
      ];
      deepStrictEqual(atStart, [true, undefined]);
    } finally {
      await closeIfOpen(window);
    }
  });

  it('F-5104 AC-44 (c122-ssh-view): the view in an SSH window lists the same rows as the local one, with the connected look on its host', async function () {
    this.timeout(600_000);
    const window = await viewWindowIn('c122-sv');
    const opened = 'c122-sv-a';
    const target = `${HOME}/c122-sv-a`;
    try {
      await onHost('mkdir', '-p', path.posix.dirname(target));
      await inWindow(
        driver,
        'acceptance.agent.openWindow',
        `vscode-remote://ssh-remote+harness${target}`,
      );
      await waitFor(
        `window ${opened} to activate its agent`,
        () => windowEvents(opened).some(each => each.event === 'activated'),
        120_000,
      );
      await connectedTo(opened, 'harness');
      await titleAction(window, VIEW, REFRESH);
      await inWindow(opened, 'workbench.view.remote');
      await titleAction(opened, VIEW, REFRESH);
      await foldersSettled(window, 'harness', [target], `${HOME}/c122-sv-`);
      await foldersSettled(opened, 'harness', [target], `${HOME}/c122-sv-`);
      async function hostLook(
        name: string,
      ): Promise<[boolean | undefined, string | undefined]> {
        const rows = (await viewRows(name, VIEW)) ?? [];
        const host = rows.find(
          entry => entry.level === 2 && entry.label === 'harness',
        );
        return [host?.expanded, host?.description];
      }
      const localFolders = (await folderRowsOf(window, 'harness')).map(
        each => each.description,
      );
      const sshFolders = (await folderRowsOf(opened, 'harness')).map(
        each => each.description,
      );
      deepStrictEqual(
        [sshFolders, await hostLook(window), await hostLook(opened)],
        [localFolders, [true, ''], [true, 'connected']],
      );
    } finally {
      await closeIfOpen(opened);
      await closeWindow(window);
    }
  });

  it('F-5104 AC-45 (c122-shift-f10): Shift+F10 on a focused folder row opens its context menu with the three entries in order', async () => {
    const window = await viewWindowIn('c122-f10');
    const target = `${HOME}/c122-f10-a`;
    try {
      await recordVisit('harness', target, 'c122-f10-a');
      await titleAction(window, VIEW, REFRESH);
      await foldersSettled(window, 'harness', [target], `${HOME}/c122-f10-`);
      const menu = await rowContextMenuByKey(window, VIEW, 'c122-f10-a');
      deepStrictEqual(menu, [CURRENT, IN_NEW, REMOVE]);
    } finally {
      await closeWindow(window);
    }
  });

  it('F-5104 AC-46 (c122-cross-current): a current-window connect on a folder open in another window changes nothing', async function () {
    this.timeout(600_000);
    const window = await viewWindowIn('c122-xc');
    const opened = 'c122-xc-b';
    const target = `${HOME}/c122-xc-b`;
    const older = `${HOME}/c122-xc-a`;
    try {
      await onHost('mkdir', '-p', path.posix.dirname(target));
      await inWindow(
        driver,
        'acceptance.agent.openWindow',
        `vscode-remote://ssh-remote+harness${target}`,
      );
      await waitFor(
        `window ${opened} to activate its agent`,
        () => windowEvents(opened).some(each => each.event === 'activated'),
        120_000,
      );
      await connectedTo(opened, 'harness');
      await recordVisit('harness', older, 'c122-xc-a');
      await titleAction(window, VIEW, REFRESH);
      await foldersSettled(
        window,
        'harness',
        [older, target],
        `${HOME}/c122-xc-`,
      );
      const before = windowNames();
      const stateBefore = await windowState(window);
      await rowAction(window, VIEW, 'c122-xc-b', CURRENT);
      await new Promise(resolve => setTimeout(resolve, 5_000));
      deepStrictEqual(
        [
          windowNames().filter(name => !before.includes(name)),
          (await windowState(window)).remoteAuthority,
          (await windowState(window)).folders,
          await notifications(window),
          (await historyOf(driver)).harness
            ?.map(entry => entry.path)
            .filter(each => each.startsWith(`${HOME}/c122-xc-`)) ?? [],
        ],
        [
          [],
          stateBefore.remoteAuthority,
          stateBefore.folders,
          [],
          [older, target],
        ],
      );
    } finally {
      await closeIfOpen(opened);
      await closeWindow(window);
    }
  });

  it('F-5104 AC-49 (c122-truthy): the collapse setting takes its truth from the value the user settings hold at the window start', async function () {
    this.timeout(600_000);
    const saved = readUserSettings();
    const target = `${HOME}/c122-tr-a`;
    try {
      await recordVisit('harness', target, 'c122-tr-a');
      async function startWith(
        value: unknown,
        label: string,
      ): Promise<[boolean | undefined, boolean | undefined]> {
        await userSettings({'remote-explorer.collapseRecentFolders': value});
        const window = await viewWindowIn(label);
        try {
          try {
            await waitFor(
              `the hosts of window ${label} to stand at their start`,
              async () => {
                const rows = (await viewRows(window, VIEW)) ?? [];
                return (
                  rows.some(
                    entry => entry.level === 2 && entry.label === 'harness',
                  ) &&
                  rows.some(
                    entry => entry.level === 2 && entry.label === 'refused',
                  )
                );
              },
              30_000,
            );
          } catch (error) {
            console.log(
              `window ${label} stood at ${JSON.stringify(await viewRows(window, VIEW).catch(() => 'unreadable'))} ` +
                `while the setting held ${JSON.stringify(value)}`,
            );
            throw error;
          }
          return [
            await hostExpanded(window, 'harness'),
            await hostExpanded(window, 'refused'),
          ];
        } finally {
          await closeWindow(window);
        }
      }
      deepStrictEqual(
        [
          await startWith('true', 'c122-tr-t1'),
          await startWith(1, 'c122-tr-n1'),
          await startWith('false', 'c122-tr-f1'),
          await startWith(0, 'c122-tr-z0'),
          await startWith('', 'c122-tr-e0'),
        ],
        [
          [false, false],
          [false, false],
          [false, false],
          [true, undefined],
          [true, undefined],
        ],
      );
    } finally {
      restoreUserSettings(saved);
    }
  });

  it('F-5104 AC-20 (c122-dupes): removing one copy of a path listed twice under a host removes every copy under it, and the same path under the other host stays', async function () {
    this.timeout(600_000);
    const window = await viewWindowIn('c122-dupes');
    const dupe = `${HOME}/c122-dupe`;
    try {
      await onHost('mkdir', '-p', dupe);
      await seedHistory(window, [
        {
          hostKey: 'harness',
          entries: [
            {path: dupe, kind: 'folder'},
            {path: dupe, kind: 'folder'},
          ],
        },
        {hostKey: 'jumped', entries: [{path: dupe, kind: 'folder'}]},
      ]);
      await titleAction(window, VIEW, REFRESH);
      await foldersSettled(window, 'harness', [dupe, dupe], `${HOME}/c122-`);
      await foldersSettled(window, 'jumped', [dupe], `${HOME}/c122-`);
      await rowMenuAction(window, VIEW, 'c122-dupe', REMOVE, {
        index: 0,
        count: 3,
      });
      await foldersSettled(window, 'harness', [], `${HOME}/c122-`);
      deepStrictEqual(
        [
          (await folderRowsOf(window, 'harness')).map(each => each.description),
          (await folderRowsOf(window, 'jumped')).map(each => each.description),
          (await historyOf(window)).harness,
          (await historyOf(window)).jumped,
        ],
        [[], [dupe], undefined, [{path: dupe, kind: 'folder'}]],
      );
    } finally {
      await closeWindow(window);
    }
  });

  it('F-5104 AC-28 (c122-missing): a new-window connect on a path that does not exist on the host shows nothing of its own, and the row is the first only after the Refresh', async function () {
    this.timeout(600_000);
    const saved = readUserSettings();
    const window = await viewWindowIn('c122-miss');
    const older = `${HOME}/c122-miss-a`;
    const missing = `${HOME}/c122-miss-b`;
    const opened = 'c122-miss-b';
    try {
      await onHost('mkdir', '-p', older);
      await onHost('bash', '-c', `rm -f '${missing}'`);
      await seedHistory(window, [
        {
          hostKey: 'harness',
          entries: [
            {path: older, kind: 'folder'},
            {path: missing, kind: 'folder'},
          ],
        },
      ]);
      await userSettings({'window.dialogStyle': 'custom'});
      await titleAction(window, VIEW, REFRESH);
      await foldersSettled(
        window,
        'harness',
        [older, missing],
        `${HOME}/c122-`,
      );
      const before = windowNames();
      await rowAction(window, VIEW, 'c122-miss-b', IN_NEW);
      await waitFor(
        `window ${opened} to activate its agent`,
        () => windowEvents(opened).some(each => each.event === 'activated'),
        120_000,
      );
      const dialog = await waitForDialog(opened, 60_000);
      await clickDialogButton(opened, 'Cancel');
      await waitFor(
        `window ${opened} to stand on ssh-remote+harness`,
        async () =>
          windowNames().includes(opened) &&
          (await windowState(opened)).remoteAuthority === 'ssh-remote+harness',
        120_000,
      );
      const rowsBefore = (await folderRowsOf(window, 'harness')).map(
        each => each.description,
      );
      await titleAction(window, VIEW, REFRESH);
      await foldersSettled(
        window,
        'harness',
        [missing, older],
        `${HOME}/c122-`,
      );
      deepStrictEqual(
        [
          windowNames().filter(name => !before.includes(name)),
          dialog.message,
          dialog.buttons,
          await notifications(window),
          rowsBefore,
        ],
        [
          [opened],
          'Workspace does not exist',
          ['Cancel', 'Open Workspace...'],
          [],
          [older, missing],
        ],
      );
    } finally {
      restoreUserSettings(saved);
      await closeIfOpen(opened);
      await closeWindow(window);
    }
  });

  it('F-5104 AC-29 (c122-unreach): a current-window connect on a row under an unreachable host fails the window, keeps the history order, and a reachable row from it recovers', async function () {
    this.timeout(600_000);
    const saved = readUserSettings();
    const window = await viewWindowIn('c122-un');
    const first = `${HOME}/c122-un-a`;
    const second = `${HOME}/c122-un-b`;
    const reachable = `${HOME}/c122-un-c`;
    const failed = 'c122-un-b';
    const recoveredName = 'c122-un-c';
    try {
      await onHost('mkdir', '-p', reachable);
      await seedHistory(window, [
        {
          hostKey: 'nowhere',
          entries: [
            {path: first, kind: 'folder'},
            {path: second, kind: 'folder'},
          ],
        },
        {hostKey: 'harness', entries: [{path: reachable, kind: 'folder'}]},
      ]);
      await userSettings({'window.dialogStyle': 'custom'});
      await titleAction(window, VIEW, REFRESH);
      await foldersSettled(window, 'nowhere', [first, second], `${HOME}/c122-`);
      await foldersSettled(window, 'harness', [reachable], `${HOME}/c122-`);
      await rowAction(window, VIEW, 'c122-un-b', CURRENT);
      await waitFor(
        `window ${failed} to stand`,
        () => windowNames().includes(failed),
        120_000,
      );
      await waitForDialog(failed, 120_000);
      await clickDialogButton(failed, 'Close Remote');
      async function comesLocal(): Promise<string> {
        for (const name of windowNames()) {
          if (name === 'local' || !isOpen(name)) {
            continue;
          }
          const state = await windowState(name).catch(() => undefined);
          if (state?.remoteAuthority === null) {
            return name;
          }
        }
        return '';
      }
      await waitFor(
        `the window ${failed} to come back local`,
        async () => (await comesLocal()) !== '',
        120_000,
      );
      const recovered = await comesLocal();
      await inWindow(recovered, 'workbench.view.remote');
      await titleAction(recovered, VIEW, REFRESH);
      await foldersSettled(recovered, 'harness', [reachable], `${HOME}/c122-`);
      await rowAction(recovered, VIEW, 'c122-un-c', CURRENT);
      await waitFor(
        `window ${recoveredName} to stand on ssh-remote+harness`,
        async () =>
          windowNames().includes(recoveredName) &&
          (await windowState(recoveredName)).remoteAuthority ===
            'ssh-remote+harness',
        120_000,
      );
      deepStrictEqual(
        [
          windowNames().includes(failed),
          await notifications(failed),
          (await historyOf(recoveredName)).nowhere?.map(entry => entry.path) ??
            [],
          (await windowState(recoveredName)).remoteAuthority,
        ],
        [true, [], [first, second], 'ssh-remote+harness'],
      );
    } finally {
      restoreUserSettings(saved);
      await closeIfOpen(recoveredName);
      await closeIfOpen(failed);
      await closeIfOpen(window);
    }
  });

  it('F-5104 AC-47 (c122-case): only the lower-case suffix counts as a workspace file, and a new-window connect on a mis-cased one opens an SSH window with no workspace', async function () {
    this.timeout(600_000);
    const window = await viewWindowIn('c122-case');
    const lower = `${HOME}/c122-case/x.code-workspace`;
    const upper = `${HOME}/c122-case/UP.CODE-WORKSPACE`;
    const mixed = `${HOME}/c122-case/Mixed.Code-Workspace`;
    let opened = '';
    try {
      await onHost(
        'bash',
        '-c',
        [
          `mkdir -p '${HOME}/c122-case'`,
          `printf '' > '${upper}'`,
          `printf '' > '${mixed}'`,
          `rm -f '${lower}'`,
        ].join(' && '),
      );
      await seedHistory(window, [
        {
          hostKey: 'harness',
          entries: [
            {path: lower, kind: 'workspace'},
            {path: upper, kind: 'folder'},
            {path: mixed, kind: 'folder'},
          ],
        },
      ]);
      await titleAction(window, VIEW, REFRESH);
      await foldersSettled(
        window,
        'harness',
        [lower, upper, mixed],
        `${HOME}/c122-`,
      );
      const labels = (await folderRowsOf(window, 'harness')).map(
        each => each.label,
      );
      const before = windowNames();
      await rowAction(window, VIEW, 'UP.CODE-WORKSPACE', IN_NEW);
      await waitFor(
        `the new window of ${window}`,
        () => windowNames().some(name => !before.includes(name)),
        120_000,
      );
      opened = windowNames().find(name => !before.includes(name)) ?? '';
      await waitFor(
        `window ${opened} to stand on ssh-remote+harness`,
        async () =>
          windowNames().includes(opened) &&
          (await windowState(opened)).remoteAuthority === 'ssh-remote+harness',
        120_000,
      );
      deepStrictEqual(
        [
          labels,
          windowNames().filter(name => !before.includes(name)),
          (await windowState(opened)).remoteAuthority,
          (await windowState(opened)).folders.length,
          await windowTitle(opened),
          await notifications(window),
        ],
        [
          ['x (Workspace)', 'UP.CODE-WORKSPACE', 'Mixed.Code-Workspace'],
          [opened],
          'ssh-remote+harness',
          0,
          'Visual Studio Code',
          [],
        ],
      );
    } finally {
      await closeIfOpen(opened);
      await closeIfOpen(window);
    }
  });

  it('F-5104 AC-48 (c122-alphadupes): with the alphabetical order, three copies of one path stand next to each other at its sorted position', async function () {
    this.timeout(600_000);
    const saved = readUserSettings();
    const window = await viewWindowIn('c122-ad');
    const earlier = `${HOME}/c122-ad-a`;
    const triple = `${HOME}/c122-ad-b`;
    try {
      await onHost('mkdir', '-p', earlier);
      await onHost('mkdir', '-p', triple);
      await seedHistory(window, [
        {
          hostKey: 'harness',
          entries: [
            {path: triple, kind: 'folder'},
            {path: triple, kind: 'folder'},
            {path: triple, kind: 'folder'},
            {path: earlier, kind: 'folder'},
          ],
        },
      ]);
      await userSettings({'remote-explorer.foldersSortOrder': 'alphabetical'});
      await titleAction(window, VIEW, REFRESH);
      await foldersSettled(
        window,
        'harness',
        [earlier, triple, triple, triple],
        `${HOME}/c122-`,
      );
      deepStrictEqual(
        (await folderRowsOf(window, 'harness')).map(each => each.label),
        ['c122-ad-a', 'c122-ad-b', 'c122-ad-b', 'c122-ad-b'],
      );
    } finally {
      restoreUserSettings(saved);
      await closeIfOpen(window);
    }
  });
});
