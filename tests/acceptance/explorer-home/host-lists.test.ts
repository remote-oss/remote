/**
 * @fileoverview The host list of the Remotes view against the files in effect (card coverage-102, #1809, part 3f): a
 * file that does not parse, one with no entry, the file that `remote.SSH.configFile` names changing, and what the
 * picker of "Connect to Host..." shows beside the view.
 */

import {deepStrictEqual} from 'node:assert';
import {readFileSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {
  closePick,
  pickShown,
  sshFile,
  sshFolder,
  systemHosts,
  viewWindow,
} from '../windows/explorer-home.ts';
import {bindKeys} from '../windows/explorer-folders.ts';
import {hostLabels, listing, VIEW} from '../windows/explorer-rows.ts';
import {
  closeWindow,
  readUserSettings,
  restoreUserSettings,
  startInWindow,
  userSettings,
  waitFor,
  windowNames,
} from '../windows/harness.ts';
import {
  allQuickPickRows,
  answerInputBox,
  chooseQuickPickRow,
  editorTabs,
  notifications,
  paletteRows,
  pressControlAlt,
  pressEscape,
  quickPickFacts,
  rowAction,
  titleAction,
  viewRows,
} from '../windows/renderer.ts';

const GROUP = 'SSH';
const PLUS = 'New Remote';

/** The command of "Connect to Host..." and the one of "Connect Current Window to Host...". */
const CONNECT = 'opensshremotes.openEmptyWindow';
const CONNECT_CURRENT = 'opensshremotes.openEmptyWindowInCurrentWindow';

/** The text of a file that does not parse. */
const UNPARSABLE = 'Host "never closed';

/** The two entries the picker has of its own. */
const ADD_ENTRY = 'Add New SSH Host...';
const CONFIGURE_ENTRY = 'Configure SSH Hosts...';
const PICKER_ENTRIES = [ADD_ENTRY, CONFIGURE_ENTRY];

/** How long the group has to show a change it follows, and how long a change it does not follow is watched. */
const FOLLOWED_MILLISECONDS = 3_000;
const UNFOLLOWED_MILLISECONDS = 10_000;

/** One row of the picker of Connect to Host: its label, and whether it holds the focus. */
interface PickerRow {
  label: string;
  focused: boolean;
}

/** What the picker of `command` lists in window `window`, once it is shown; the picker is closed again. */
async function pickerOf(window: string, command: string): Promise<PickerRow[]> {
  await startInWindow(window, command);
  await pickShown(window);
  const rows = await allQuickPickRows(window);
  await closePick(window);
  return rows.map(({label, focused}) => ({label: label.trim(), focused}));
}

/** The labels of a picker's rows that name a host, that is, all but the two entries of its own. */
function hostsOf(rows: readonly PickerRow[]): string[] {
  return rows
    .map(entry => entry.label)
    .filter(label => !PICKER_ENTRIES.includes(label));
}

/** Opens `file` through Remote-SSH: Open SSH Configuration File..., picked by its path, and waits for its tab. */
async function openThroughCommand(window: string, file: string): Promise<void> {
  await startInWindow(window, 'opensshremotes.openConfigFile');
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
function listsWithin(
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

describe('the host list against the files in effect (card coverage-102, part 3f)', function () {
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

  it('F-2201 AC-23, AC-32 (unparsable): a file that stops parsing leaves a refresh with no message and no new row, and Connect to Host, Connect Current Window to Host, a key on either and New Remote then open no host picker, write no file and leave the window usable', async () => {
    const file = sshFile('config', ['Host user-one']);
    const window = await viewWindow('hosts-unparsable');
    const restore = await bindKeys([
      {key: 'ctrl+alt+u', command: CONNECT},
      {key: 'ctrl+alt+v', command: CONNECT_CURRENT},
    ]);
    try {
      await listing(window, ['user-one', ...systemHosts()]);
      const listed = await hostLabels(window);
      sshFile('config', [UNPARSABLE]);
      const written = readFileSync(file, 'utf8');
      await titleAction(window, VIEW, 'Refresh');
      await new Promise(resolve => setTimeout(resolve, 3_000));
      const afterRefresh = [
        await notifications(window),
        (await hostLabels(window)).filter(label => !listed.includes(label)),
      ];
      const windows = windowNames();
      const pickers: unknown[] = [];
      for (const attempt of [
        () => startInWindow(window, CONNECT),
        () => startInWindow(window, CONNECT_CURRENT),
        () => pressControlAlt(window, 'u'),
        () => pressControlAlt(window, 'v'),
      ]) {
        await attempt();
        await new Promise(resolve => setTimeout(resolve, 3_000));
        pickers.push((await quickPickFacts(window))?.placeholder);
        await pressEscape(window);
        await new Promise(resolve => setTimeout(resolve, 1_000));
      }
      await rowAction(window, VIEW, GROUP, PLUS);
      await pickShown(window);
      await answerInputBox(window, 'ssh valid-one');
      await pickShown(window);
      await chooseQuickPickRow(window, file);
      await new Promise(resolve => setTimeout(resolve, 3_000));
      pickers.push((await quickPickFacts(window))?.placeholder);
      deepStrictEqual(
        [
          afterRefresh,
          pickers,
          readFileSync(file, 'utf8'),
          windowNames(),
          (await paletteRows(window, 'Focus on Remotes')).length > 0,
        ],
        [
          [[], []],
          [undefined, undefined, undefined, undefined, undefined],
          written,
          windows,
          true,
        ],
      );
    } finally {
      restore();
      await closeWindow(window);
    }
  });
  it('F-2202 AC-33 (no-entry): files that yield no entry give a picker with only Add New SSH Host (focused) and Configure SSH Hosts, and a view with the expanded SSH group, no row and no message', async () => {
    const file = sshFile('config', ['Host *', 'Host *.corp !x']);
    await userSettings({'remote.SSH.configFile': file});
    const window = await viewWindow('hosts-none');
    try {
      await new Promise(resolve => setTimeout(resolve, 5_000));
      const view = await viewRows(window, VIEW);
      deepStrictEqual(
        [view, await notifications(window), await pickerOf(window, CONNECT)],
        [
          [{label: GROUP, description: '', level: 1, expanded: true}],
          [],
          [
            {label: ADD_ENTRY, focused: true},
            {label: CONFIGURE_ENTRY, focused: false},
          ],
        ],
      );
    } finally {
      await closeWindow(window);
    }
  });

  it('F-2202 AC-21 (follows-setting): remote.SSH.configFile set, changed and removed by a write to settings.json, and the named file saved from the tab that Open SSH Configuration File opened, give the group the new list within 3 s with no Refresh', async () => {
    const first = sshFile('config-first', ['Host first-one']);
    const second = sshFile('config-second', ['Host second-one']);
    const window = await viewWindow('hosts-follows');
    try {
      await listing(window, systemHosts());
      const seen: boolean[] = [];
      await userSettings({'remote.SSH.configFile': first});
      seen.push(
        await listsWithin(window, ['first-one'], FOLLOWED_MILLISECONDS),
      );
      await userSettings({'remote.SSH.configFile': second});
      seen.push(
        await listsWithin(window, ['second-one'], FOLLOWED_MILLISECONDS),
      );
      await userSettings({'remote.SSH.configFile': ''});
      seen.push(
        await listsWithin(window, systemHosts(), FOLLOWED_MILLISECONDS),
      );
      await userSettings({'remote.SSH.configFile': second});
      await listsWithin(window, ['second-one'], FOLLOWED_MILLISECONDS);
      await openThroughCommand(window, second);
      await typeAndSave(window, 'Host typed-two\n');
      seen.push(
        await listsWithin(
          window,
          ['typed-two', 'second-one'],
          FOLLOWED_MILLISECONDS,
        ),
      );
      deepStrictEqual(seen, [true, true, true, true]);
    } finally {
      await closeWindow(window);
    }
  });

  it('F-2202 AC-32 (keeps-rows): a change to the named file by another program, and a save from a tab opened through Quick Open, leave the group as it was for 10 s while the picker shows the new list, and Refresh brings it to the group', async () => {
    const file = sshFile('config-named', ['Host named-one']);
    await userSettings({'remote.SSH.configFile': file});
    const window = await viewWindow('hosts-keeps');
    try {
      await listing(window, ['named-one']);
      const steps: unknown[] = [];
      async function step(expected: readonly string[]): Promise<void> {
        await new Promise(resolve =>
          setTimeout(resolve, UNFOLLOWED_MILLISECONDS),
        );
        const kept = await hostLabels(window);
        const picker = hostsOf(await pickerOf(window, CONNECT));
        await titleAction(window, VIEW, 'Refresh');
        steps.push([
          kept,
          picker,
          await listsWithin(window, expected, FOLLOWED_MILLISECONDS),
        ]);
      }
      writeFileSync(file, 'Host named-one\nHost external-one\n');
      await step(['named-one', 'external-one']);
      await new Promise(resolve => setTimeout(resolve, 2_000));
      await startInWindow(window, 'workbench.action.quickOpen');
      await answerInputBox(window, file);
      await waitFor(
        `window ${window} to open ${file}`,
        async () =>
          (await editorTabs(window)).some(
            entry => entry.label === 'config-named',
          ),
        30_000,
      );
      await typeAndSave(window, 'Host quick-one\n');
      await step(['quick-one', 'named-one', 'external-one']);
      deepStrictEqual(steps, [
        [['named-one'], ['named-one', 'external-one'], true],
        [
          ['named-one', 'external-one'],
          ['quick-one', 'named-one', 'external-one'],
          true,
        ],
      ]);
    } finally {
      await closeWindow(window);
    }
  });
  it('F-2204 AC-30 (new-remote-input): the plus of the SSH row opens the input that asks for the ssh command, and nothing is written by opening it', async () => {
    const file = sshFile('config', ['Host user-one']);
    const window = await viewWindow('hosts-input');
    try {
      await listing(window, ['user-one', ...systemHosts()]);
      await rowAction(window, VIEW, GROUP, PLUS);
      const shown = await pickShown(window);
      await closePick(window);
      deepStrictEqual(
        [shown.placeholder, shown.value, readFileSync(file, 'utf8')],
        ['E.g. ssh hello@example.com -A', '', 'Host user-one\n'],
      );
    } finally {
      await closeWindow(window);
    }
  });
});
