import {deepStrictEqual} from 'node:assert';
import {connect} from 'node:net';
import type {AppendedEntry} from '../../../tools/script-file.ts';
import {
  acceptedKeyLogins,
  appendScript,
  closeWindow,
  connectedWithin,
  inWindow,
  isTrusted,
  onHost,
  openWindow,
  readUserSettings,
  recordLines,
  restoreUserSettings,
  signal,
  tunnelsOf,
  userSettings,
  waitFor,
} from '../windows/harness.ts';
import {INSTALL_MILLISECONDS} from '../windows/maintenance.ts';
import {
  answerDialog,
  dialogOf,
  portsRows,
  primaryButtonOf,
  statusItem,
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

/** What the local port answers when it is connected to: the first line, or nothing when it closes or says nothing in 5 s. */
function greetingOf(port: number): Promise<string | undefined> {
  return new Promise(resolve => {
    const socket = connect(port, '127.0.0.1');
    let text = '';
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(undefined);
    }, 5000);
    socket.on('data', chunk => {
      text += String(chunk);
      if (text.includes('\n')) {
        clearTimeout(timer);
        socket.destroy();
        resolve(text.trim());
      }
    });
    socket.on('error', () => {
      clearTimeout(timer);
      resolve(undefined);
    });
  });
}

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

  it('F-2410 AC-31 (st31-timeout): with the trust request left open the indicator reads Disconnected behind it, and after Trust Folder & Continue the dialog of the connect that timed out comes, from which Retry connects with no trust dialog', async () => {
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
    const indicator = (await statusItem(window, 'status.host')).text;
    const timedOut = recordLines('failureDialog', window)[0]?.question;
    await answerDialog(window, 'Trust Folder & Continue');
    signal('st31-retry');
    await connectedWithin(window, INSTALL_MILLISECONDS);
    deepStrictEqual(
      [indicator, timedOut, await dialogOf(window)],
      [
        'Disconnected from SSH: harness-zsh',
        'Could not establish connection to "harness-zsh": Connecting with SSH timed out.',
        undefined,
      ],
    );
  });

  it('F-2410 AC-12 (st12-indicator): with stream-local forwarding refused the window ends in the dialog of the closed connection, and the indicator reads Disconnected from SSH: nosocket', async () => {
    const window = 'st12';
    appendScript([
      {surface: 'platformPick', match: 'platform', answer: 'linux', window},
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
    ] satisfies AppendedEntry[]);
    await openWindow('nosocket', window);
    await waitForDialog(window, 120_000);
    await answerDialog(window, 'Trust Folder & Continue');
    await waitFor(
      'the failure dialog',
      () => recordLines('failureDialog', window).length > 0,
      120_000,
    );
    deepStrictEqual(
      [
        recordLines('failureDialog', window).map(line => line.question),
        (await statusItem(window, 'status.host')).text,
      ],
      [
        ['Could not establish connection to "nosocket": Connection closed.'],
        'Disconnected from SSH: nosocket',
      ],
    );
  });

  it('F-2410 AC-19: a port forwarded from a window in socket mode is the only row of the Ports view, the status bar counts it, and the forward carries the host’s greeting', async () => {
    const window = 'st19';
    await openWindow('harness', window);
    await waitForDialog(window, 120_000);
    await answerDialog(window, 'Trust Folder & Continue');
    await connectedWithin(window, INSTALL_MILLISECONDS);
    await onHost(
      'sh',
      '-c',
      'nohup nc -lk -p 8671 -s 127.0.0.1 -e /bin/echo c81-8671 >/dev/null 2>&1 &',
    );
    try {
      await inWindow(window, 'acceptance.agent.forwardPort', 8671);
      await waitFor(
        'the forward',
        async () => (await tunnelsOf(window)).length > 0,
        30_000,
      );
      const [tunnel] = await tunnelsOf(window);
      const local = Number(tunnel?.localAddress.split(':').at(-1));
      await inWindow(window, '~remote.forwardedPorts.focus');
      await waitFor(
        'the row',
        async () => (await portsRows(window).catch(() => [])).length > 0,
        30_000,
      );
      deepStrictEqual(
        {
          rows: (await portsRows(window)).map(entry => entry.port),
          status: (await statusItem(window, 'status.forwardedPorts')).ariaLabel,
          greeting: await greetingOf(local),
        },
        {
          rows: ['8671'],
          status: 'Forwarded Ports: 8671',
          greeting: 'c81-8671',
        },
      );
    } finally {
      await onHost('sh', '-c', "pkill -f 'n[c] -lk -p 8671'; true");
    }
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
