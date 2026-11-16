import {deepStrictEqual} from 'node:assert';
import {readdirSync} from 'node:fs';
import path from 'node:path';
import {
  appendScript,
  closeWindow,
  commandsOf,
  connectionLog,
  extensionActive,
  inWindow,
  nextEmptyWindow,
  openWindow,
  recordLines,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {indicatorGroups} from '../windows/activation-support.ts';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {paletteItems, runFromPalette} from '../windows/palette.ts';
import {dialogOf, notifications, pageText} from '../windows/renderer.ts';

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
    const empty = await nextEmptyWindow(() =>
      inWindow('local', 'workbench.action.newWindow'),
    );
    const folder = await openFolderWindow('c2486-listed');
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
    const empty = await nextEmptyWindow(() =>
      inWindow('local', 'workbench.action.newWindow'),
    );
    const folder = await openFolderWindow('c2486-local');
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
    const folder = await openFolderWindow('c2486-getstarted');
    try {
      const before = (await pageText(folder)).length;
      await runFromPalette(folder, 'Remote-SSH: Get Started with SSH');
      await waitFor('the window to settle', () => true, 3_000);
      deepStrictEqual((await pageText(folder)).length <= before + 64, true);
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
    const folder = await openFolderWindow('c2486-filter');
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
    const folder = await openFolderWindow('c2486-reuse');
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
    const folder = await openFolderWindow('c2486-companion');
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
    const folder = await openFolderWindow('c2486-keybinding');
    const storageBefore = storageOf();
    const commandsBefore = await commandsOf(folder, 'opensshremotes.');
    try {
      await inWindow(folder, HELP_COMMANDS.feedback);
      await waitFor('the window to settle', () => true, 3_000);
      deepStrictEqual(
        [
          storageOf().length === storageBefore.length,
          (await commandsOf(folder, 'opensshremotes.')).join('\n') ===
            commandsBefore.join('\n'),
          (await dialogOf(folder)) === undefined,
          (await notifications(folder)).length === 0,
        ],
        [true, true, true, true],
      );
    } finally {
      await closeWindow(folder);
    }
  });

  it('F-2004 AC-17 (c2486-settings-disconnected): in a disconnected SSH window, Settings leaves the window usable and shows no message of the extension', async () => {
    appendScript(failureEntries('c2486-down-settings'));
    await openWindow('refused', 'c2486-down-settings');
    await waitFor(
      'the dismissed failure',
      () => recordLines('mitigationPick', 'c2486-down-settings').length > 0,
      120_000,
    );
    await inWindow('c2486-down-settings', HELP_COMMANDS.settings);
    await waitFor('the window to settle', () => true, 3_000);
    const dialog = await dialogOf('c2486-down-settings');
    deepStrictEqual(
      [
        (await notifications('c2486-down-settings')).length === 0,
        !dialog?.message.toLowerCase().includes('remote-ssh'),
        (await paletteItems('c2486-down-settings', 'Remote-SSH: Help'))
          .length === 1,
      ],
      [true, true, true],
    );
  });

  it('F-2004 AC-19 (c2486-first-help-part): a first Help run activates the extension and adds no output channel line', async () => {
    const empty = await nextEmptyWindow(() =>
      inWindow('local', 'workbench.action.newWindow'),
    );
    try {
      const before = connectionLog().length;
      await runFromPalette(empty, 'Remote-SSH: Help');
      await waitFor(
        'the activation',
        async () => await extensionActive(empty, 'remote-oss.remote-ssh'),
        30_000,
      );
      deepStrictEqual(
        [
          connectionLog().length === before,
          (await notifications(empty)).length === 0,
        ],
        [true, true],
      );
    } finally {
      await closeWindow(empty);
    }
  });

  it('F-2004 AC-21 (c2486-no-writes-part): each of the four commands writes nothing to settings, state or the global-storage folder', async () => {
    const folder = await openFolderWindow('c2486-no-writes');
    try {
      const storageBefore = storageOf();
      const commandsBefore = await commandsOf(folder, 'opensshremotes.');
      await inWindow(folder, HELP_COMMANDS.help);
      await inWindow(folder, HELP_COMMANDS.getStarted);
      await inWindow(folder, 'workbench.action.openSettings');
      await waitFor(
        'the plain settings editor',
        async () => (await pageText(folder)).includes('Settings'),
        30_000,
      );
      await inWindow(folder, 'workbench.action.closeActiveEditor');
      await inWindow(folder, HELP_COMMANDS.feedback);
      await waitFor('the window to settle', () => true, 3_000);
      deepStrictEqual(
        [
          storageOf().length === storageBefore.length,
          (await commandsOf(folder, 'opensshremotes.')).join('\n') ===
            commandsBefore.join('\n'),
          (await notifications(folder)).length === 0,
        ],
        [true, true, true],
      );
    } finally {
      await closeWindow(folder);
    }
  });

  it('F-2004 AC-23 (c2486-indicator-part): the remote indicator menu of a local folder window holds no help, documentation or feedback entry', async () => {
    const folder = await openFolderWindow('c2486-indicator');
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
    const folder = await openFolderWindow('c2486-no-companion');
    try {
      await runFromPalette(folder, 'Remote-SSH: Help');
      await runFromPalette(folder, 'Remote-SSH: Get Started with SSH');
      await inWindow(folder, HELP_COMMANDS.feedback);
      await waitFor('the window to settle', () => true, 3_000);
      deepStrictEqual((await notifications(folder)).length, 0);
    } finally {
      await closeWindow(folder);
    }
  });
});
