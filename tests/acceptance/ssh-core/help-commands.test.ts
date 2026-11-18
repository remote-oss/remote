import {deepStrictEqual} from 'node:assert';
import {existsSync, mkdirSync, readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {
  appendScript,
  closeContained,
  closeWindow,
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
import {paletteItems, runFromPalette} from '../windows/palette.ts';
import {
  dialogOf,
  notifications,
  outputChannelOf,
  pageText,
  pressEscape,
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
    await waitFor(
      'the connection',
      async () => await extensionActive(window, 'remote-oss.remote-ssh'),
      120_000,
    );
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
      await waitFor('the window to settle', () => true, 3_000);
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
      await waitFor('the window to settle', () => true, 2_000);
      await inWindow(folder, 'acceptance.agent.state');
      const before = await windowState(folder);
      await runFromPalette(folder, 'Remote-SSH: Get Started with SSH');
      await waitFor('the window to settle', () => true, 3_000);
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
    await waitFor(
      'the connection',
      async () => await extensionActive(window, 'remote-oss.remote-ssh'),
      120_000,
    );
    await runFromPalette(window, 'Remote-SSH: Provide Feedback');
    await waitFor('the window to settle', () => true, 3_000);
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
      await inWindow(folder, HELP_COMMANDS.settings);
      await waitFor(
        'the settings filter',
        async () => (await pageText(folder)).includes(SETTINGS_FILTER),
        30_000,
      );
      const text = await pageText(folder);
      deepStrictEqual(
        [text.includes(SETTINGS_FILTER), text.includes('Remote Explorer')],
        [true, false],
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
      await waitFor('the window to settle', () => true, 3_000);
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
    appendScript(failureEntries('c2486-down-settings'));
    try {
      await openWindow('refused', 'c2486-down-settings');
      await waitFor(
        'the dismissed failure',
        () => recordLines('mitigationPick', 'c2486-down-settings').length > 0,
        120_000,
      );
      await inWindow('c2486-down-settings', HELP_COMMANDS.settings);
      await waitFor('the window to settle', () => true, 3_000);
      const dialog = await dialogOf('c2486-down-settings');
      const items = await paletteItems('c2486-down-settings', 'Remote-SSH:');
      // The criterion accepts core's editor error, whose toasts name the refused host; the extension's own show none.
      // A window that stays usable still lists the extension's four commands (6.1 step 1); core's own entries may join them.
      deepStrictEqual(
        [
          (await notifications('c2486-down-settings')).filter(
            toast => !toast.startsWith('Setting up SSH Host'),
          ).length === 0,
          !dialog?.message.toLowerCase().includes('remote-ssh'),
          [
            'Remote-SSH: Help',
            'Remote-SSH: Settings',
            'Remote-SSH: Get Started with SSH',
            'Remote-SSH: Provide Feedback',
          ].every(command => items.includes(command)),
        ],
        [true, true, true],
        `the toasts: ${JSON.stringify(await notifications('c2486-down-settings'))}, the palette found: ${JSON.stringify(items)}`,
      );
    } finally {
      await closeWindow('c2486-down-settings').catch(() => undefined);
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
        await waitFor('the window to settle', () => true, 3_000);
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
      'c2486-no-companion',
    );
    mkdirSync(runDir, {recursive: true});
    const folder = await openFolderWindow(runDir);
    try {
      // The launch installs no Remote Explorer companion; the row asserts the given with the then.
      const companion = await extensionPresent(
        folder,
        'remote-oss.remote-explorer',
      );
      await runFromPalette(folder, 'Remote-SSH: Help');
      await runFromPalette(folder, 'Remote-SSH: Get Started with SSH');
      // The command the palette hides: invoked as the window's own command, whose open never settles in the run's editor.
      await startInWindow(folder, HELP_COMMANDS.feedback);
      await waitFor('the window to settle', () => true, 3_000);
      deepStrictEqual(
        [!companion, (await notifications(folder)).length === 0],
        [true, true],
      );
    } finally {
      await closeContained(folder, pressEscape, 30_000);
    }
  });
});
