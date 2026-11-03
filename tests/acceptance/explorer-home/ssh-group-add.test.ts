/**
 * @fileoverview What "New Remote" does when the companion's flow is completed (card coverage-102, #1809, part 2): the
 * input, the file pick and the file the flow writes are the real ones, in the run's own HOME, and the SSH group shows
 * the host without Refresh.
 */

import {deepStrictEqual} from 'node:assert';
import {existsSync, readFileSync, rmSync} from 'node:fs';
import path from 'node:path';
import {
  pickShown,
  sshFile,
  sshFolder,
  systemHosts,
  viewWindow,
} from '../windows/explorer-home.ts';
import {hostLabels, listing, VIEW} from '../windows/explorer-rows.ts';
import {
  closeWindow,
  companionCalls,
  startInWindow,
  readUserSettings,
  restoreUserSettings,
  userSettings,
  waitFor,
  windowNames,
} from '../windows/harness.ts';
import {
  answerDialog,
  answerInputBox,
  chooseQuickPickRow,
  paletteRows,
  editorTabs,
  rowAction,
  rowMenuAction,
  viewRows,
  waitForDialog,
} from '../windows/renderer.ts';

const PLUS = 'New Remote';
const GEAR = 'Open SSH Config File';
const GROUP = 'SSH';

/** The companion's push that tells the explorer the hosts changed, and how long after the host is written it has. */
const HOSTS_CHANGED = 'remote-internal.sshHostsChanged';
const PUSH_MILLISECONDS = 1_000;

/** How long the group has, after the flow's file is chosen, to show the host without Refresh. */
const SHOWN_WITHIN_MILLISECONDS = 2_000;

/** The user file's path, as the flow's pick labels it. */
function userFile(): string {
  return path.join(sshFolder(), 'config');
}

/** Waits until the SSH row is drawn: a group with no host has no listing to wait for. */
async function groupShown(window: string): Promise<void> {
  await waitFor(
    `window ${window} to draw the ${GROUP} row`,
    async () =>
      ((await viewRows(window, VIEW)) ?? []).some(each => each.label === GROUP),
    30_000,
  );
}

/** Runs the flow from the plus of the SSH row: types `command`, chooses the file labelled `file`. The time the choice was made. */
async function newRemote(
  window: string,
  command: string,
  file: string,
): Promise<number> {
  await rowAction(window, VIEW, GROUP, PLUS);
  await pickShown(window);
  await answerInputBox(window, command);
  await pickShown(window);
  const chosen = Date.now();
  await chooseQuickPickRow(window, file);
  return chosen;
}

/** The labels of the rows under the SSH row, in order, once they are `hosts` and for no longer than `milliseconds` after `since`. */
async function listedWithin(
  window: string,
  hosts: readonly string[],
  since: number,
  milliseconds: number,
): Promise<number> {
  await waitFor(
    `window ${window} to list ${hosts.join(', ')}`,
    async () =>
      JSON.stringify(await hostLabels(window)) === JSON.stringify(hosts),
    milliseconds,
  );
  return Date.now() - since;
}

