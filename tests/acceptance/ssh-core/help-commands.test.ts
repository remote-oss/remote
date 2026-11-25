import {deepStrictEqual} from 'node:assert';
import {existsSync, mkdirSync, readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {
  appendScript,
  closeContained,
  closeWindow,
  connectedWithin,
  extensionActive,
  extensionPresent,
  inWindow,
  nextEmptyWindow,
  openWindow,
  recordLines,
  startInWindow,
  variable,
  waitFor,
  windowEvents,
  windowState,
} from '../windows/harness.ts';
import {indicatorGroups} from '../windows/activation-support.ts';
import {closeAllButLocal} from '../windows/maintenance.ts';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {activateWindowWithin, activeWindowNameOf} from '../windows/display.ts';
import {paletteItems, runFromPalette} from '../windows/palette.ts';
import {
  dialogOf,
  focusWindow,
  type FocusReads,
  notifications,
  outputChannelOf,
  pageText,
  pressEscape,
  statusBarText,
} from '../windows/renderer.ts';

/** The commands of the four help entries, as the extension registers them. */
const HELP_COMMANDS = {
  help: 'opensshremotes.getHelp',
  getStarted: 'opensshremotes.getStarted',
  settings: 'opensshremotes.settings',
  feedback: 'opensshremotes.provideFeedback',
} as const;

/** The `@ext:` filter of "Remote-SSH: Settings": the extension and its two pack companions, in pack order. */
const SETTINGS_FILTER =
  '@ext:remote-oss.remote-ssh,remote-oss.remote-ssh-edit,remote-oss.remote-explorer';

/** What the extension holds in the window's storage folder, by name. */
function storageOf(): string[] {
  return readdirSync(
    path.join(variable('HARNESS_USER_DATA'), 'User', 'globalStorage'),
  )
    .filter(name => name !== 'state.vscdb-journal')
    .sort();
}

/** What the editor holds in the user's settings file: its text, or `none` when the file is not there. */
function userSettingsText(): string {
  const file = path.join(
    variable('HARNESS_USER_DATA'),
    'User',
    'settings.json',
  );
  return existsSync(file) ? readFileSync(file, 'utf8') : 'none';
}

/** Waits `milliseconds`, for what a window does after a command that nothing tells the end of. */
async function settle(milliseconds: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, milliseconds));
}

/** The failing new window's entries: the dialog, then the pick of actions, both dismissed. */
function failureEntries(window: string) {
  return [
    {
      surface: 'failureDialog',
      match: 'Could not establish connection',
      answer: 'dismiss',
      window,
    },
    {
      surface: 'mitigationPick',
      match: 'Pick an action',
      answer: 'dismiss',
      window,
    },
  ] as const;
}

