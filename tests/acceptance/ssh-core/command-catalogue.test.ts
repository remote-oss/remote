/**
 * @fileoverview F-2006's palette listings of Remote - SSH in the window states of the spec (card #2815): the rows that a
 * window state shows, the settings that change the listing, and the remote indicator's menu. Each row compares the
 * listing with the spec's list as it stands, in order, and a listing that came back empty fails it.
 */

import {deepStrictEqual} from 'node:assert';
import {
  appendScript,
  connectionLog,
  onHost,
  openWindow,
  recordLines,
  readUserSettings,
  restoreUserSettings,
  userSettings,
  waitFor,
} from '../windows/harness.ts';
import {
  CONNECTED_ENTRIES,
  indicatorGroups,
  LOCAL_ENTRIES,
  remoteSshEntries,
} from '../windows/activation-support.ts';
import {
  closeAllButLocal,
  dismissals,
  openConnected,
  platformAnswer,
} from '../windows/maintenance.ts';
import {explainedFailure} from '../windows/connect-failure.ts';
import {pauseHost, unpauseHost} from '../windows/outage.ts';
import {
  emptyLocalWindow,
  emptyRemoteWindow,
  failedWindow,
  indicatorReads,
} from '../windows/window-states.ts';
import {paletteItems} from '../windows/palette.ts';
import {
  answerDialog,
  dialogOf,
  indicatorDisconnects,
  keybindingRows,
  statusBarText,
} from '../windows/renderer.ts';

/** What core's dialog says when it ends a reconnection. */
const GIVEN_UP = 'Cannot reconnect. Please reload the window.';

/** The 14 "Remote-SSH:" entries of a disconnected SSH window with the default settings (F-2006 AC-5, 6.2 step 2). */
const DISCONNECTED_ENTRIES: readonly string[] = [
  'Remote-SSH: Add New SSH Host...',
  'Remote-SSH: Clear previous session metadata (used for enhanced error reporting)',
  'Remote-SSH: Connect Current Window to Host...',
  'Remote-SSH: Connect to Host...',
  'Remote-SSH: Get Started with SSH',
  'Remote-SSH: Help',
  'Remote-SSH: Kill Local Connection Server For Host...',
  'Remote-SSH: Kill VS Code Server on Host...',
  'Remote-SSH: Open SSH Configuration File...',
  'Remote-SSH: Provide Feedback',
  'Remote-SSH: Report Issue...',
  'Remote-SSH: Settings',
  'Remote-SSH: Show Log',
  'Remote-SSH: Uninstall VS Code Server from Host...',
];

/** The row that only a connected window with `remote.SSH.enableWebAccess` shows (F-2006 6.3 step 2). */
const WEB_UI = 'Remote-SSH: Open Web UI';

/** The row of the local connection server, which `remote.SSH.useLocalServer` false takes away (F-2006 6.3 step 1). */
const KILL_LOCAL = 'Remote-SSH: Kill Local Connection Server For Host...';

/** `entries` with `WEB_UI` between "Open SSH Configuration File..." and "Provide Feedback". */
function withWebUi(entries: readonly string[]): string[] {
  const position = entries.indexOf('Remote-SSH: Provide Feedback');
  return [...entries.slice(0, position), WEB_UI, ...entries.slice(position)];
}

