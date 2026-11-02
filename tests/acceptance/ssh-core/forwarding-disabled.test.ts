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
  reloadWindow,
  restoreHostNetwork,
  terminalsOf,
  userSettings,
  variable,
  waitFor,
  windowEvents,
  windowState,
} from '../windows/harness.ts';
import {closeAllButLocal} from '../windows/maintenance.ts';
import {
  notifications,
  outputPanelFocused,
  statusItem,
} from '../windows/renderer.ts';
import {keepingSettings, PLATFORMS} from '../windows/tunnel-support.ts';

/** The notice of a refused SOCKS forward. */
const REFUSED = 'Failed to set up';

/** The text of the log line that names the forwarding setting. */
const SETTING_LINE = 'TCP port forwarding appears to be disabled';

/** The whole line, as the criterion words it. */
const SETTING_TEXT =
  'ERROR: TCP port forwarding appears to be disabled on the remote host. Ensure that the sshd_config has `AllowTcpForwarding yes`. Contact your system administrator if needed.';

/** The records of the hint store the extension keeps in its global state; none before it writes one. */
function hintRecords(): Array<{
  started: string;
  hints: Array<{
    kind?: string;
    status?: string;
    message?: string;
    mitigations?: string[];
    resources?: string[];
  }>;
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

/** The forwarding hints of the records that started at or after `since` (an ISO time). */
function forwardingEntries(
  since: string,
): ReturnType<typeof hintRecords>[number]['hints'] {
  return hintRecords()
    .filter(record => record.started >= since)
    .flatMap(record => record.hints)
    .filter(hint => hint.status === 'AllowTcpForwardingDisabled');
}

/** How many hints of kind `error` the records that started at or after `since` hold, whatever their status. */
function errorHints(since: string): number {
  return hintRecords()
    .filter(record => record.started >= since)
    .flatMap(record => record.hints)
    .filter(hint => hint.kind === 'error').length;
}

/** How many forwarding hints the records that started at or after `since` hold. */
function forwardingHints(since: string): number {
  return forwardingEntries(since).length;
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

  /** The entry AC-3 describes, with the documentation address the extension points to. */
  const FORWARDING_ENTRY = {
    status: 'AllowTcpForwardingDisabled',
    kind: 'error',
    message:
      "The remote server's SSH configuration may have TCP forwarding disabled",
    mitigations: [
      "Add the setting 'AllowTcpForwarding yes' to the server's '/etc/ssh/sshd_config' (or similar) configuration file",
      'Restart the SSH server on the remote machine to apply any changes to the configuration',
    ],
  };

  it('F-2604 AC-1, AC-2, AC-3, AC-5, AC-22 (c85-line): the log holds the setting line once, directly after the first refused-channel line; the hint is stored while the window still waits; Show log puts the Remote - SSH channel in front', async () => {
    await keepingSettings(async () => {
      await userSettings({...PLATFORMS});
      const name = 'c85-line';
      const mark = connectionLog().length;
      const since = new Date().toISOString();
      await opened('noforward', name);
      await waitFor(
        'the notice',
        () => recordLines('notice', name).length > 0,
        120_000,
      );
      const stored = forwardingEntries(since);
      await new Promise(resolve => setTimeout(resolve, 15_000));
      await inWindow(name, 'opensshremotes.showLog');
      await windowState(name);
      const logged = connectionLog().slice(mark);
      const first = logged.findIndex(line =>
        line.includes('administratively prohibited'),
      );
      const channel = windowEvents(name)
        .filter(entry => entry.event === 'state')
        .at(-1)?.visibleOutputChannel;
      deepStrictEqual(
        {
          after: logged[first + 1] === SETTING_TEXT,
          lines: logged.filter(line => line.includes(SETTING_LINE)).length,
          refusals:
            logged.filter(line => line.includes('administratively prohibited'))
              .length > 1,
          stored: stored.map(hint => [
            hint.kind,
            hint.status,
            hint.message,
            hint.mitigations,
          ]),
          documents: stored.map(hint => hint.resources?.length),
          channel,
          focused: await outputPanelFocused(name),
          waiting: (await waitingOf(name))[4],
        },
        {
          after: true,
          lines: 1,
          refusals: true,
          stored: [
            [
              FORWARDING_ENTRY.kind,
              FORWARDING_ENTRY.status,
              FORWARDING_ENTRY.message,
              FORWARDING_ENTRY.mitigations,
            ],
          ],
          documents: [1],
          channel: 'Remote - SSH',
          focused: true,
          waiting: true,
        },
      );
    });
  });

  it('F-2604 AC-10, AC-21 (c85-plain): with the second ssh and no enhanced session logs the setting line is logged, no terminal opens and the hint is stored', async () => {
    await keepingSettings(async () => {
      await userSettings({
        ...PLATFORMS,
        'remote.SSH.useExecServer': false,
        'remote.SSH.experimental.enhancedSessionLogs': false,
      });
      const name = 'c85-plain';
      const mark = connectionLog().length;
      const since = new Date().toISOString();
      await opened('noforward', name);
      await waitFor(
        'the notice',
        () => recordLines('notice', name).length > 0,
        120_000,
      );
      await new Promise(resolve => setTimeout(resolve, 10_000));
      deepStrictEqual(
        [
          connectionLog()
            .slice(mark)
            .filter(line => line.includes(SETTING_LINE)).length,
          await terminalsOf(name),
          forwardingHints(since),
        ],
        [1, [], 1],
      );
    });
  });

  it('F-2604 AC-9, AC-18 (c85-second): with the second ssh the window shows no failure dialog and keeps Opening Remote..., and the log holds the setting line', async () => {
    await keepingSettings(async () => {
      await userSettings({...PLATFORMS, 'remote.SSH.useExecServer': false});
      const name = 'c85-second';
      const mark = connectionLog().length;
      await opened('noforward', name);
      await waitFor(
        'the notice',
        () => recordLines('notice', name).length > 0,
        120_000,
      );
      await new Promise(resolve => setTimeout(resolve, 10_000));
      deepStrictEqual(
        [
          recordLines('failureDialog', name).length,
          (await statusItem(name, 'status.host')).text,
          connectionLog()
            .slice(mark)
            .filter(line => line.includes(SETTING_LINE)).length,
        ],
        [0, 'Opening Remote...', 1],
      );
    });
  });

  it('F-2604 AC-20 (c85-key): a key whose authorized_keys line forbids port forwarding gives the setting line, the wait of AC-4 and the stored hint', async () => {
    await keepingSettings(async () => {
      await userSettings({...PLATFORMS});
      const name = 'c85-key';
      const mark = connectionLog().length;
      const since = new Date().toISOString();
      await opened('noforward-key', name);
      await waitFor(
        'the notice',
        () => recordLines('notice', name).length > 0,
        120_000,
      );
      await new Promise(resolve => setTimeout(resolve, 10_000));
      deepStrictEqual(
        {
          lines: connectionLog()
            .slice(mark)
            .filter(line => line.includes(SETTING_LINE)).length,
          waiting: await waitingOf(name),
          stored: forwardingHints(since),
        },
        {
          lines: 1,
          waiting: [1, 0, [], 'Opening Remote...', true],
          stored: 1,
        },
      );
    });
  });

  it('F-2604 AC-19 (c85-changed): a host whose key changed, with every setting at its default, gives the wait of AC-4: no dialog, no port forwarding text, no setting line and no forwarding hint', async () => {
    await keepingSettings(async () => {
      await userSettings({...PLATFORMS});
      const name = 'c85-changed';
      const mark = connectionLog().length;
      const since = new Date().toISOString();
      await opened('changedkey', name);
      await waitFor(
        'the notice',
        () => recordLines('notice', name).length > 0,
        120_000,
      );
      await new Promise(resolve => setTimeout(resolve, 10_000));
      deepStrictEqual(
        {
          lines: connectionLog()
            .slice(mark)
            .filter(line => line.includes(SETTING_LINE)).length,
          waiting: await waitingOf(name),
          stored: errorHints(since),
          text: recordLines(undefined, name).filter(line =>
            line.question.includes('Port forwarding is disabled'),
          ).length,
        },
        {
          lines: 0,
          waiting: [1, 0, [], 'Opening Remote...', true],
          stored: 0,
          text: 0,
        },
      );
    });
  });

  it('F-2604 AC-15 (c85-reload): after a reload with the local server running the window waits again and the log does not repeat the setting line', async () => {
    await keepingSettings(async () => {
      await userSettings({...PLATFORMS});
      const name = 'c85-reload';
      await opened('noforward', name);
      await waitFor(
        'the notice',
        () => recordLines('notice', name).length > 0,
        120_000,
      );
      const mark = connectionLog().length;
      await reloadWindow(name);
      await new Promise(resolve => setTimeout(resolve, 20_000));
      deepStrictEqual(
        [
          connectionLog()
            .slice(mark)
            .filter(line => line.includes(SETTING_LINE)).length,
          (await statusItem(name, 'status.host')).text,
          (await waitingOf(name))[4],
        ],
        [0, 'Opening Remote...', true],
      );
    });
  });
});