describe('"New Remote" completed through the companion (card coverage-102, part 2)', function () {
  this.timeout(240_000);
  let savedSettings: string | undefined;

  beforeEach(async () => {
    savedSettings = readUserSettings();
    rmSync(sshFolder(), {recursive: true, force: true});
    await userSettings({'remote.SSH.configFile': ''});
  });

  afterEach(() => {
    restoreUserSettings(savedSettings);
    rmSync(sshFolder(), {recursive: true, force: true});
  });

  it('F-5102 AC-13, F-5902 AC-29 (first-child): (reading-1809-receiver-record) a host added before the first existing entry is the first child of the expanded SSH row within 2 seconds, with no Refresh and the others in order, after one host-list push within 1 s of the write', async () => {
    sshFile('config', ['Host alpha', 'Host beta']);
    const window = await viewWindow('add-first');
    try {
      await listing(window, ['alpha', 'beta', ...systemHosts()]);
      const pushed = companionCalls(HOSTS_CHANGED).length;
      const chosen = await newRemote(window, 'ssh newone', userFile());
      const took = await listedWithin(
        window,
        ['newone', 'alpha', 'beta', ...systemHosts()],
        chosen,
        10_000,
      );
      const pushes = companionCalls(HOSTS_CHANGED).slice(pushed);
      deepStrictEqual(
        [
          took <= SHOWN_WITHIN_MILLISECONDS,
          (await viewRows(window, VIEW))?.find(each => each.label === GROUP)
            ?.expanded,
          pushes.length,
          (pushes[0]?.time ?? Infinity) - chosen <= PUSH_MILLISECONDS,
        ],
        [true, true, 1, true],
      );
    } finally {
      await closeWindow(window);
    }
  });

  it('F-5102 AC-16 (missing-config-file): into a configFile that does not exist, the file is created with the entry and its row appears with no Refresh, and the hosts of the home file are still not listed', async () => {
    sshFile('config', ['Host home-only']);
    const missing = path.join(sshFolder(), 'made-by-flow.conf');
    await userSettings({'remote.SSH.configFile': missing});
    const window = await viewWindow('add-missing');
    try {
      await groupShown(window);
      await rowAction(window, VIEW, GROUP, PLUS);
      await pickShown(window);
      await answerInputBox(window, 'ssh madehost');
      await pickShown(window);
      await chooseQuickPickRow(window, missing);
      await listing(window, ['madehost']);
      deepStrictEqual(
        [
          existsSync(missing),
          readFileSync(missing, 'utf8').includes('madehost'),
        ],
        [true, true],
      );
    } finally {
      await closeWindow(window);
    }
  });

  it('F-5102 AC-18 (no-user-file): picking a user file that does not exist in the gear changes nothing in the list, and completing New Remote into it shows its row first', async () => {
    const window = await viewWindow('add-no-user-file');
    try {
      await listing(window, systemHosts());
      await rowAction(window, VIEW, GROUP, GEAR);
      await pickShown(window);
      await chooseQuickPickRow(window, userFile());
      await new Promise(resolve => setTimeout(resolve, 3_000));
      const afterPick = await hostLabels(window);
      await newRemote(window, 'ssh firstone', userFile());
      await listing(window, ['firstone', ...systemHosts()]);
      deepStrictEqual(afterPick, systemHosts());
    } finally {
      await startInWindow(window, 'workbench.action.closeAllEditors');
      const unsaved = await waitForDialog(window);
      await answerDialog(
        window,
        unsaved.buttons.find(each => each.startsWith('Don')) ?? "Don't Save",
      );
      await closeWindow(window);
    }
  });

  it('F-5102 AC-37 (ssh-alone): the input "ssh" alone writes no file and adds no row', async () => {
    const window = await viewWindow('add-ssh-alone');
    try {
      await listing(window, systemHosts());
      await rowAction(window, VIEW, GROUP, PLUS);
      await pickShown(window);
      await answerInputBox(window, 'ssh');
      await new Promise(resolve => setTimeout(resolve, 3_000));
      deepStrictEqual(
        [existsSync(userFile()), await hostLabels(window)],
        [false, systemHosts()],
      );
    } finally {
      await closeWindow(window);
    }
  });

  it('F-5102 AC-46 (after-include): into a file that begins with a comment, an Include and a blank line, followed by a Match, the new alias is the first child, the included host is still listed, and the entry stands after the Include and before the Match', async () => {
    sshFile('inc.conf', ['Host inc-listed']);
    const file = sshFile('config', [
      '# my hosts',
      'Include inc.conf',
      '',
      'Match host first-match',
      '  User someone',
      'Host later-one',
    ]);
    const window = await viewWindow('add-after-include');
    try {
      await listing(window, [
        'inc-listed',
        'first-match',
        'later-one',
        ...systemHosts(),
      ]).catch(() => undefined);
      const before = await hostLabels(window);
      await newRemote(window, 'ssh placed', file);
      await listedWithin(window, ['placed', ...before], Date.now(), 10_000);
      const text = readFileSync(file, 'utf8');
      deepStrictEqual(
        [
          text.indexOf('Include inc.conf') < text.indexOf('Host placed'),
          text.indexOf('Host placed') < text.indexOf('Match host first-match'),
          before.includes('inc-listed'),
        ],
        [true, true, true],
      );
    } finally {
      await closeWindow(window);
    }
  });

  it('F-5102 AC-36 (unparsable-file): New Remote into a file that does not parse leaves the file as it was, adds no row, opens and closes no window and keeps the window usable', async () => {
    const file = sshFile('config', ['Host "never closed']);
    const before = readFileSync(file, 'utf8');
    const window = await viewWindow('add-unparsable');
    try {
      await groupShown(window);
      const rows = await hostLabels(window);
      const windows = windowNames();
      await newRemote(window, 'ssh valid-one', file);
      await new Promise(resolve => setTimeout(resolve, 4_000));
      deepStrictEqual(
        [
          readFileSync(file, 'utf8'),
          await hostLabels(window),
          windowNames(),
          (await paletteRows(window, 'Focus on Remotes')).length > 0,
        ],
        [before, rows, windows, true],
      );
    } finally {
      await closeWindow(window);
    }
  });

  it('F-5102 AC-15 (menu-outcomes): through the context-menu entries the file pick opens the chosen file as a tab, and a completed New Remote writes the file and shows its row first, as through the buttons', async () => {
    const file = sshFile('config', ['Host alpha']);
    const window = await viewWindow('add-menu');
    try {
      await listing(window, ['alpha', ...systemHosts()]);
      await rowMenuAction(window, VIEW, GROUP, GEAR);
      await pickShown(window);
      await chooseQuickPickRow(window, file);
      await waitFor(
        `window ${window} to open the file`,
        async () =>
          (await editorTabs(window)).some(entry => entry.label === 'config'),
        30_000,
      );
      await rowMenuAction(window, VIEW, GROUP, PLUS);
      await pickShown(window);
      await answerInputBox(window, 'ssh menuone');
      await pickShown(window);
      await chooseQuickPickRow(window, file);
      await listedWithin(
        window,
        ['menuone', 'alpha', ...systemHosts()],
        Date.now(),
        10_000,
      );
      deepStrictEqual(
        [
          (await editorTabs(window)).filter(entry => entry.label === 'config')
            .length,
          readFileSync(file, 'utf8').includes('Host menuone'),
        ],
        [1, true],
      );
    } finally {
      await startInWindow(window, 'workbench.action.closeAllEditors');
      await closeWindow(window);
    }
  });
});