describe('the Remote-SSH command catalogue in the palette (F-2006, card #2815)', function () {
  this.timeout(600_000);

  let saved: string | undefined;
  let baseline: string | undefined;

  before(async () => {
    saved = readUserSettings();
    await userSettings({
      'remote.SSH.remotePlatform': {
        harness: 'linux',
        refused: 'linux',
        nowhere: 'linux',
      },
    });
    baseline = readUserSettings();
  });

  afterEach(async () => {
    await closeAllButLocal();
    restoreUserSettings(baseline);
  });

  after(() => {
    restoreUserSettings(saved);
  });

  it('F-2006 AC-1 (c2815-local-empty): an empty local window with the default settings lists the 13 rows of 5.0 step 2 in order, and "New Window on Active Host", "Provide Feedback", "Kill Current VS Code Server" and "Open Web UI" are absent', async () => {
    const name = await emptyLocalWindow();
    const entries = await remoteSshEntries(name);
    deepStrictEqual(
      [
        entries,
        [
          'Remote-SSH: New Window on Active Host',
          'Remote-SSH: Provide Feedback',
          'Remote-SSH: Kill Current VS Code Server',
          WEB_UI,
        ].filter(absent => entries.includes(absent)),
      ],
      [LOCAL_ENTRIES, []],
    );
  });

  it('F-2006 AC-3 (c2815-connected-folder): a window connected to an SSH host with a folder lists the 15 rows of the connected window, with "Get Started with SSH" and "Open Web UI" absent', async () => {
    await openConnected('c2815-folder');
    deepStrictEqual(await remoteSshEntries('c2815-folder'), CONNECTED_ENTRIES);
  });

  it('F-2006 AC-4 (c2815-connected-empty): a window connected to an SSH host without a folder lists the same 15 rows', async () => {
    const name = await emptyRemoteWindow();
    deepStrictEqual(await remoteSshEntries(name), CONNECTED_ENTRIES);
  });

  it('F-2006 AC-6 (c2815-failed): a window whose first connection failed, the host refusing the connection or its name not resolving, lists the 14 rows of AC-5', async () => {
    await failedWindow('refused', 'c2815-refused');
    await failedWindow('nowhere', 'c2815-nowhere');
    deepStrictEqual(
      [
        await remoteSshEntries('c2815-refused'),
        await remoteSshEntries('c2815-nowhere'),
      ],
      [DISCONNECTED_ENTRIES, DISCONNECTED_ENTRIES],
    );
  });

  it('F-2006 AC-6 (c2815-cancelled-at-pick): a window whose first connection was cancelled at the platform pick, with remote.SSH.useLocalServer false and no stored platform, ends with "Connecting was canceled." and lists the 13 rows of AC-5 for those settings', async () => {
    await userSettings({
      'remote.SSH.remotePlatform': undefined,
      'remote.SSH.useLocalServer': false,
    });
    appendScript([
      {
        ...platformAnswer('dismiss'),
        match: 'Select the platform',
        window: 'c2815-cancelled',
      },
      ...dismissals('c2815-cancelled'),
    ]);
    await openWindow('harness', 'c2815-cancelled');
    await waitFor(
      'the failure dialog of c2815-cancelled',
      () => recordLines('failureDialog', 'c2815-cancelled').length > 0,
      120_000,
    );
    await indicatorDisconnects('c2815-cancelled', 5000);
    deepStrictEqual(
      [
        recordLines('failureDialog', 'c2815-cancelled').map(
          line => line.question,
        ),
        await remoteSshEntries('c2815-cancelled'),
      ],
      [
        [
          'Could not establish connection to "harness": Connecting was canceled.',
        ],
        DISCONNECTED_ENTRIES.filter(entry => entry !== KILL_LOCAL),
      ],
    );
  });

  it('F-2006 AC-7 (c2815-local-server-setting): saving remote.SSH.useLocalServer false takes "Kill Local Connection Server For Host..." out of the palette without a reload, and removing the key brings it back', async () => {
    const name = await emptyLocalWindow();
    const before = await remoteSshEntries(name);
    const without = LOCAL_ENTRIES.filter(entry => entry !== KILL_LOCAL);
    await userSettings({'remote.SSH.useLocalServer': false});
    const absent = await listedUntil(
      name,
      entries => !entries.includes(KILL_LOCAL),
    );
    await userSettings({'remote.SSH.useLocalServer': undefined});
    const back = await listedUntil(name, entries =>
      entries.includes(KILL_LOCAL),
    );
    deepStrictEqual(
      [before, absent, back],
      [LOCAL_ENTRIES, without, LOCAL_ENTRIES],
    );
  });

  it('F-2006 AC-8 (c2815-web-ui-setting): saving remote.SSH.enableWebAccess true in a connected window adds "Open Web UI" between "Open SSH Configuration File..." and "Provide Feedback" without a reload', async () => {
    await openConnected('c2815-web');
    const before = await remoteSshEntries('c2815-web');
    await userSettings({'remote.SSH.enableWebAccess': true});
    const on = await listedUntil('c2815-web', entries =>
      entries.includes(WEB_UI),
    );
    deepStrictEqual(
      [before, on],
      [CONNECTED_ENTRIES, withWebUi(CONNECTED_ENTRIES)],
    );
  });

  it('F-2006 AC-9 (c2815-web-ui-absent): with remote.SSH.enableWebAccess true, "Open Web UI" is absent in a local window and in a disconnected SSH window', async () => {
    await userSettings({'remote.SSH.enableWebAccess': true});
    const local = await emptyLocalWindow();
    await failedWindow('refused', 'c2815-web-refused');
    deepStrictEqual(
      [
        await remoteSshEntries(local),
        await remoteSshEntries('c2815-web-refused'),
      ],
      [LOCAL_ENTRIES, DISCONNECTED_ENTRIES],
    );
  });

  it('F-2006 AC-11 (c2815-connecting): a window still connecting, its indicator reading Opening Remote..., lists no Remote-SSH command, while its palette lists other commands', async () => {
    await userSettings({'remote.SSH.connectTimeout': 120});
    appendScript(dismissals('c2815-connecting'));
    await openWindow('blackhole', 'c2815-connecting');
    await indicatorReads('c2815-connecting', 'Opening Remote', 60_000);
    deepStrictEqual(
      [
        (await paletteItems('c2815-connecting', 'Remote-SSH')).filter(label =>
          label.startsWith('Remote-SSH: '),
        ),
        (await paletteItems('c2815-connecting', 'Reload Window')).length > 0,
      ],
      [[], true],
    );
  });

  it('F-2006 AC-25 (c2815-keybindings): the Keyboard Shortcuts editor filtered by Remote-SSH lists the 17 commands and none of them shows a keybinding', async () => {
    const name = await emptyLocalWindow();
    const rows = await keybindingRows(name, 'Remote-SSH');
    deepStrictEqual(
      {
        count: rows.length,
        unnamed: rows.filter(each => each.command === '').length,
        withKeybinding: rows
          .filter(each => each.keybinding !== '')
          .map(each => `${each.command}: ${each.keybinding}`),
      },
      {count: 17, unnamed: 0, withKeybinding: []},
    );
  });

  it('F-2006 AC-13 (c2815-indicator-menu): the remote indicator menu of a connected window still holds "Connect to Host..." and "Connect Current Window to Host..." in the group "Remote-SSH"', async () => {
    await openConnected('c2815-menu');
    deepStrictEqual((await indicatorGroups('c2815-menu')).slice(0, 2), [
      {label: 'Connect to Host...', separator: 'Remote-SSH'},
      {label: 'Connect Current Window to Host...', separator: ''},
    ]);
  });
  it('F-2006 AC-24 (c2815-reconnecting): a connected window with the default settings whose packets stop lists the 14 rows of AC-5, "Get Started with SSH" present and "New Window on Active Host" and "Kill Current VS Code Server" absent, while its indicator reads Reconnecting', async () => {
    await openConnected('c2815-reconnecting');
    pauseHost();
    try {
      await indicatorReads(
        'c2815-reconnecting',
        'Reconnecting to SSH: harness',
        120_000,
      );
      deepStrictEqual(
        await remoteSshEntries('c2815-reconnecting'),
        DISCONNECTED_ENTRIES,
      );
    } finally {
      unpauseHost();
    }
  });

  it('F-2006 AC-5 (c2815-given-up): an SSH window whose reconnection was refused, so that core gave it up for good and the user chose Cancel, lists the 14 rows of AC-5 with the default settings, and the 13 rows without the local connection server once remote.SSH.useLocalServer is false', async () => {
    await userSettings({'window.dialogStyle': 'custom'});
    await openConnected('c2815-given-up');
    pauseHost();
    try {
      await indicatorReads(
        'c2815-given-up',
        'Reconnecting to SSH: harness',
        120_000,
      );
    } finally {
      unpauseHost();
    }
    // The reconnection that comes now finds no server of the connection: core is refused and gives the window up.
    await onHost(
      'sh',
      '-c',
      "pkill -u harness -f '[.]vscodium-server-insiders/' || true",
    );
    await waitFor(
      'the dialog that ends the reconnection',
      async () => (await dialogOf('c2815-given-up'))?.details === GIVEN_UP,
      480_000,
    ).catch(async (caught: unknown) => {
      throw await explainedFailure(caught, async () =>
        [
          await statusBarText('c2815-given-up', 'status.host'),
          JSON.stringify(await dialogOf('c2815-given-up')),
          connectionLog({withTimes: true}).slice(-15).join('\n'),
        ].join('\n'),
      );
    });
    await answerDialog('c2815-given-up', 'Cancel');
    await indicatorReads(
      'c2815-given-up',
      'Disconnected from SSH: harness',
      30_000,
    );
    const givenUp = await remoteSshEntries('c2815-given-up');
    await userSettings({'remote.SSH.useLocalServer': false});
    const without = await listedUntil(
      'c2815-given-up',
      entries => !entries.includes(KILL_LOCAL),
    );
    deepStrictEqual(
      [givenUp, without],
      [
        DISCONNECTED_ENTRIES,
        DISCONNECTED_ENTRIES.filter(entry => entry !== KILL_LOCAL),
      ],
    );
  });
});

/** The palette's Remote-SSH entries of window `name` once they meet `condition`, read again until they do. */
async function listedUntil(
  name: string,
  condition: (entries: string[]) => boolean,
): Promise<string[]> {
  let seen: string[] = [];
  await waitFor(
    `the palette of ${name} to meet the condition`,
    async () => {
      seen = await remoteSshEntries(name);
      return condition(seen);
    },
    30_000,
  ).catch((caught: unknown) => {
    throw new Error(`${String(caught)}; it listed ${JSON.stringify(seen)}`, {
      cause: caught,
    });
  });
  return seen;
}
