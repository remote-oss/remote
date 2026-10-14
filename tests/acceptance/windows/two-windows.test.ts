import {deepStrictEqual, strictEqual} from 'node:assert';
import path from 'node:path';
import {
  acceptedPasswords,
  appendScript,
  closeWindow,
  connectionHelpers,
  emptyWindows,
  heldLines,
  hostPassword,
  inWindow,
  nextEmptyName,
  nextEmptyWindow,
  onHost,
  openWindow,
  recordLines,
  reloadWindow,
  scriptEntries,
  signal,
  windowEvents,
  windowNameOrder,
  windowState,
  withoutActivity,
} from './harness.ts';

/** Waits the given number of milliseconds. */
function pause(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

describe('windows of one editor on the same host (the first window is local)', function () {
  this.timeout(180000);

  /** How many lines the record held when this file began, so that its rows read only their own windows' lines. */
  let recordStart = 0;

  before(() => {
    recordStart = recordLines().length;
    // The windows that open after this write read these entries: the picks they ask are answered from the script.
    scriptEntries([
      {
        surface: 'filePick',
        match: 'Edit custom SSH configuration file',
        answer: 'dismiss',
        window: 'c',
      },
      {
        surface: 'hostPick',
        match: 'Select configured SSH host',
        answer: 'dismiss',
        window: 'c',
      },
    ]);
  });

  it('D-85: a window on the host opens and connects', async () => {
    await openWindow('harness', 'b');
    strictEqual((await windowState('b')).remoteName, 'ssh-remote');
  });

  it('D-85: a second window on the same host shares the connection server', async () => {
    await openWindow('harness', 'c');
    strictEqual((await connectionHelpers()).length, 1);
  });

  it('D-85: reloading a window activates its agent again', async () => {
    await reloadWindow('b');
    strictEqual(
      windowEvents('b').filter(each => each.event === 'activated').length,
      2,
    );
  });

  it('D-85: closing the window that started the server leaves the other connected', async () => {
    await closeWindow('b');
    await inWindow('c', 'acceptance.agent.writeFile', 'still-here.txt', 'c');
    strictEqual(await onHost('cat', '/home/harness/c/still-here.txt'), 'c');
  });

  it("D-85: both windows' progress is in one record, by window", () => {
    deepStrictEqual(
      [
        recordLines('progress', 'b').length > 0,
        recordLines('progress')
          .slice(recordStart)
          .every(line => ['b', 'c'].includes(line.window)),
      ],
      [true, true],
    );
  });

  it('D-85: an empty window opened from a window gets its own name', async () => {
    const localBefore = windowEvents('local').filter(
      each => each.event === 'activated',
    ).length;
    const next = nextEmptyName();
    const known = emptyWindows();
    const name = await nextEmptyWindow(() =>
      inWindow(
        'local',
        'acceptance.agent.openWindow',
        'vscode-remote://ssh-remote+harness/',
      ),
    );
    deepStrictEqual(
      {
        name,
        next,
        empty: emptyWindows(),
        state: withoutActivity(await windowState(name)),
        localActivationsGained:
          windowEvents('local').filter(each => each.event === 'activated')
            .length - localBefore,
      },
      {
        name: next,
        next,
        empty: [...known, next],
        state: {
          remoteName: 'ssh-remote',
          remoteAuthority: 'ssh-remote+harness',
          folders: [],
        },
        localActivationsGained: 0,
      },
    );
    console.log(`      window name order: ${windowNameOrder(name)}`);
    await closeWindow(name);
  });

  it('D-85: the configuration-file pick of Open SSH Configuration File... is answered from the script', async () => {
    await inWindow('c', 'opensshremotes.openConfigFile');
    deepStrictEqual(
      recordLines('filePick', 'c').map(line => [
        line.question,
        line.answer,
        line.matched,
        line.items,
      ]),
      [
        [
          'Edit custom SSH configuration file',
          'dismiss',
          true,
          [
            path.join(process.env.HARNESS_RUN_FOLDER ?? '', 'ssh_config'),
            'Settings',
            'Help',
          ],
        ],
      ],
    );
  });

  let passwordLoginsBefore = 0;

  it('D-85: a held password answer keeps the window waiting until its signal', async () => {
    passwordLoginsBefore = await acceptedPasswords();
    appendScript([
      {
        surface: 'maskedInput',
        match: 'password',
        answer: {text: hostPassword()},
        window: 'h1',
        after: 'h1-go',
      },
    ]);
    await openWindow('password', 'h1');
    const deadline = Date.now() + 60_000;
    while (heldLines('h1').length === 0) {
      if (Date.now() > deadline) {
        throw new Error('window h1 never reached the held password question');
      }
      await pause(200);
    }
    // The connect stays at the password: three seconds on, its question is still the held one, with no answer line after it.
    await pause(3000);
    const heldWhileWaiting = [
      heldLines('h1').length,
      recordLines('maskedInput', 'h1').map(line => line.answer),
    ];
    signal('h1-go');
    // h1 is connected when its connect runs on past the held question to its tunnel.
    const connectedDeadline = Date.now() + 60_000;
    while (
      recordLines('progress', 'h1')
        .map(line => line.question)
        .at(-1) !== 'Setting up SSH tunnel'
    ) {
      if (Date.now() > connectedDeadline) {
        throw new Error(
          `window h1 never reached its tunnel: ${JSON.stringify(recordLines(undefined, 'h1'))}`,
        );
      }
      await pause(500);
    }
    deepStrictEqual(
      [
        heldWhileWaiting,
        recordLines('maskedInput', 'h1').map(line => line.answer),
      ],
      [
        [1, ['held']],
        ['held', '<supplied>'],
      ],
    );
  });

  it('D-85: the host pick of Kill Local Connection Server is answered from the script', async () => {
    await inWindow('c', 'opensshremotes.cleanLocalServer');
    deepStrictEqual(
      recordLines('hostPick', 'c').map(line => [
        line.question,
        line.answer,
        line.matched,
        line.items?.includes('harness'),
        line.items?.at(-2),
        line.items?.at(-1),
      ]),
      [
        [
          'Select configured SSH host or enter user@host',
          'dismiss',
          true,
          true,
          '$(plus) Add New SSH Host...',
          'Configure SSH Hosts...',
        ],
      ],
    );
  });
  it('D-85: one accepted password is counted on the host', async () => {
    const deadline = Date.now() + 30_000;
    let count = await acceptedPasswords();
    while (count !== passwordLoginsBefore + 1) {
      if (Date.now() > deadline) {
        throw new Error(
          `the host counted ${String(count)} accepted passwords, expected ${String(passwordLoginsBefore + 1)}`,
        );
      }
      await pause(500);
      count = await acceptedPasswords();
    }
    await closeWindow('h1');
  });
});
