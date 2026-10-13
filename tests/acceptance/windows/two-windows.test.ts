import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {deepStrictEqual, strictEqual} from 'node:assert';
import path from 'node:path';
import {
  closeWindow,
  emptyWindows,
  inWindow,
  nextEmptyName,
  nextEmptyWindow,
  onHost,
  openWindow,
  recordLines,
  reloadWindow,
  scriptEntries,
  windowEvents,
  windowNameOrder,
  windowState,
} from './harness.ts';

const execFileAsync = promisify(execFile);

/** How many connection-helper processes of this run's extensions folder run on this machine. */
async function connectionHelpers(): Promise<number> {
  try {
    const {stdout} = await execFileAsync('pgrep', [
      '-fc',
      `${process.env.HARNESS_RUN_FOLDER ?? ''}/extensions/.*connection-helper`,
    ]);
    return Number(stdout.trim());
  } catch {
    return 0;
  }
}

describe('windows of one editor on the same host (the first window is local)', function () {
  this.timeout(180000);

  before(() => {
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
    strictEqual(await connectionHelpers(), 1);
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
      ['b', 'c'].map(window => recordLines('progress', window).length > 0),
      [true, true],
    );
  });

  it('D-85: an empty window opened from a window gets its own name', async () => {
    const localBefore = windowEvents('local').filter(
      each => each.event === 'activated',
    ).length;
    const next = nextEmptyName();
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
        state: await windowState(name),
        localActivationsGained:
          windowEvents('local').filter(each => each.event === 'activated')
            .length - localBefore,
      },
      {
        name: 'empty-1',
        next: 'empty-1',
        empty: ['empty-1'],
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
});
