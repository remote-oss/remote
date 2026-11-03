import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  inWindow,
  onHostAs,
  readUserSettings,
  restoreUserSettings,
  userSettings,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {paletteItems, runFromPalette} from '../windows/palette.ts';
import {
  chatInputRows,
  lineMarkedUnnecessary,
  waitForDialog,
} from '../windows/renderer.ts';

/** The user setting whose value the rows save. */
const EXPERIMENTAL_CHAT = 'remote.SSH.experimental.chat';

/** The platform the row names for its hosts: in the terminal mode a host without an entry is asked, and the row never answers a pick. */
const PLATFORMS = {harness: 'linux', refused: 'linux'};

/** The title the clear command carries in the palette. */
const CLEAR_COMMAND =
  'Remote-SSH: Clear previous session metadata (used for enhanced error reporting)';

/** Whether the chat input of window `name`, opened by its own open command, offers a row naming remote-ssh after `@remote` is typed into it. */
async function chatOffersRemote(name: string): Promise<boolean> {
  await inWindow(name, 'workbench.action.chat.open');
  const rows = await chatInputRows(name, '@remote');
  return rows.some(each => each.includes('remote-ssh'));
}

/** Opens a window on the key-authenticated harness alias over folder `label`; the window's name is `label`. */
async function openHarnessWindow(label: string): Promise<void> {
  await onHostAs('harness', 'mkdir', '-p', `/home/harness/${label}`);
  void inWindow(
    'local',
    'acceptance.agent.openWindow',
    `vscode-remote://ssh-remote+harness/home/harness/${label}`,
  );
}

/** An empty window on the refused alias, whose closed port fails the connect; the window's name is `label`. */
function openRefusedWindow(label: string): string {
  void inWindow(
    'local',
    'acceptance.agent.openWindow',
    `vscode-remote://ssh-remote+refused/home/harness/${label}`,
  );
  return label;
}

/** Until the connecting window `name` has resolved to its remote, so its commands run. */
async function connected(name: string): Promise<void> {
  await waitFor(
    `window ${name} to connect`,
    async () => (await windowState(name)).remoteAuthority !== null,
    120_000,
  );
}

/**
 * Whether the palette of window `name` filtered by `text` lists `command` exactly, waiting for the list: the
 * palette's index lags the command registry while a new window's extension host settles, so an early read lists
 * the core commands only.
 */
async function paletteListed(
  name: string,
  text: string,
  command: string,
): Promise<boolean> {
  await waitFor(
    `the palette of window ${name} to list ${command}`,
    async () => (await paletteItems(name, text)).includes(command),
    60_000,
  );
  return true;
}

describe('the absence of the chat participant (card connect-137)', function () {
  this.timeout(300_000);

  it('F-2606 AC-15: typing @remote in the chat input offers no row from this extension', async () => {
    const saved = readUserSettings();
    try {
      await userSettings({'chat.disableAIFeatures': false});
      deepStrictEqual(await chatOffersRemote('local'), false);
    } finally {
      restoreUserSettings(saved);
    }
  });

  for (const value of [false, true]) {
    it(`F-2606 AC-25: with remote.SSH.experimental.chat ${String(value)}, the clear command is listed, the dialog has no Copilot button, the chat input offers no row, and the settings file marks the key`, async () => {
      const saved = readUserSettings();
      const name = `chat-harness-${String(value)}`;
      let opened = false;
      try {
        await userSettings({
          [EXPERIMENTAL_CHAT]: value,
          ['chat.disableAIFeatures']: false,
          ['remote.SSH.remotePlatform']: {...PLATFORMS},
        });
        await openHarnessWindow(name);
        opened = true;
        await connected(name);
        const listed = await paletteListed(
          name,
          'Clear previous session',
          CLEAR_COMMAND,
        );
        const refused = openRefusedWindow(`chat-refused-${String(value)}`);
        const dialog = await waitForDialog(refused, 120_000);
        const copilot = [...dialog.buttons].includes('Diagnose with Copilot');
        await closeWindow(refused);
        const offered = await chatOffersRemote(name);
        await runFromPalette(name, 'Preferences: Open Settings (UI)');
        await runFromPalette(name, 'Preferences: Open User Settings (JSON)');
        const marked = await lineMarkedUnnecessary(
          name,
          'remote.SSH.experimental.chat',
        );
        deepStrictEqual(
          {listed, copilot, offered, marked},
          {listed: true, copilot: false, offered: false, marked: true},
        );
      } finally {
        if (opened) {
          await closeWindow(name);
        }
        restoreUserSettings(saved);
      }
    });
  }
});
