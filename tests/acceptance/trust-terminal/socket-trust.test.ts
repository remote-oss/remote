import {deepStrictEqual} from 'node:assert';
import type {AppendedEntry} from '../../../tools/script-file.ts';
import {
  acceptedKeyLogins,
  appendScript,
  closeWindow,
  connectedWithin,
  inWindow,
  isTrusted,
  openWindow,
  readUserSettings,
  recordLines,
  restoreUserSettings,
  signal,
  userSettings,
  waitFor,
} from '../windows/harness.ts';
import {INSTALL_MILLISECONDS} from '../windows/maintenance.ts';
import {
  answerDialog,
  dialogOf,
  primaryButtonOf,
  waitForDialog,
} from '../windows/renderer.ts';

/** The buttons of core's trust request, in the order the page holds them (measured on the run's build). */
const REQUEST_BUTTONS = ['Manage', 'Cancel', 'Trust Folder & Continue'];

/** The question of core's trust request. */
const REQUEST_QUESTION =
  'Do you trust the authors of the files in this folder?';

/** The steps of the install, whose progress no row may see before the folder is trusted. */
const INSTALL_STEPS = [
  'Downloading VS Code Server',
  'Installing VS Code Server',
  'Setting up SSH tunnel',
];

describe('the connect of a folder that is not trusted, with the server on a socket (card coverage-81)', function () {
  this.timeout(600_000);

  let saved: string | undefined;

  before(async () => {
    saved = readUserSettings();
    await userSettings({'remote.SSH.remoteServerListenOnSocket': true});
  });

  after(() => {
    restoreUserSettings(saved);
  });

  it('F-2410 AC-29: core’s trust request comes before any install step, Trust Folder & Continue lets the connect succeed, and a later window of the folder asks nothing', async () => {
    await openWindow('harness', 'st29');
    const request = await waitForDialog('st29', 120_000);
    const before = recordLines('progress', 'st29').map(line => line.question);
    await answerDialog('st29', 'Trust Folder & Continue');
    await connectedWithin('st29', INSTALL_MILLISECONDS);
    await closeWindow('st29');
    await openWindow('harness', 'st29');
    await connectedWithin('st29', INSTALL_MILLISECONDS);
    deepStrictEqual(
      [
        request.message,
        request.buttons,
        before.some(title => INSTALL_STEPS.includes(title)),
        await isTrusted('st29'),
        await dialogOf('st29'),
      ],
      [REQUEST_QUESTION, REQUEST_BUTTONS, false, true, undefined],
    );
  });

  for (const [button, alias] of [
    ['Cancel', 'harness-bash'],
    ['Manage', 'harness-ksh'],
  ] as const) {
    it(`F-2410 AC-30: ${button} on the trust request ends the connect at once in the dialog of the install script’s bad result, with no login on the host and no platform stored`, async () => {
      const folder = `st30-${button.toLowerCase()}`;
      appendScript([
        {
          surface: 'platformPick',
          match: 'platform',
          answer: 'linux',
          window: folder,
        },
        {
          surface: 'failureDialog',
          match: 'Could not establish connection',
          answer: 'dismiss',
          window: folder,
        },
        {
          surface: 'mitigationPick',
          match: 'Pick an action',
          answer: 'dismiss',
          window: folder,
        },
      ] satisfies AppendedEntry[]);
      const since = new Date().toISOString();
      await openWindow(alias, folder);
      await waitForDialog(folder, 120_000);
      const settingsBefore = readUserSettings();
      await answerDialog(folder, button);
      await waitFor(
        'the failure dialog',
        () => recordLines('failureDialog', folder).length > 0,
        30_000,
      );
      const [dialog] = recordLines('failureDialog', folder);
      deepStrictEqual(
        [
          dialog?.question,
          dialog?.buttons,
          await acceptedKeyLogins(since),
          readUserSettings() === settingsBefore,
        ],
        [
          `Could not establish connection to "${alias}": Got bad result from install script.`,
          ['Close Remote', 'Retry', 'More Actions...'],
          0,
          true,
        ],
      );
    });
  }

  // The indicator clause (`Disconnected from SSH: <host>` behind the dialog) waits for the host-label card, #1636.
  it('F-2410 AC-31 (st31-no-indicator): with the trust request left open and the connect timed out, after Trust Folder & Continue the dialog of the connect that timed out comes, from which Retry connects with no trust dialog', async () => {
    const window = 'st31';
    appendScript([
      {surface: 'platformPick', match: 'platform', answer: 'linux', window},
      {
        surface: 'failureDialog',
        match: 'Could not establish connection',
        answer: {button: 'Retry'},
        window,
        after: 'st31-retry',
      },
      {surface: 'platformPick', match: 'platform', answer: 'linux', window},
    ] satisfies AppendedEntry[]);
    await openWindow('harness-zsh', window);
    await waitForDialog(window, 120_000);
    await waitFor(
      'the connect to time out',
      () => recordLines('failureDialog', window).length > 0,
      120_000,
    );
    const timedOut = recordLines('failureDialog', window)[0]?.question;
    await answerDialog(window, 'Trust Folder & Continue');
    signal('st31-retry');
    await connectedWithin(window, INSTALL_MILLISECONDS);
    deepStrictEqual(
      [timedOut, await dialogOf(window)],
      [
        'Could not establish connection to "harness-zsh": Connecting with SSH timed out.',
        undefined,
      ],
    );
  });

  it('F-2410 AC-23: Kill Current VS Code Server on a connected window shows the killed notice with Open Logs, and then core’s dialog that the window cannot reconnect, with Cancel and Reload Window', async () => {
    const window = 'st23';
    // Core draws its dialogs natively on Linux unless asked otherwise, which the page does not show.
    await userSettings({'window.dialogStyle': 'custom'});
    await openWindow('harness', window);
    await waitForDialog(window, 120_000);
    await answerDialog(window, 'Trust Folder & Continue');
    await connectedWithin(window, INSTALL_MILLISECONDS);
    const mark = recordLines().length;
    await inWindow(window, 'opensshremotes.cleanCurrentRemoteServer');
    const dialog = await waitForDialog(window, 120_000);
    deepStrictEqual(
      [
        recordLines()
          .slice(mark)
          .filter(line => line.surface === 'notice')
          .map(line => [line.question, line.buttons]),
        dialog.details,
        dialog.buttons,
        await primaryButtonOf(window),
      ],
      [
        [['Killed VS Code Server on harness.', ['Open Logs']]],
        'Cannot reconnect. Please reload the window.',
        ['Cancel', 'Reload Window'],
        'Reload Window',
      ],
    );
  });
});
