import {deepStrictEqual} from 'node:assert';
import {
  activeEditorOf,
  activeEditorTextOf,
  closeWindow,
  editorProduct,
  inWindow,
  onHost,
  openWindow,
  waitFor,
} from '../windows/harness.ts';
import {paletteItems} from '../windows/palette.ts';
import {startInWindow} from '../windows/harness.ts';
import {
  chooseQuickPickRow,
  pageText,
  settingsTabs,
  typeInQuickPick,
  waitForQuickPick,
} from '../windows/renderer.ts';

/** The host file of the remote settings, in the server folder the running client's product names. */
function remoteSettingsFile(): string {
  return `/home/harness/${editorProduct().serverDataFolderName}/data/Machine/settings.json`;
}

const JSON_COMMAND = 'Preferences: Open Remote Settings (JSON) (SSH: harness)';
const SETTINGS_COMMAND = 'Preferences: Open Remote Settings (SSH: harness)';

/**
 * Opens a window on the host and waits, up to 60 s, until core lists the Open Remote Settings commands with the host's
 * label: the label reaches core a few seconds after the window opens (measured: between 2 and 4 s), and a command run
 * before then is another one.
 */
async function labelledWindow(folder: string): Promise<void> {
  await openWindow('harness', folder);
  await waitFor(
    `the host label in window ${folder}`,
    async () =>
      (await paletteItems(folder, 'Open Remote Settings')).includes(
        SETTINGS_COMMAND,
      ),
    60_000,
  );
}

/** Runs the command of the Command Palette whose title is exactly `title` in window `name`, not the first match. */
async function runTitled(name: string, title: string): Promise<void> {
  await startInWindow(name, 'workbench.action.showCommands');
  await waitForQuickPick(name, 30_000);
  await typeInQuickPick(name, `>${title}`);
  await new Promise(resolve => setTimeout(resolve, 1000));
  await chooseQuickPickRow(name, title);
}

describe('the remote settings and the Extensions view in an SSH window (card coverage-80)', function () {
  this.timeout(300_000);

  it('F-2508 AC-8 (c80-remote-commands): the Command Palette lists the Open Remote Settings commands with the host in their titles', async () => {
    await labelledWindow('c80-commands');
    try {
      deepStrictEqual(
        (await paletteItems('c80-commands', 'Open Remote Settings'))
          .filter(title => title.includes('Open Remote Settings'))
          .sort(),
        [JSON_COMMAND, SETTINGS_COMMAND].sort(),
      );
    } finally {
      await closeWindow('c80-commands').catch(() => undefined);
    }
  });

  it('F-2508 AC-9 (c80-remote-file): the JSON command creates the host’s remote settings file with an empty object and opens it', async () => {
    await labelledWindow('c80-file');
    try {
      await onHost('rm', '-f', remoteSettingsFile());
      await runTitled('c80-file', JSON_COMMAND);
      await waitFor(
        'the settings file to be the active editor',
        async () => (await activeEditorOf('c80-file')) === remoteSettingsFile(),
        30_000,
      );
      deepStrictEqual(
        JSON.parse(await onHost('cat', remoteSettingsFile())),
        {},
      );
    } finally {
      await closeWindow('c80-file').catch(() => undefined);
    }
  });

  it('F-2508 AC-11 (c80-settings-tabs): the Settings editor opened by the remote command has the scope tabs User, Remote [SSH: harness] (selected) and Workspace', async () => {
    await labelledWindow('c80-tabs');
    try {
      await runTitled('c80-tabs', SETTINGS_COMMAND);
      await waitFor(
        'the scope tabs',
        async () => (await settingsTabs('c80-tabs')).length > 0,
        30_000,
      );
      deepStrictEqual(await settingsTabs('c80-tabs'), [
        {label: 'User', selected: false},
        {label: 'Remote [SSH: harness]', selected: true},
        {label: 'Workspace', selected: false},
      ]);
    } finally {
      await closeWindow('c80-tabs').catch(() => undefined);
    }
  });

  it('F-2508 AC-27, AC-32 (c80-save-shared): a value saved in the remote settings JSON of one window is in the host file and in the same command’s file of a second window on the host', async () => {
    await labelledWindow('c80-save-a');
    await labelledWindow('c80-save-b');
    try {
      await onHost('rm', '-f', remoteSettingsFile());
      await runTitled('c80-save-a', JSON_COMMAND);
      await waitFor(
        'the settings file to be open',
        async () =>
          (await activeEditorOf('c80-save-a')) === remoteSettingsFile(),
        30_000,
      );
      await inWindow(
        'c80-save-a',
        'acceptance.agent.writeActiveEditor',
        '{"editor.tabSize": 6}\n',
      );
      await runTitled('c80-save-b', JSON_COMMAND);
      await waitFor(
        'the second window to show the file',
        async () =>
          (await activeEditorTextOf('c80-save-b'))?.includes(
            '"editor.tabSize": 6',
          ) === true,
        30_000,
      );
      deepStrictEqual(JSON.parse(await onHost('cat', remoteSettingsFile())), {
        'editor.tabSize': 6,
      });
    } finally {
      await closeWindow('c80-save-a').catch(() => undefined);
      await closeWindow('c80-save-b').catch(() => undefined);
      await onHost('rm', '-f', remoteSettingsFile());
    }
  });

  it('F-2508 AC-15 (c80-extensions-view): the Extensions view shows Local - Installed, SSH: Harness - Installed and Recommended in that order, and the host section says No extensions found', async () => {
    await labelledWindow('c80-extensions');
    try {
      await inWindow('c80-extensions', 'workbench.view.extensions');
      await waitFor(
        'the host section',
        async () =>
          /SSH: Harness - Installed\n\d+\nNo extensions found\./.test(
            await pageText('c80-extensions'),
          ),
        30_000,
      );
      const text = await pageText('c80-extensions');
      const places = [
        'Local - Installed',
        'SSH: Harness - Installed',
        'Recommended',
      ].map(title => text.indexOf(title));
      deepStrictEqual(
        [
          places.every(
            (place, index) =>
              place >= 0 && (index === 0 || place > (places[index - 1] ?? 0)),
          ),
          text.includes('No extensions found.'),
        ],
        [true, true],
      );
    } finally {
      await closeWindow('c80-extensions').catch(() => undefined);
    }
  });

  it('F-2508 AC-30 (ruling-1656-host-label): the host section’s action names the host by its label, Install Local Extensions in SSH: harness, and the section says No extensions found', async () => {
    await labelledWindow('c80-install-local');
    try {
      await inWindow('c80-install-local', 'workbench.view.extensions');
      await waitFor(
        'the host section',
        async () =>
          /SSH: Harness - Installed\n\d+\nNo extensions found\./.test(
            await pageText('c80-install-local'),
          ),
        30_000,
      );
      deepStrictEqual(
        (
          await paletteItems('c80-install-local', 'Install Local Extensions')
        ).filter(title => title.includes('Install Local Extensions')),
        ["Remote: Install Local Extensions in 'SSH: harness'..."],
      );
    } finally {
      await closeWindow('c80-install-local').catch(() => undefined);
    }
  });
});
