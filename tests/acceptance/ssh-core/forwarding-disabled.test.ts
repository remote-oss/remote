import {deepStrictEqual} from 'node:assert';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {
  appendScript,
  closeWindow,
  connectionLog,
  cutHostNetwork,
  emptyWindows,
  inWindow,
  nextEmptyWindow,
  openWindow,
  readUserSettings,
  recordLines,
  restoreHostNetwork,
  terminalsOf,
  userSettings,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {closeAllButLocal} from '../windows/maintenance.ts';
import {notifications, statusItem} from '../windows/renderer.ts';
import {keepingSettings, PLATFORMS} from '../windows/tunnel-support.ts';

/** The notice of a refused SOCKS forward. */
const REFUSED = 'Failed to set up';

/** The text of the log line that names the forwarding setting. */
const SETTING_LINE = 'TCP port forwarding appears to be disabled';

/** The hint store the extension keeps in its global state; none before it writes one. */
function hintStore(): unknown {
  const database = new DatabaseSync(
    path.join(variable('HARNESS_USER_DATA'), 'User/globalStorage/state.vscdb'),
    {readOnly: true},
  );
  try {
    const entry = database
      .prepare('SELECT value FROM ItemTable WHERE key = ?')
      .get('remote-oss.remote-ssh') as {value: string} | undefined;
    return entry === undefined
      ? undefined
      : (JSON.parse(entry.value) as Record<string, unknown>)[
          'remote.ssh.hints'
        ];
  } finally {
    database.close();
  }
}

/** Opens window `name` on `alias` with the notice of a refusal answered by dismissing it. */
async function opened(alias: string, name: string): Promise<void> {
  appendScript([
    {surface: 'notice', match: REFUSED, answer: 'dismiss', window: name},
  ]);
  await openWindow(alias, name);
}

/** What window `name` shows of its wait: the notice count, the dialog count, the terminals and the indicator. */
async function waitingOf(
  name: string,
): Promise<[number, number, string[] | undefined, string, boolean]> {
  return [
    recordLines('notice', name).length,
    recordLines('failureDialog', name).length,
    await terminalsOf(name),
    (await statusItem(name, 'status.host')).text,
    (await notifications(name)).some(text => text.includes('Waiting for port')),
  ];
}

describe('F-2604: TCP forwarding disabled on the server', function () {
  this.timeout(900_000);
  beforeEach(closeAllButLocal);

  it('F-2604 AC-4, AC-6 (c85-wait): the refusal shows the notice with the waiting progress, no dialog and no terminal, and three minutes later the window still waits', async () => {
    await keepingSettings(async () => {
      await userSettings({...PLATFORMS});
      const name = 'c85-wait';
      await opened('noforward', name);
      await waitFor(
        'the notice',
        () => recordLines('notice', name).length > 0,
        120_000,
      );
      const together = await waitingOf(name);
      await new Promise(resolve => setTimeout(resolve, 180_000));
      deepStrictEqual(
        [together, await waitingOf(name)],
        [
          [1, 0, [], 'Opening Remote...', true],
          [1, 0, [], 'Opening Remote...', true],
        ],
      );
    });
  });

  it('F-2604 AC-7 (c85-close): Close Remote Connection leaves an empty local window with the settings unchanged, and connecting again repeats the refusal with no analysis notice and no terminal', async () => {
    await keepingSettings(async () => {
      await userSettings({...PLATFORMS});
      const name = 'c85-close';
      await opened('noforward', name);
      await waitFor(
        'the notice',
        () => recordLines('notice', name).length > 0,
        120_000,
      );
      const settings = readUserSettings();
      const before = emptyWindows();
      const empty = await nextEmptyWindow(() =>
        inWindow(name, 'workbench.action.remote.close'),
      );
      const again = 'c85-close-again';
      await opened('noforward', again);
      await waitFor(
        'the second notice',
        () => recordLines('notice', again).length > 0,
        120_000,
      );
      deepStrictEqual(
        [
          before.includes(empty),
          readUserSettings(),
          recordLines().filter(line => line.question.includes('Analyzing'))
            .length,
          await terminalsOf(again),
        ],
        [false, settings, 0, []],
      );
    });
  });

  it('F-2604 AC-16 (c85-allowed): a host that allows forwarding connects with no refusal notice, no setting line in the log and no hint', async () => {
    await keepingSettings(async () => {
      await userSettings({...PLATFORMS});
      const name = 'c85-allowed';
      const mark = connectionLog().length;
      await opened('harness', name);
      await waitFor(
        'the connection',
        () =>
          recordLines('progressEnd', name).length > 0 ||
          recordLines('notice', name).length > 0,
        120_000,
      );
      await new Promise(resolve => setTimeout(resolve, 10_000));
      deepStrictEqual(
        [
          recordLines('notice', name).length,
          connectionLog()
            .slice(mark)
            .some(
              line =>
                line.includes(SETTING_LINE) ||
                line.includes('administratively prohibited'),
            ),
          hintStore(),
        ],
        [0, false, undefined],
      );
      await closeWindow(name).catch(() => undefined);
    });
  });

  it('F-2604 AC-12 (c85-both): with every forward refused over a socket, the dialog says the connection closed, with no setting line and no hint', async () => {
    await keepingSettings(async () => {
      await userSettings({
        ...PLATFORMS,
        'remote.SSH.remoteServerListenOnSocket': true,
      });
      const name = 'c85-both';
      appendScript([
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
      ]);
      const mark = connectionLog().length;
      await openWindow('noall', name);
      await waitFor(
        'the dialog',
        () => recordLines('failureDialog', name).length > 0,
        120_000,
      );
      deepStrictEqual(
        [
          recordLines('failureDialog', name)[0]?.question,
          connectionLog()
            .slice(mark)
            .some(line => line.includes(SETTING_LINE)),
          hintStore(),
        ],
        [
          'Could not establish connection to "noall": Connection closed.',
          false,
          undefined,
        ],
      );
    });
  });

  it('F-2604 AC-17 (c85-network): a cut and restored network leaves the wait as it was, with no new notice, dialog or terminal', async () => {
    await keepingSettings(async () => {
      await userSettings({...PLATFORMS});
      const name = 'c85-network';
      await opened('noforward', name);
      await waitFor(
        'the notice',
        () => recordLines('notice', name).length > 0,
        120_000,
      );
      cutHostNetwork();
      try {
        await new Promise(resolve => setTimeout(resolve, 20_000));
      } finally {
        restoreHostNetwork();
      }
      await new Promise(resolve => setTimeout(resolve, 20_000));
      deepStrictEqual(await waitingOf(name), [
        1,
        0,
        [],
        'Opening Remote...',
        true,
      ]);
    });
  });
});
