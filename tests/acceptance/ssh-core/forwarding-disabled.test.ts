import {deepStrictEqual} from 'node:assert';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {
  appendScript,
  closeWindow,
  connectionLog,
  cutHostNetwork,
  hostConnections,
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
  windowState,
} from '../windows/harness.ts';
import {closeAllButLocal} from '../windows/maintenance.ts';
import {notifications, statusItem} from '../windows/renderer.ts';
import {keepingSettings, PLATFORMS} from '../windows/tunnel-support.ts';

/** The notice of a refused SOCKS forward. */
const REFUSED = 'Failed to set up';

/** The text of the log line that names the forwarding setting. */
const SETTING_LINE = 'TCP port forwarding appears to be disabled';

/** The records of the hint store the extension keeps in its global state; none before it writes one. */
function hintRecords(): Array<{
  started: string;
  hints: Array<{status?: string}>;
}> {
  const database = new DatabaseSync(
    path.join(variable('HARNESS_USER_DATA'), 'User/globalStorage/state.vscdb'),
    {readOnly: true},
  );
  try {
    const entry = database
      .prepare('SELECT value FROM ItemTable WHERE key = ?')
      .get('remote-oss.remote-ssh') as {value: string} | undefined;
    const store =
      entry === undefined
        ? undefined
        : ((JSON.parse(entry.value) as Record<string, unknown>)[
            'remote.ssh.hints'
          ] as {records?: ReturnType<typeof hintRecords>} | undefined);
    return store?.records ?? [];
  } finally {
    database.close();
  }
}

/** How many forwarding hints the records that started at or after `since` (an ISO time) hold. */
function forwardingHints(since: string): number {
  return hintRecords()
    .filter(record => record.started >= since)
    .flatMap(record => record.hints)
    .filter(hint => hint.status === 'AllowTcpForwardingDisabled').length;
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
      const empty = await nextEmptyWindow(() =>
        inWindow(name, 'workbench.action.remote.close'),
      );
      const emptyState = await windowState(empty);
      const again = 'c85-close-again';
      await opened('noforward', again);
      await waitFor(
        'the second notice',
        () => recordLines('notice', again).length > 0,
        120_000,
      );
      deepStrictEqual(
        [
          [emptyState.remoteName, emptyState.folders],
          readUserSettings(),
          recordLines(undefined, again).filter(line =>
            line.question.includes('Analyzing'),
          ).length,
          await terminalsOf(again),
        ],
        [[null, []], settings, 0, []],
      );
    });
  });

  it('F-2604 AC-16 (c85-allowed): a host that allows forwarding connects with no refusal notice, no setting line in the log and no hint', async () => {
    await keepingSettings(async () => {
      await userSettings({...PLATFORMS});
      const name = 'c85-allowed';
      const mark = connectionLog().length;
      const since = new Date().toISOString();
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
          forwardingHints(since),
        ],
        [0, false, 0],
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
      const since = new Date().toISOString();
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
          forwardingHints(since),
        ],
        [
          'Could not establish connection to "noall": Connection closed.',
          false,
          0,
        ],
      );
    });
  });

  it("F-2604 AC-17 (c85-disturbed): a cut and restored network, or the end of the window's ssh, leaves the wait as it was, with no new notice, dialog or terminal", async () => {
    const seen: Array<Awaited<ReturnType<typeof waitingOf>>> = [];
    const ended: string[] = [];
    for (const disturbance of ['network', 'ssh']) {
      await closeAllButLocal();
      await keepingSettings(async () => {
        await userSettings({...PLATFORMS});
        const name = `c85-${disturbance}`;
        await opened('noforward', name);
        await waitFor(
          'the notice',
          () => recordLines('notice', name).length > 0,
          120_000,
        );
        if (disturbance === 'network') {
          cutHostNetwork();
          try {
            await new Promise(resolve => setTimeout(resolve, 20_000));
          } finally {
            restoreHostNetwork();
          }
        } else {
          for (const connection of await hostConnections()) {
            if (connection.program === 'ssh') {
              process.kill(connection.processId);
              ended.push('ssh');
            }
          }
        }
        await new Promise(resolve => setTimeout(resolve, 20_000));
        seen.push(await waitingOf(name));
      });
    }
    deepStrictEqual(
      [seen, ended.length > 0],
      [
        [
          [1, 0, [], 'Opening Remote...', true],
          [1, 0, [], 'Opening Remote...', true],
        ],
        true,
      ],
    );
  });
});
