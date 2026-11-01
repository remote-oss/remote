import {deepStrictEqual} from 'node:assert';
import {
  activeEditorOf,
  closeWindow,
  editorProduct,
  inWindow,
  onHost,
  openWindow,
  waitFor,
} from '../windows/harness.ts';
import {paletteItems} from '../windows/palette.ts';
import {pageText, paletteRun, settingsTabs} from '../windows/renderer.ts';

/** The host file of the remote settings, in the server folder the running client's product names. */
function remoteSettingsFile(): string {
  return `/home/harness/${editorProduct().serverDataFolderName}/data/Machine/settings.json`;
}

const JSON_COMMAND = 'Preferences: Open Remote Settings (JSON) (SSH: harness)';
const SETTINGS_COMMAND = 'Preferences: Open Remote Settings (SSH: harness)';

describe('the remote settings and the Extensions view in an SSH window (card coverage-80)', function () {
  this.timeout(300_000);

  it.skip('F-2508 AC-8 (c80-remote-commands): the Command Palette lists the Open Remote Settings commands with the host in their titles (skipped until the window registers its host label, connect-100; actual today: neither is listed)', async () => {
    await openWindow('harness', 'c80-commands');
    try {
      deepStrictEqual(
        (await paletteItems('c80-commands', 'Open Remote Settings')).sort(),
        [JSON_COMMAND, SETTINGS_COMMAND].sort(),
      );
    } finally {
      await closeWindow('c80-commands').catch(() => undefined);
    }
  });

  it.skip('F-2508 AC-9 (c80-remote-file): the JSON command creates the host’s remote settings file with an empty object and opens it (skipped until the host label, connect-100)', async () => {
    await openWindow('harness', 'c80-file');
    try {
      await onHost('rm', '-f', remoteSettingsFile());
      await paletteRun('c80-file', JSON_COMMAND);
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

  it.skip('F-2508 AC-11 (c80-settings-tabs): the Settings editor opened by the remote command has the scope tabs User, Remote [SSH: harness] (selected) and Workspace (skipped until the host label, connect-100)', async () => {
    await openWindow('harness', 'c80-tabs');
    try {
      await paletteRun('c80-tabs', SETTINGS_COMMAND);
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

  it.skip('F-2508 AC-27, AC-32 (c80-save-shared): a value saved in the remote settings JSON of one window is in the host file and in the same command’s file of a second window on the host (skipped until the host label, connect-100)', async () => {
    await openWindow('harness', 'c80-save-a');
    await openWindow('harness', 'c80-save-b');
    try {
      await onHost('rm', '-f', remoteSettingsFile());
      await paletteRun('c80-save-a', JSON_COMMAND);
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
      await paletteRun('c80-save-b', JSON_COMMAND);
      await waitFor(
        'the second window to show the file',
        async () =>
          (await pageText('c80-save-b')).includes('"editor.tabSize": 6'),
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

  it.skip('F-2508 AC-15, AC-30 (c80-extensions-view): the Extensions view shows Local - Installed, SSH: harness - Installed and Recommended in that order, and the host section says No extensions found (skipped until the host label, connect-100; actual today: the section reads Ssh-Remote+Harness - Installed)', async () => {
    await openWindow('harness', 'c80-extensions');
    try {
      await inWindow('c80-extensions', 'workbench.view.extensions');
      await waitFor(
        'the host section',
        async () =>
          (await pageText('c80-extensions')).includes(
            'SSH: harness - Installed',
          ),
        30_000,
      );
      const text = await pageText('c80-extensions');
      const places = [
        'Local - Installed',
        'SSH: harness - Installed',
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
});
