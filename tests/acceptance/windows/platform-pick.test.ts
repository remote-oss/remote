import {deepStrictEqual} from 'node:assert';
import type {AppendedEntry} from '../../../tools/script-file.ts';
import {
  appendScript,
  connected,
  connectedWithin,
  connectionLog,
  cutHostNetwork,
  restoreHostNetwork,
  inWindow,
  nextEmptyWindow,
  nextEmptyName,
  openWindow,
  recordLines,
  reloadWindow,
  signal,
  waitFor,
  type RecordLine,
} from './harness.ts';
import {
  alignScript,
  closeAllButLocal,
  dismissals,
  INSTALL_MILLISECONDS,
  linesSince,
  openConnected,
  pickHost,
  platformAnswer,
  runWith,
  serverProcesses,
  serversGoneWithin,
  setting,
  settingsText,
  storedPlatform,
  typeHost,
} from './maintenance.ts';

/** The question of the platform pick of the host `harness`. */
const PLATFORM_QUESTION = 'Select the platform of the remote host "harness"';

/** The notice that tells which platform was stored. */
function storedNotice(platform: string): string {
  return `You selected "${platform}" as the remote platform - this will be stored in the setting "remote.SSH.remotePlatform" and can be changed there if needed.`;
}

/** The dialog of a connect that was canceled, and the one of a connect that failed. */
const CANCELED =
  'Could not establish connection to "harness": Connecting was canceled.';
const FAILED = 'Could not establish connection to "harness".';

/** The three buttons a failed connect's dialog has, the first being the primary one. */
const DIALOG_BUTTONS = ['Close Remote', 'Retry', 'More Actions...'];

/** The start of the log line the probe writes when it asks the host for its platform. */
const PROBE_LINE = 'Host platform: ';

/** The lines of window `name`'s record of `surface`. */
function linesOf(name: string, surface: string): RecordLine[] {
  return recordLines(surface, name);
}

/** The answer to a failure dialog of window `name`: the button it presses, or none for a dismissal. */
function dialogAnswer(name: string, button?: string): AppendedEntry {
  return {
    surface: 'failureDialog',
    match: 'Could not establish connection',
    answer: button === undefined ? 'dismiss' : {button},
    window: name,
  };
}

/** The pick of platform `answer` for window `name`; it waits for `signalName` when one is given. */
function pickFor(
  name: string,
  answer: 'linux' | 'windows' | 'macOS' | 'dismiss',
  signalName?: string,
): AppendedEntry {
  return {
    ...platformAnswer(answer),
    match: 'Select the platform',
    window: name,
    ...(signalName === undefined ? {} : {after: signalName}),
  };
}

/** What window `name` showed on `surface`: each question with the buttons or the rows it had. */
function shownOn(
  name: string,
  surface: string,
): Array<[string, string[] | undefined]> {
  return linesOf(name, surface)
    .filter(line => line.held !== true)
    .map(line => [line.question, line.buttons ?? line.items]);
}

/** The questions and the dialogs of window `name` as the rows compare them. */
function asked(name: string): {
  picks: Array<[string, string[] | undefined]>;
  dialogs: Array<[string, string[] | undefined]>;
  notices: Array<[string, string[] | undefined]>;
} {
  return {
    picks: shownOn(name, 'platformPick'),
    dialogs: shownOn(name, 'failureDialog'),
    notices: shownOn(name, 'notice'),
  };
}

