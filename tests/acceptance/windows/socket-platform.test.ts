import {deepStrictEqual} from 'node:assert';
import {
  acceptedKeyLogins,
  appendScript,
  closeWindow,
  connectedWithin,
  openWindow,
  readUserSettings,
  recordLines,
  restoreUserSettings,
  signal,
  userSettings,
  waitFor,
  type RecordLine,
} from './harness.ts';
import {
  freshHost,
  INSTALL_MILLISECONDS,
  storedPlatform,
} from './maintenance.ts';

/** The question of the platform pick of the host `harness`. */
const PLATFORM_QUESTION = 'Select the platform of the remote host "harness"';

/** The user settings of socket mode with the shared connection named on, and no platform stored for any host. */
const SOCKET_MODE = {
  'remote.SSH.remoteServerListenOnSocket': true,
  'remote.SSH.useLocalServer': true,
  'remote.SSH.remotePlatform': undefined,
};

/** The lines of window `name`'s record of `surface`. */
function linesOf(name: string, surface: string): RecordLine[] {
  return recordLines(surface, name);
}

/** The progress titles window `name` showed, in order, without the phases' repeats. */
function progressTitles(name: string): string[] {
  return linesOf(name, 'progress').map(line => line.question);
}

/** The entries that dismiss the failure dialog and the pick of actions of window `name`. */
function dismissals(name: string) {
  return [
    {
      surface: 'failureDialog',
      match: 'Could not establish connection',
      answer: 'dismiss',
      window: name,
    },
    {
      surface: 'mitigationPick',
      match: 'Pick an action',
      answer: 'dismiss',
      window: name,
    },
  ] as const;
}

describe('the platform pick in socket mode (card coverage-81)', function () {
  this.timeout(600_000);

  let saved: string | undefined;

  before(async () => {
    saved = readUserSettings();
    await freshHost();
    await userSettings(SOCKET_MODE);
  });

  after(async () => {
    restoreUserSettings(saved);
    await freshHost();
  });

  it('F-2410 AC-5, AC-6: with no stored platform the pick lists Linux, Windows and macOS with Linux focused while the initializing progress runs, nothing is installed until it is answered, and the connect then has two logins', async () => {
    appendScript([
      {
        surface: 'platformPick',
        match: 'Select the platform',
        answer: 'linux',
        window: 's6',
        after: 'c81-s6-answer',
      },
    ]);
    const since = new Date().toISOString();
    await openWindow('harness', 's6');
    await waitFor(
      'the pick to be shown',
      () => linesOf('s6', 'platformPick').length > 0,
      60_000,
    );
    await new Promise(resolve => setTimeout(resolve, 3000));
    const waiting = {
      pick: linesOf('s6', 'platformPick').map(line => [
        line.question,
        line.items,
        line.active,
      ]),
      progress: progressTitles('s6'),
    };
    signal('c81-s6-answer');
    await connectedWithin('s6', INSTALL_MILLISECONDS);
    deepStrictEqual(
      [waiting, await acceptedKeyLogins(since)],
      [
        {
          pick: [[PLATFORM_QUESTION, ['Linux', 'Windows', 'macOS'], 'Linux']],
          progress: [
            'Setting up SSH Host harness',
            'Initializing VS Code Server',
          ],
        },
        2,
      ],
    );
  });

  it('F-2410 AC-7, AC-25: after Linux is picked the user settings hold the host’s platform, the connect showed the platform notice with its button, and a later window asks nothing', async () => {
    const notice = linesOf('s6', 'notice').map(line => [
      line.question,
      line.buttons,
    ]);
    await waitFor(
      'the platform to be stored',
      () => JSON.stringify(storedPlatform()) === '{"harness":"linux"}',
      30_000,
    );
    await closeWindow('s6');
    await openWindow('harness', 's7');
    await connectedWithin('s7', INSTALL_MILLISECONDS);
    deepStrictEqual(
      [notice, storedPlatform(), linesOf('s7', 'platformPick')],
      [
        [
          [
            'You selected "linux" as the remote platform - this will be stored in the setting "remote.SSH.remotePlatform" and can be changed there if needed.',
            ["Don't Show Again"],
          ],
        ],
        {harness: 'linux'},
        [],
      ],
    );
  });

  it('F-2410 AC-16: Escape on the pick ends in the dialog of the canceled connect with its three buttons, and nothing is stored', async () => {
    await closeWindow('s7');
    await userSettings({'remote.SSH.remotePlatform': undefined});
    appendScript([
      {
        surface: 'platformPick',
        match: 'Select the platform',
        answer: 'dismiss',
        window: 's16',
      },
      ...dismissals('s16'),
    ]);
    await openWindow('harness', 's16');
    await waitFor(
      'the failure dialog',
      () => linesOf('s16', 'failureDialog').length > 0,
      60_000,
    );
    const [dialog] = linesOf('s16', 'failureDialog');
    deepStrictEqual(
      [dialog?.question, dialog?.buttons, storedPlatform()],
      [
        'Could not establish connection to "harness": Connecting was canceled.',
        ['Close Remote', 'Retry', 'More Actions...'],
        undefined,
      ],
    );
  });

  it('F-2410 AC-22: Windows picked for the Linux host ends in the dialog with no reason and its three buttons, and nothing is stored', async () => {
    await closeWindow('s16');
    appendScript([
      {
        surface: 'platformPick',
        match: 'Select the platform',
        answer: 'windows',
        window: 's22',
      },
      ...dismissals('s22'),
    ]);
    await openWindow('harness', 's22');
    await waitFor(
      'the failure dialog',
      () => linesOf('s22', 'failureDialog').length > 0,
      90_000,
    );
    const [dialog] = linesOf('s22', 'failureDialog');
    deepStrictEqual(
      [dialog?.question, dialog?.buttons, storedPlatform()],
      [
        'Could not establish connection to "harness".',
        ['Close Remote', 'Retry', 'More Actions...'],
        undefined,
      ],
    );
  });
});
