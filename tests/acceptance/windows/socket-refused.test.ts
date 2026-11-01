import {deepStrictEqual} from 'node:assert';
import {
  appendScript,
  closeWindow,
  connectedWithin,
  onHost,
  openWindow,
  readUserSettings,
  recordLines,
  restoreUserSettings,
  userSettings,
  waitFor,
  type RecordLine,
} from './harness.ts';
import {freshHost, INSTALL_MILLISECONDS} from './maintenance.ts';

/** The buttons of a failure dialog, in the order the record has them. */
const THREE_BUTTONS = ['Close Remote', 'Retry', 'More Actions...'];

/** The dialog of a connect whose tunnel the host refuses, for the alias `alias`. */
function closedDialog(alias: string): string {
  return `Could not establish connection to "${alias}": Connection closed.`;
}

/** The lines of window `name`'s record of `surface`. */
function linesOf(name: string, surface: string): RecordLine[] {
  return recordLines(surface, name);
}

/** What `remote.SSH.remotePlatform` holds in the user settings file, or nothing. */
function storedPlatform(): unknown {
  const text = readUserSettings();
  return text === undefined
    ? undefined
    : (JSON.parse(text) as Record<string, unknown>)[
        'remote.SSH.remotePlatform'
      ];
}

/** The sockets of the user `user`'s server in the host's `/tmp`, as `/tmp/code-<uuid>`, that the kernel lists as listening. */
async function listeningSockets(user: string): Promise<string[]> {
  return (
    await onHost(
      'sh',
      '-c',
      `for path in $(awk '$4=="00010000" && $8 ~ /^\\/tmp\\/code-/ {print $8}' /proc/net/unix); do [ "$(stat -c %U "$path")" = ${user} ] && echo "$path"; done; true`,
    )
  )
    .split('\n')
    .filter(line => line !== '');
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

/** Waits for the `count`-th failure dialog of window `name`. */
function dialogNumber(name: string, count: number): Promise<void> {
  return waitFor(
    `failure dialog ${String(count)} of ${name}`,
    () => linesOf(name, 'failureDialog').length >= count,
    120_000,
  );
}

describe('a host that refuses forwarding on the first connect (card coverage-81, card connect-97)', function () {
  this.timeout(900_000);

  let saved: string | undefined;

  before(async () => {
    saved = readUserSettings();
    await freshHost();
    await userSettings({
      'remote.SSH.remoteServerListenOnSocket': true,
      'remote.SSH.remotePlatform': {nosocket: 'linux', noall: 'linux'},
    });
  });

  after(async () => {
    restoreUserSettings(saved);
    await freshHost();
  });

  it('F-2410 AC-12: with stream-local forwarding refused the connect ends after the tunnel step in the dialog of the closed connection with its three buttons, with one attempt and no reconnection', async () => {
    appendScript(dismissals('r12'));
    await openWindow('nosocket', 'r12');
    await dialogNumber('r12', 1);
    await new Promise(resolve => setTimeout(resolve, 5000));
    deepStrictEqual(
      {
        steps: linesOf('r12', 'progress').map(line => line.question),
        dialogs: linesOf('r12', 'failureDialog').map(line => [
          line.question,
          line.buttons,
        ]),
      },
      {
        steps: [
          'Setting up SSH Host nosocket',
          'Initializing VS Code Server',
          'Downloading VS Code Server',
          'Installing VS Code Server',
          'Setting up SSH tunnel',
          'Waiting for port forwarding to be ready',
        ],
        dialogs: [[closedDialog('nosocket'), THREE_BUTTONS]],
      },
    );
  });

  it('F-2410 AC-15: with all forwarding refused the dialog is the same', async () => {
    appendScript(dismissals('r15'));
    await openWindow('noall', 'r15');
    await dialogNumber('r15', 1);
    deepStrictEqual(
      linesOf('r15', 'failureDialog').map(line => [
        line.question,
        line.buttons,
      ]),
      [[closedDialog('noall'), THREE_BUTTONS]],
    );
  });

  it('F-2410 AC-14: with the setting off the host that refuses stream-local forwarding connects', async () => {
    await userSettings({'remote.SSH.remoteServerListenOnSocket': false});
    await openWindow('nosocket', 'r14');
    await connectedWithin('r14', INSTALL_MILLISECONDS);
    deepStrictEqual(linesOf('r14', 'failureDialog'), []);
  });

  it('F-2410 AC-13, AC-14, AC-27 (ruling-299-socket-reuse): Retry asks for the platform again and ends in the same dialog, three attempts leave one socket of the server and no platform stored, and More Actions... opens the pick of actions', async () => {
    await closeWindow('r14');
    await userSettings({
      'remote.SSH.remoteServerListenOnSocket': true,
      'remote.SSH.remotePlatform': undefined,
    });
    const pick = {
      surface: 'platformPick',
      match: 'Select the platform',
      answer: 'linux',
      window: 'r13',
    } as const;
    const retry = {
      surface: 'failureDialog',
      match: 'Could not establish connection',
      answer: {button: 'Retry'},
      window: 'r13',
    } as const;
    appendScript([
      pick,
      retry,
      pick,
      retry,
      pick,
      {...retry, answer: {button: 'More Actions...'}},
      {
        surface: 'mitigationPick',
        match: 'Pick an action',
        answer: 'dismiss',
        window: 'r13',
      },
    ]);
    await openWindow('nosocket', 'r13');
    await waitFor(
      'the pick of actions',
      () => linesOf('r13', 'mitigationPick').length > 0,
      180_000,
    );
    deepStrictEqual(
      {
        picks: linesOf('r13', 'platformPick').length,
        dialogs: linesOf('r13', 'failureDialog').map(line => [
          line.question,
          line.buttons,
        ]),
        actions: linesOf('r13', 'mitigationPick').map(line => line.question),
        sockets: (await listeningSockets('harness-nosock')).length,
        stored: storedPlatform(),
      },
      {
        picks: 3,
        dialogs: [
          [closedDialog('nosocket'), THREE_BUTTONS],
          [closedDialog('nosocket'), THREE_BUTTONS],
          [closedDialog('nosocket'), THREE_BUTTONS],
        ],
        actions: ['Pick an action to help resolve the problem.'],
        sockets: 1,
        stored: undefined,
      },
    );
  });
});