describe('the help commands of Remote - SSH (card #2486)', function () {
  this.timeout(600_000);

  before(async () => {
    // One renderer call to the run's `local` window, so that an empty window opened later is not ambiguous with it.
    await statusBarText('local', 'status.host').catch(() => '');
  });

  it('F-2004 AC-1 (c2486-listed-part): in an empty and a local folder window, the palette lists Help and Settings', async () => {
    await closeAllButLocal();
    const empty = await nextEmptyWindow(() =>
      inWindow('local', 'workbench.action.newWindow'),
    );
    const runDir = path.join(variable('HARNESS_RUN_FOLDER'), 'c2486-listed');
    mkdirSync(runDir, {recursive: true});
    const folder = await openFolderWindow(runDir);
    try {
      const [emptyItems, folderItems] = [
        await paletteItems(empty, 'Remote-SSH:'),
        await paletteItems(folder, 'Remote-SSH:'),
      ];
      deepStrictEqual(
        [
          emptyItems.includes('Remote-SSH: Help'),
          emptyItems.includes('Remote-SSH: Settings'),
          folderItems.includes('Remote-SSH: Help'),
          folderItems.includes('Remote-SSH: Settings'),
        ],
        [true, true, true, true],
      );
    } finally {
      await closeWindow(empty);
      await closeWindow(folder);
    }
  });

  it('F-2004 AC-2 (c2486-local): in an empty and a local folder window, Get Started is listed and Provide Feedback is not', async () => {
    await closeAllButLocal();
    const empty = await nextEmptyWindow(() =>
      inWindow('local', 'workbench.action.newWindow'),
    );
    const runDir = path.join(variable('HARNESS_RUN_FOLDER'), 'c2486-local');
    mkdirSync(runDir, {recursive: true});
    const folder = await openFolderWindow(runDir);
    try {
      const [emptyItems, folderItems] = [
        await paletteItems(empty, 'Remote-SSH:'),
        await paletteItems(folder, 'Remote-SSH:'),
      ];
      deepStrictEqual(
        [
          emptyItems.includes('Remote-SSH: Get Started with SSH'),
          emptyItems.includes('Remote-SSH: Provide Feedback'),
          folderItems.includes('Remote-SSH: Get Started with SSH'),
          folderItems.includes('Remote-SSH: Provide Feedback'),
        ],
        [true, false, true, false],
      );
    } finally {
      await closeWindow(empty);
      await closeWindow(folder);
    }
  });

  it('F-2004 AC-3 (c2486-connected): in a connected SSH window, Provide Feedback is listed and Get Started is not', async () => {
    const window = 'c2486-connected';
    await openWindow('harness', window);
    await connectedWithin(window, 120_000);
    const items = await paletteItems(window, 'Remote-SSH:');
    deepStrictEqual(
      [
        items.includes('Remote-SSH: Provide Feedback'),
        items.includes('Remote-SSH: Get Started with SSH'),
      ],
      [true, false],
    );
  });

  it('F-2004 AC-4 (c2486-disconnected): in a disconnected SSH window, both Get Started and Provide Feedback are listed', async () => {
    appendScript(failureEntries('c2486-down'));
    await openWindow('refused', 'c2486-down');
    await waitFor(
      'the dismissed failure',
      () => recordLines('mitigationPick', 'c2486-down').length > 0,
      120_000,
    );
    const items = await paletteItems('c2486-down', 'Remote-SSH:');
    deepStrictEqual(
      [
        items.includes('Remote-SSH: Get Started with SSH'),
        items.includes('Remote-SSH: Provide Feedback'),
        items.includes('Remote-SSH: Help'),
        items.includes('Remote-SSH: Settings'),
      ],
      [true, true, true, true],
    );
  });

  it('F-2004 AC-5 (c2486-help-part): Help shows no notification, dialog, quick pick or editor in any window', async () => {
    await closeAllButLocal();
    const empty = await nextEmptyWindow(() =>
      inWindow('local', 'workbench.action.newWindow'),
    );
    try {
      await runFromPalette(empty, 'Remote-SSH: Help');
      await settle(3_000);
      deepStrictEqual(
        [
          (await notifications(empty)).length,
          (await dialogOf(empty)) === undefined,
        ],
        [0, true],
      );
    } finally {
      await closeWindow(empty);
    }
  });

  it('F-2004 AC-6 (c2486-getstarted-part): Get Started opens no walkthrough or editor', async () => {
    const runDir = path.join(
      variable('HARNESS_RUN_FOLDER'),
      'c2486-getstarted',
    );
    mkdirSync(runDir, {recursive: true});
    const folder = await openFolderWindow(runDir);
    try {
      await settle(2_000);
      await inWindow(folder, 'acceptance.agent.state');
      const before = await windowState(folder);
      await runFromPalette(folder, 'Remote-SSH: Get Started with SSH');
      await settle(3_000);
      await inWindow(folder, 'acceptance.agent.state');
      const after = await windowState(folder);
      deepStrictEqual(
        [
          JSON.stringify(after.activeTab) === JSON.stringify(before.activeTab),
          !after.activeTab?.uri.startsWith('walkthrough:'),
        ],
        [true, true],
        `the tab before was ${JSON.stringify(before.activeTab)}, after ${JSON.stringify(
          after.activeTab,
        )}; the page now reads ${JSON.stringify((await pageText(folder)).slice(0, 400))}`,
      );
    } finally {
      await closeWindow(folder);
    }
  });

  it('F-2004 AC-7 (c2486-feedback-part): Provide Feedback shows nothing on screen in an SSH window', async () => {
    const window = 'c2486-feedback';
    await openWindow('harness', window);
    await connectedWithin(window, 120_000);
    await runFromPalette(window, 'Remote-SSH: Provide Feedback');
    await settle(3_000);
    deepStrictEqual(
      [
        (await notifications(window)).length,
        (await dialogOf(window)) === undefined,
      ],
      [0, true],
    );
  });

  it('F-2004 AC-9 (c2486-settings-filter-part): in a local folder window, Settings opens the extension and companion filter', async () => {
    const runDir = path.join(variable('HARNESS_RUN_FOLDER'), 'c2486-filter');
    mkdirSync(runDir, {recursive: true});
    const folder = await openFolderWindow(runDir);
    try {
      await inWindow(folder, HELP_COMMANDS.settings);
      await waitFor(
        'the settings filter',
        async () => (await pageText(folder)).includes(SETTINGS_FILTER),
        30_000,
      );
      deepStrictEqual((await pageText(folder)).includes(SETTINGS_FILTER), true);
    } finally {
      await closeWindow(folder);
    }
  });

  it('F-2004 AC-11 (c2486-settings-reuse-part): a Settings editor with another query is reused, its query replaced by the filter', async () => {
    const runDir = path.join(variable('HARNESS_RUN_FOLDER'), 'c2486-reuse');
    mkdirSync(runDir, {recursive: true});
    const folder = await openFolderWindow(runDir);
    try {
      await inWindow(
        folder,
        'workbench.action.openSettings',
        'editor.fontSize',
      );
      await waitFor(
        'the first query',
        async () => (await pageText(folder)).includes('editor.fontSize'),
        30_000,
      );
      await inWindow(folder, HELP_COMMANDS.settings);
      await waitFor(
        'the replaced query',
        async () => (await pageText(folder)).includes(SETTINGS_FILTER),
        30_000,
      );
      const text = await pageText(folder);
      deepStrictEqual(
        [text.includes(SETTINGS_FILTER), text.includes('editor.fontSize')],
        [true, false],
      );
    } finally {
      await closeWindow(folder);
    }
  });

  it('F-2004 AC-12 (c2486-no-companion): with no Remote Explorer companion, the filter still names all three ids and the settings found are only those of the extension', async () => {
    const runDir = path.join(variable('HARNESS_RUN_FOLDER'), 'c2486-companion');
    mkdirSync(runDir, {recursive: true});
    const folder = await openFolderWindow(runDir);
    try {
      // The launch installs no Remote Explorer companion; the row asserts the given with the then.
      const companion = await extensionPresent(
        folder,
        'remote-oss.remote-explorer',
      );
      await inWindow(folder, HELP_COMMANDS.settings);
      await waitFor(
        'the settings filter',
        async () => (await pageText(folder)).includes(SETTINGS_FILTER),
        30_000,
      );
      const text = await pageText(folder);
      // The results render the setting's label (its key's last segment, spaced) rather than its key, so the row reads
      // the label once the editor is in front; the label is not in the search box, so it can only be in the results.
      deepStrictEqual(
        [
          !companion,
          text.includes(SETTINGS_FILTER),
          text.includes('Connect Timeout'),
          text.includes('Remote Explorer'),
        ],
        [true, true, true, false],
        `the page held: ${JSON.stringify(text)}`,
      );
    } finally {
      await closeWindow(folder);
    }
  });

  it('F-2004 AC-16 (c2486-keybinding-part): the palette-hidden invocations write no setting or file and leave the window usable', async () => {
    const runDir = path.join(
      variable('HARNESS_RUN_FOLDER'),
      'c2486-keybinding',
    );
    mkdirSync(runDir, {recursive: true});
    const folder = await openFolderWindow(runDir);
    try {
      const settingsBefore = userSettingsText();
      const storageBefore = storageOf();
      await inWindow(folder, 'acceptance.agent.state');
      const state = await windowState(folder);
      // The manifest holds no keybinding, so the command is invoked directly, as the keybinding would invoke it.
      await startInWindow(folder, HELP_COMMANDS.feedback);
      await settle(3_000);
      deepStrictEqual(
        [
          userSettingsText() === settingsBefore,
          storageOf().join('\n') === storageBefore.join('\n'),
          state.remoteName === null && state.remoteAuthority === null,
          (await dialogOf(folder)) === undefined,
          (await notifications(folder)).length === 0,
        ],
        [true, true, true, true, true],
      );
    } finally {
      // The command's external open never settles in the run's editor, so the agent is busy and the close ends its host.
      await closeContained(folder, pressEscape, 30_000);
    }
  });

  it('F-2004 AC-17 (c2486-settings-disconnected): in a disconnected SSH window, Settings leaves the window usable and shows no message of the extension', async () => {
    const window = 'c2486-down-settings';
    appendScript(failureEntries(window));
    try {
      await openWindow('refused', window);
      await waitFor(
        'the dismissed failure',
        () => recordLines('mitigationPick', window).length > 0,
        120_000,
      );
      // What the window shows before the command, read first: the refused connect's own toasts and dialog,
      // which the criterion accepts (core's editor error).
      const toastsBefore = await notifications(window);
      const dialogBefore = await dialogOf(window);
      await inWindow(window, HELP_COMMANDS.settings);
      await settle(3_000);
      const items = await paletteItems(window, 'Remote-SSH:');
      // The command may add nothing: no toast it did not already show, the dialog it showed before (or none),
      // and the four commands still listed (6.1 step 1); core's own entries may join them.
      deepStrictEqual(
        [
          (await notifications(window)).every(toast =>
            toastsBefore.includes(toast),
          ),
          JSON.stringify(await dialogOf(window)) ===
            JSON.stringify(dialogBefore),
          [
            'Remote-SSH: Help',
            'Remote-SSH: Settings',
            'Remote-SSH: Get Started with SSH',
            'Remote-SSH: Provide Feedback',
          ].every(command => items.includes(command)),
        ],
        [true, true, true],
        `the toasts before: ${JSON.stringify(toastsBefore)}, the toasts after: ${JSON.stringify(await notifications(window))}, the palette found: ${JSON.stringify(items)}`,
      );
    } finally {
      await closeWindow(window).catch(() => undefined);
    }
  });

  it('F-2004 AC-19 (c2486-first-help-part): a first Help run activates the extension and reveals no output panel', async () => {
    await closeAllButLocal();
    const empty = await nextEmptyWindow(() =>
      inWindow('local', 'workbench.action.newWindow'),
    );
    try {
      await runFromPalette(empty, 'Remote-SSH: Help');
      await waitFor(
        'the activation',
        async () => await extensionActive(empty, 'remote-oss.remote-ssh'),
        30_000,
      );
      await inWindow(empty, 'acceptance.agent.state');
      const lastState = windowEvents(empty)
        .filter(each => each.event === 'state')
        .at(-1);
      deepStrictEqual(
        [
          await extensionActive(empty, 'remote-oss.remote-ssh'),
          await outputChannelOf(empty),
          lastState?.visibleOutputChannel ?? null,
        ],
        [true, undefined, null],
        `the panel shows: ${JSON.stringify(await outputChannelOf(empty))}, the toasts: ${JSON.stringify(await notifications(empty))}`,
      );
    } finally {
      await closeWindow(empty);
    }
  });

  it('F-2004 AC-21 (c2486-no-writes-part): each of the four commands writes nothing to settings, state or the global-storage folder', async () => {
    const settingsBefore = userSettingsText();
    const storageBefore = storageOf();
    for (const [name, command] of [
      ['c2486-no-writes-help', HELP_COMMANDS.help],
      ['c2486-no-writes-getstarted', HELP_COMMANDS.getStarted],
      ['c2486-no-writes-settings', HELP_COMMANDS.settings],
      ['c2486-no-writes-feedback', HELP_COMMANDS.feedback],
    ] as const) {
      const runDir = path.join(variable('HARNESS_RUN_FOLDER'), name);
      mkdirSync(runDir, {recursive: true});
      const window = await openFolderWindow(runDir);
      try {
        // A URL command's open never settles in the run's editor, so it starts and is left; the settings editor answers.
        if (command === HELP_COMMANDS.settings) {
          await inWindow(window, command);
        } else {
          await startInWindow(window, command);
        }
        await settle(3_000);
      } finally {
        await closeContained(window, pressEscape, 30_000);
      }
    }
    deepStrictEqual(
      [
        userSettingsText() === settingsBefore,
        storageOf().join('\n') === storageBefore.join('\n'),
      ],
      [true, true],
    );
  });

  it('F-2004 AC-23 (c2486-indicator-part): the remote indicator menu of a local folder window holds no help, documentation or feedback entry', async () => {
    const runDir = path.join(variable('HARNESS_RUN_FOLDER'), 'c2486-indicator');
    mkdirSync(runDir, {recursive: true});
    const folder = await openFolderWindow(runDir);
    try {
      const rows = await indicatorGroups(folder);
      deepStrictEqual(
        rows
          .map(entry => entry.label.toLowerCase())
          .filter(label =>
            /help|documentation|feedback|get started/i.test(label),
          ),
        [],
      );
    } finally {
      await closeWindow(folder);
    }
  });

  it('F-2004 AC-25 (c2486-companion-less-part): with no companion, the help commands run with no notification', async () => {
    const runDir = path.join(
      variable('HARNESS_RUN_FOLDER'),
      'c2486-companion-less',
    );
    mkdirSync(runDir, {recursive: true});
    const folder = await openFolderWindow(runDir);
    try {
      // The launch installs no Remote Explorer companion; the row asserts the given with the then.
      const companion = await extensionPresent(
        folder,
        'remote-oss.remote-explorer',
      );
      await focusWindow(folder);
      await runFromPalette(folder, 'Remote-SSH: Help');
      await runFromPalette(folder, 'Remote-SSH: Get Started with SSH');
      // The command the palette hides: invoked as the window's own command, whose open never settles in the run's editor.
      await startInWindow(folder, HELP_COMMANDS.feedback);
      await settle(3_000);
      deepStrictEqual(
        [!companion, (await notifications(folder)).length === 0],
        [true, true],
      );
    } finally {
      await closeContained(folder, pressEscape, 30_000);
    }
  });

  it('card #3010 (c3010-focus-readout): a hanging driver stub times out and names the active window', async () => {
    // A driver whose `--sync` activation never settles: the display holds one window for the name, and its active window has a name, so the readout has something to name on every side.
    const activeName = 'the active window';
    const windowId = '98765';
    async function driver(...words: string[]): Promise<string> {
      if (words[0] === 'windowactivate') {
        await new Promise<string>(() => undefined);
        return '';
      }
      if (words[0] === 'search') {
        return windowId;
      }
      if (words[0] === 'getactivewindow') {
        return activeName;
      }
      return '';
    }
    const reads: FocusReads = {
      activate: name => activateWindowWithin(name, driver, 100),
      pageHasFocus: () => Promise.resolve(false),
      activeWindowName: () => activeWindowNameOf(driver),
    };
    let caught: unknown;
    try {
      await focusWindow('a window', reads, 1_000);
    } catch (error) {
      caught = error;
    }
    deepStrictEqual(
      [
        caught instanceof Error,
        caught instanceof Error &&
          caught.message.includes(`window ${windowId}`),
        caught instanceof Error && caught.message.includes('not confirmed'),
        caught instanceof Error && caught.message.includes(activeName),
      ],
      [true, true, true, true],
    );
  });
});