describe('the remote platform pick in non-local mode (card coverage-94)', function () {
  this.timeout(900_000);

  before(async () => {
    await closeAllButLocal();
    await setting('remote.SSH.remotePlatform', undefined);
    await setting('remote.SSH.useLocalServer', false);
  });

  afterEach(async () => {
    await closeAllButLocal();
    await setting('remote.SSH.remotePlatform', undefined);
    await setting('remote.SSH.useLocalServer', false);
  });

  after(async () => {
    await closeAllButLocal();
    await setting('remote.SSH.remotePlatform', undefined);
    await setting('remote.SSH.useLocalServer', undefined);
  });

  it('F-2206 AC-4, AC-6 (c94-wait): an open pick waits two minutes with nothing else happening; once answered, the connection resolves and the notice names the platform with its one button, and the setting holds it', async () => {
    appendScript([pickFor('p4', 'linux', 'c94-p4-answer')]);
    await openWindow('harness', 'p4');
    await waitFor(
      'the pick to be shown',
      () => linesOf('p4', 'platformPick').length > 0,
      60_000,
    );
    await new Promise(resolve => setTimeout(resolve, 120_000));
    const waiting = {
      lines: linesOf('p4', 'platformPick').map(line => [
        line.question,
        line.answer,
      ]),
      others: recordLines(undefined, 'p4')
        .filter(
          line =>
            !['platformPick', 'progress', 'progressEnd'].includes(line.surface),
        )
        .map(line => line.surface),
      stored: storedPlatform(),
    };
    signal('c94-p4-answer');
    await connectedWithin('p4', INSTALL_MILLISECONDS);
    await waitFor(
      'the platform to be stored',
      () => JSON.stringify(storedPlatform()) === '{"harness":"linux"}',
      30_000,
    );
    const notice = linesOf('p4', 'notice');
    const end = linesOf('p4', 'progressEnd').at(-1);
    const within = (notice[0]?.time ?? Infinity) - (end?.time ?? 0) <= 5000;
    deepStrictEqual(
      [
        waiting,
        notice.map(line => [line.question, line.buttons]),
        within,
        storedPlatform(),
      ],
      [
        {
          lines: [[PLATFORM_QUESTION, 'held']],
          others: [],
          stored: undefined,
        },
        [[storedNotice('linux'), ["Don't Show Again"]]],
        true,
        {harness: 'linux'},
      ],
    );
  });

  it('F-2206 AC-7 (c94-macos): macOS picked for a Linux host connects, and the notice and the stored value say linux', async () => {
    appendScript([pickFor('p7', 'macOS')]);
    await openWindow('harness', 'p7');
    await connectedWithin('p7', INSTALL_MILLISECONDS);
    await waitFor(
      'the platform to be stored',
      () => JSON.stringify(storedPlatform()) === '{"harness":"linux"}',
      30_000,
    );
    deepStrictEqual(
      [asked('p7').notices, storedPlatform()],
      [[[storedNotice('linux'), ["Don't Show Again"]]], {harness: 'linux'}],
    );
  });

  it('F-2206 AC-8 (c94-exact): an exact entry equal to the platform asks nothing and shows no notice, at the connect and at a reload, and leaves the settings as they were', async () => {
    await setting('remote.SSH.remotePlatform', {harness: 'linux'});
    const before = settingsText();
    await openWindow('harness', 'p8');
    await connectedWithin('p8', INSTALL_MILLISECONDS);
    await reloadWindow('p8');
    await connectedWithin('p8', INSTALL_MILLISECONDS);
    deepStrictEqual(
      [asked('p8').picks, asked('p8').notices, settingsText()],
      [[], [], before],
    );
  });

  it('F-2206 AC-9, AC-10 (c94-cancel): Escape on the pick, and Windows picked for a Linux host, end in the dialogs with their buttons and store nothing, and Retry shows the pick again', async () => {
    appendScript([
      pickFor('p9', 'dismiss'),
      dialogAnswer('p9', 'Retry'),
      pickFor('p9', 'windows'),
      dialogAnswer('p9', 'Retry'),
      pickFor('p9', 'dismiss'),
      ...dismissals('p9'),
    ]);
    await openWindow('harness', 'p9');
    await waitFor(
      'the second dialog',
      () => linesOf('p9', 'failureDialog').length > 2,
      120_000,
    );
    const lines = asked('p9');
    deepStrictEqual(
      [lines.picks, lines.dialogs, lines.notices, storedPlatform()],
      [
        [
          [PLATFORM_QUESTION, ['Linux', 'Windows', 'macOS']],
          [PLATFORM_QUESTION, ['Linux', 'Windows', 'macOS']],
          [PLATFORM_QUESTION, ['Linux', 'Windows', 'macOS']],
        ],
        [
          [CANCELED, DIALOG_BUTTONS],
          [FAILED, DIALOG_BUTTONS],
          [CANCELED, DIALOG_BUTTONS],
        ],
        [],
        undefined,
      ],
    );
  });

  it('F-2206 AC-11 (c94-windows-default): in default mode an entry that says windows runs no probe, fails with the dialog of AC-10, and Retry fails the same way', async () => {
    await setting('remote.SSH.useLocalServer', undefined);
    await setting('remote.SSH.remotePlatform', {harness: 'windows'});
    const mark = connectionLog().length;
    appendScript([dialogAnswer('p11', 'Retry'), ...dismissals('p11')]);
    await openWindow('harness', 'p11');
    await waitFor(
      'the second dialog',
      () => linesOf('p11', 'failureDialog').length > 1,
      120_000,
    );
    deepStrictEqual(
      [
        asked('p11').dialogs,
        asked('p11').picks,
        connectionLog()
          .slice(mark)
          .some(line => line.startsWith(PROBE_LINE)),
      ],
      [
        [
          [FAILED, DIALOG_BUTTONS],
          [FAILED, DIALOG_BUTTONS],
        ],
        [],
        false,
      ],
    );
  });

  it('F-2206 AC-13 (c94-wildcard): a wildcard entry for the host asks nothing, the exact entry is appended after it, and the notice appears', async () => {
    await setting('remote.SSH.remotePlatform', {'harn*': 'linux'});
    await openWindow('harness', 'p13');
    await connectedWithin('p13', INSTALL_MILLISECONDS);
    await waitFor(
      'the exact entry to be stored',
      () =>
        JSON.stringify(storedPlatform()) ===
        '{"harn*":"linux","harness":"linux"}',
      30_000,
    );
    deepStrictEqual(
      [asked('p13').picks, asked('p13').notices, storedPlatform()],
      [
        [],
        [[storedNotice('linux'), ["Don't Show Again"]]],
        {'harn*': 'linux', harness: 'linux'},
      ],
    );
  });

  it('F-2206 AC-14 (c94-wrong-exact): an exact entry that says macOS for a Linux host asks nothing, becomes linux, and the notice appears', async () => {
    await setting('remote.SSH.remotePlatform', {harness: 'macOS'});
    await openWindow('harness', 'p14');
    await connectedWithin('p14', INSTALL_MILLISECONDS);
    await waitFor(
      'the entry to become linux',
      () => JSON.stringify(storedPlatform()) === '{"harness":"linux"}',
      30_000,
    );
    deepStrictEqual(
      [asked('p14').picks, asked('p14').notices, storedPlatform()],
      [[], [[storedNotice('linux'), ["Don't Show Again"]]], {harness: 'linux'}],
    );
  });
});

