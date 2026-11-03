/**
 * @fileoverview The SSH configuration file opened through "Open SSH Config File" (card coverage-102, #1809, part 2):
 * it opens as a preview tab and writes nothing; a host added in that editor shows in the group without Refresh, one
 * added by another program only after Refresh; and a file opened another way is read again only on Refresh.
 */

import {deepStrictEqual} from 'node:assert';
import {readFileSync, rmSync, writeFileSync} from 'node:fs';
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
  readUserSettings,
  restoreUserSettings,
  startInWindow,
  userSettings,
  waitFor,
  windowNames,
} from '../windows/harness.ts';
import {
  answerInputBox,
  chooseQuickPickRow,
  editorTabs,
  rowAction,
  titleAction,
  viewRows,
} from '../windows/renderer.ts';

const GEAR = 'Open SSH Config File';
const GROUP = 'SSH';

/** The companion's push that tells the explorer the hosts changed. */
const HOSTS_CHANGED = 'remote-internal.sshHostsChanged';

/** How long after a save the push has to reach the explorer. */
const PUSH_MILLISECONDS = 1_000;

/** How long a save of a file opened another way leaves the list as it was. */
const UNCHANGED_MILLISECONDS = 10_000;

/** How long a host added in the open editor has to show, and how long a change by another program is waited for. */
const EDITOR_SAVE_MILLISECONDS = 5_000;
const OTHER_PROGRAM_MILLISECONDS = 15_000;

/** Opens the user file from the gear of window `window`, and waits until its tab is there. */
async function openFromGear(window: string, file: string): Promise<void> {
  await rowAction(window, VIEW, GROUP, GEAR);
  await pickShown(window);
  await chooseQuickPickRow(window, file);
  await waitFor(
    `window ${window} to open ${file}`,
    async () =>
      (await editorTabs(window)).some(
        entry => entry.label === path.basename(file),
      ),
    30_000,
  );
}

/** Types `text` at the cursor of the active editor of window `window` and saves it. */
async function typeAndSave(window: string, text: string): Promise<void> {
  await startInWindow(window, 'type', {text});
  await startInWindow(window, 'workbench.action.files.save');
}

/** Waits up to `milliseconds` for the group of `window` to list exactly `hosts`; whether it did. */
async function listsWithin(
  window: string,
  hosts: readonly string[],
  milliseconds: number,
): Promise<boolean> {
  return waitFor(
    `window ${window} to list ${hosts.join(', ')}`,
    async () =>
      JSON.stringify(await hostLabels(window)) === JSON.stringify(hosts),
    milliseconds,
  ).then(
    () => true,
    () => false,
  );
}

describe('the configuration file opened from the SSH group (card coverage-102, part 2)', function () {
  this.timeout(300_000);
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

  it('F-5102 AC-11 (preview-tab): picking an existing file opens it as the focused preview tab of the window, opens and closes no window, writes nothing, and leaves the Remote Explorer in the side bar', async () => {
    const file = sshFile('config', ['Host user-one']);
    const window = await viewWindow('edit-preview');
    try {
      await listing(window, ['user-one', ...systemHosts()]);
      const windows = windowNames();
      await openFromGear(window, file);
      deepStrictEqual(
        [
          (await editorTabs(window)).filter(entry => entry.label === 'config'),
          windowNames(),
          readFileSync(file, 'utf8'),
          (await viewRows(window, VIEW)) !== undefined,
        ],
        [
          [{label: 'config', active: true, preview: true, dirty: false}],
          windows,
          'Host user-one\n',
          true,
        ],
      );
    } finally {
      await closeWindow(window);
    }
  });

  it('F-5101 AC-15, F-5102 AC-22, F-5902 AC-9, AC-36 (editor-save): (reading-1809-receiver-record) a host added in the opened editor and saved shows within 5 s with no Refresh, after one host-list push within 1 s of the save; a change by another program shows after 15 s only through Refresh, additions and deletions both', async () => {
    const file = sshFile('config', ['Host user-one']);
    const window = await viewWindow('edit-save');
    try {
      await listing(window, ['user-one', ...systemHosts()]);
      await openFromGear(window, file);
      const pushed = companionCalls(HOSTS_CHANGED).length;
      await typeAndSave(window, 'Host typed-one\n');
      const saved = Date.now();
      const shown = await listsWithin(
        window,
        ['typed-one', 'user-one', ...systemHosts()],
        EDITOR_SAVE_MILLISECONDS,
      );
      const pushes = companionCalls(HOSTS_CHANGED).slice(pushed);
      writeFileSync(file, 'Host typed-one\nHost external-one\n');
      await new Promise(resolve =>
        setTimeout(resolve, OTHER_PROGRAM_MILLISECONDS),
      );
      const unchanged = await hostLabels(window);
      await titleAction(window, VIEW, 'Refresh');
      deepStrictEqual(
        [
          pushes.length,
          (pushes[0]?.time ?? Infinity) - saved <= PUSH_MILLISECONDS,
          shown,
          unchanged,
          await listsWithin(
            window,
            ['typed-one', 'external-one', ...systemHosts()],
            10_000,
          ),
        ],
        [1, true, true, ['typed-one', 'user-one', ...systemHosts()], true],
      );
    } finally {
      await closeWindow(window);
    }
  });

  it('F-5101 AC-15 (named-file): a host added and saved in the file that remote.SSH.configFile names, opened from the gear, shows within 5 s with no Refresh', async () => {
    const file = sshFile('named-config', ['Host user-one']);
    await userSettings({'remote.SSH.configFile': file});
    const window = await viewWindow('edit-named');
    try {
      await waitFor(
        `window ${window} to list user-one`,
        async () => (await hostLabels(window)).includes('user-one'),
        30_000,
      );
      const before = await hostLabels(window);
      await openFromGear(window, file);
      await typeAndSave(window, 'Host typed-named\n');
      deepStrictEqual(
        await listsWithin(
          window,
          ['typed-named', ...before],
          EDITOR_SAVE_MILLISECONDS,
        ),
        true,
      );
    } finally {
      await closeWindow(window);
    }
  });

  it('F-5102 AC-50, F-5902 AC-36 (closed-tab): after the tab was closed, the file opened another way and a host added there leaves the list as it was for 10 s and is listed after Refresh', async () => {
    const file = sshFile('config', ['Host user-one']);
    const window = await viewWindow('edit-closed');
    try {
      await listing(window, ['user-one', ...systemHosts()]);
      await openFromGear(window, file);
      await startInWindow(window, 'workbench.action.closeActiveEditor');
      await startInWindow(window, 'workbench.action.quickOpen');
      await answerInputBox(window, file);
      await waitFor(
        `window ${window} to open ${file} again`,
        async () =>
          (await editorTabs(window)).some(entry => entry.label === 'config'),
        30_000,
      );
      await typeAndSave(window, 'Host later-one\n');
      await new Promise(resolve => setTimeout(resolve, UNCHANGED_MILLISECONDS));
      const unchanged = await hostLabels(window);
      await titleAction(window, VIEW, 'Refresh');
      deepStrictEqual(
        [
          unchanged,
          await listsWithin(
            window,
            ['later-one', 'user-one', ...systemHosts()],
            10_000,
          ),
        ],
        [['user-one', ...systemHosts()], true],
      );
    } finally {
      await closeWindow(window);
    }
  });
});