/** The surfaces window `window` wrote since `mark`, in order. */
function surfacesSince(mark: number, window: string): string[] {
  return linesSince(mark, window).map(line => line.surface);
}

/** The surfaces window `window` wrote since `mark`, but its notices. */
function withoutNotices(mark: number, window: string): string[] {
  return surfacesSince(mark, window).filter(surface => surface !== 'notice');
}

describe('the remote platform pick of the commands and the reconnections (card coverage-94)', function () {
  this.timeout(900_000);

  /** Connects window `name` with an entry for the host, and then takes the entry away, so that the next ask is a pick. */
  async function connectedWithoutEntry(name: string): Promise<void> {
    await setting('remote.SSH.remotePlatform', {harness: 'linux'});
    await openConnected(name, INSTALL_MILLISECONDS);
    await setting('remote.SSH.remotePlatform', undefined);
  }

  before(async () => {
    await closeAllButLocal();
    await setting('remote.SSH.remotePlatform', undefined);
    await setting('remote.SSH.useLocalServer', false);
  });

  afterEach(async () => {
    await closeAllButLocal();
    await setting('remote.SSH.remotePlatform', undefined);
    await setting('remote.SSH.useLocalServer', false);
  });

  after(async () => {
    await closeAllButLocal();
    await setting('remote.SSH.remotePlatform', undefined);
    await setting('remote.SSH.useLocalServer', undefined);
  });

  it('F-2206 AC-26 (c94-kill-host): Kill VS Code Server on Host... asks the platform; after Linux it kills and writes no entry, after Escape nothing runs, no dialog shows and no entry is written; in default mode there is no pick', async () => {
    const escape = await runWith('local', 'opensshremotes.cleanRemoteServer', [
      pickHost('harness'),
      pickFor('local', 'dismiss'),
    ]);
    const escaped = [withoutNotices(escape, 'local'), storedPlatform()];
    const linux = await runWith('local', 'opensshremotes.cleanRemoteServer', [
      pickHost('harness'),
      pickFor('local', 'linux'),
    ]);
    const killed = [
      linesSince(linux, 'local').map(line => line.surface),
      linesSince(linux, 'local').find(line => line.surface === 'notice')
        ?.question,
      storedPlatform(),
    ];
    await setting('remote.SSH.useLocalServer', undefined);
    const plain = await runWith('local', 'opensshremotes.cleanRemoteServer', [
      pickHost('harness'),
    ]);
    deepStrictEqual(
      [escaped, killed, surfacesSince(plain, 'local')],
      [
        [['hostPick', 'platformPick'], undefined],
        [
          ['hostPick', 'platformPick', 'notice'],
          'Killed VS Code Server on harness.',
          undefined,
        ],
        ['hostPick', 'notice'],
      ],
    );
  });

  it('F-2206 AC-26 (c94-kill-current): Kill Current VS Code Server asks the platform in a connected window; after Escape the window stays connected with no dialog and no entry, and after Linux the kill completes with no entry', async () => {
    await connectedWithoutEntry('k26');
    const servers = await serverProcesses();
    const escape = await runWith(
      'k26',
      'opensshremotes.cleanCurrentRemoteServer',
      [pickFor('k26', 'dismiss')],
    );
    const escaped = [
      withoutNotices(escape, 'k26'),
      await connected('k26'),
      (await serverProcesses()).length === servers.length,
      storedPlatform(),
    ];
    const linux = await runWith(
      'k26',
      'opensshremotes.cleanCurrentRemoteServer',
      [pickFor('k26', 'linux')],
    );
    await serversGoneWithin(servers, 10_000);
    const lines = linesSince(linux, 'k26');
    deepStrictEqual(
      [
        escaped,
        lines.map(line => line.surface).slice(0, 1),
        lines.find(line => line.surface === 'notice')?.question,
      ],
      [
        [['platformPick'], true, true, undefined],
        ['platformPick'],
        'Killed VS Code Server on harness.',
      ],
    );
  });

  it('F-2206 AC-27 (c94-reconnect): each reconnection of a window without an entry shows the pick again', async () => {
    await connectedWithoutEntry('r27');
    const mark = recordLines().length;
    appendScript([
      pickFor('r27', 'linux'),
      pickFor('r27', 'linux'),
      pickFor('r27', 'linux'),
      ...dismissals('r27'),
    ]);
    cutHostNetwork();
    try {
      await waitFor(
        'two picks while the window reconnects',
        () =>
          linesSince(mark, 'r27').filter(
            line => line.surface === 'platformPick',
          ).length >= 2,
        100_000,
      );
    } finally {
      restoreHostNetwork();
    }
    deepStrictEqual(
      linesSince(mark, 'r27')
        .filter(line => line.surface === 'platformPick')
        .slice(0, 2)
        .map(line => line.question),
      [PLATFORM_QUESTION, PLATFORM_QUESTION],
    );
  });

  it('F-2206 AC-34 (c94-new-window): New Window on Active Host shows the pick in the new window, and Escape there gives the dialog of AC-9', async () => {
    await connectedWithoutEntry('n34');
    const next = nextEmptyName();
    appendScript([pickFor(next, 'dismiss'), ...dismissals(next)]);
    const name = await nextEmptyWindow(() =>
      inWindow('n34', 'opensshremotes.openEmptyWindowOnCurrentHost'),
    );
    await waitFor(
      'the dialog of the new window',
      () => linesOf(name, 'failureDialog').length > 0,
      120_000,
    );
    deepStrictEqual(
      [name, asked(name).picks, asked(name).dialogs, storedPlatform()],
      [
        next,
        [[PLATFORM_QUESTION, ['Linux', 'Windows', 'macOS']]],
        [[CANCELED, DIALOG_BUTTONS]],
        undefined,
      ],
    );
  });
});

describe('the remote platform pick of a typed host and a cut network (card coverage-94)', function () {
  this.timeout(900_000);

  before(async () => {
    await closeAllButLocal();
    await setting('remote.SSH.remotePlatform', undefined);
    await setting('remote.SSH.useLocalServer', false);
  });

  afterEach(async () => {
    restoreHostNetwork();
    await closeAllButLocal();
    await setting('remote.SSH.remotePlatform', undefined);
    await setting('remote.SSH.useLocalServer', false);
  });

  after(async () => {
    await closeAllButLocal();
    await setting('remote.SSH.remotePlatform', undefined);
    await setting('remote.SSH.useLocalServer', undefined);
  });

  it('F-2206 AC-24 (c94-typed-user): a typed user@host names only the host in the pick, only the platform in the notice, and stores the host', async () => {
    const next = nextEmptyName();
    alignScript('local');
    appendScript([
      {...typeHost('harness@harness'), window: 'local'},
      pickFor(next, 'linux'),
    ]);
    await nextEmptyWindow(() =>
      inWindow('local', 'opensshremotes.openEmptyWindow'),
    );
    await waitFor(
      'the platform to be stored',
      () => JSON.stringify(storedPlatform()) === '{"harness":"linux"}',
      INSTALL_MILLISECONDS,
    );
    await waitFor(
      'the notice',
      () => linesOf(next, 'notice').length > 0,
      30_000,
    );
    deepStrictEqual(
      [asked(next).picks, asked(next).notices, storedPlatform()],
      [
        [[PLATFORM_QUESTION, ['Linux', 'Windows', 'macOS']]],
        [[storedNotice('linux'), ["Don't Show Again"]]],
        {harness: 'linux'},
      ],
    );
  });

  it('F-2206 AC-35 (c94-network-cut): with the network cut right after the resolve succeeded, the entry is still written and the notice still appears', async () => {
    appendScript([
      pickFor('c35', 'linux', 'c94-c35-answer'),
      ...dismissals('c35'),
    ]);
    await openWindow('harness', 'c35');
    await waitFor(
      'the pick to be shown',
      () => linesOf('c35', 'platformPick').length > 0,
      60_000,
    );
    const mark = connectionLog().length;
    signal('c94-c35-answer');
    await waitFor(
      'the resolve to succeed',
      () =>
        connectionLog()
          .slice(mark)
          .some(line => line.startsWith('Resolved ssh-remote+harness')),
      INSTALL_MILLISECONDS,
    );
    cutHostNetwork();
    await waitFor(
      'the platform to be stored',
      () => JSON.stringify(storedPlatform()) === '{"harness":"linux"}',
      60_000,
    );
    await waitFor(
      'the notice',
      () => linesOf('c35', 'notice').length > 0,
      60_000,
    );
    deepStrictEqual(
      [asked('c35').notices, storedPlatform()],
      [[[storedNotice('linux'), ["Don't Show Again"]]], {harness: 'linux'}],
    );
  });

  it('F-2206 AC-31 (c94-wrong-wildcard): in default mode a wildcard entry that says windows fails with the dialog, and neither the dialog nor More Actions... names a Windows host or the remotePlatform hint', async () => {
    await setting('remote.SSH.useLocalServer', undefined);
    await setting('remote.SSH.remotePlatform', {'harn*': 'windows'});
    appendScript([
      dialogAnswer('w31', 'More Actions...'),
      {
        surface: 'mitigationPick',
        match: 'Pick an action',
        answer: 'dismiss',
        window: 'w31',
      },
    ]);
    await openWindow('harness', 'w31');
    await waitFor(
      'the pick of actions',
      () => linesOf('w31', 'mitigationPick').length > 0,
      120_000,
    );
    const shown = [
      ...recordLines(undefined, 'w31').flatMap(line => [
        line.question,
        ...(line.items ?? []),
        ...(line.buttons ?? []),
      ]),
    ];
    deepStrictEqual(
      [
        asked('w31').dialogs,
        shown.filter(
          text =>
            text.includes('Detected Windows host') ||
            text.includes('setting correctly reflects the remote platform'),
        ),
      ],
      [[[FAILED, DIALOG_BUTTONS]], []],
    );
  });
});
