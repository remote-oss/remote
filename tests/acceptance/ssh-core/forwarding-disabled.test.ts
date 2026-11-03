import {deepStrictEqual} from 'node:assert';
import {
  appendScript,
  closeWindow,
  connectionHelpers,
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
  waitFor,
  windowEvents,
  windowState,
} from '../windows/harness.ts';
import {closeAllButLocal, dismissals} from '../windows/maintenance.ts';
import {outputPanelFocused, statusItem} from '../windows/renderer.ts';
import {hintRecords, type HintRecords} from '../windows/hint-store.ts';
import {keepingSettings, PLATFORMS} from '../windows/tunnel-support.ts';

/** The notice of a refused SOCKS forward. */
const REFUSED = 'Failed to set up';

/** The text of the log line that names the forwarding setting. */
const SETTING_LINE = 'TCP port forwarding appears to be disabled';

/** The whole line, as the criterion words it. */
const SETTING_TEXT =
  'ERROR: TCP port forwarding appears to be disabled on the remote host. Ensure that the sshd_config has `AllowTcpForwarding yes`. Contact your system administrator if needed.';

/** The forwarding hints of the records that started at or after `since` (an ISO time). */
function forwardingEntries(since: string): HintRecords[number]['hints'] {
  return hintRecords()
    .filter(record => record.started >= since)
    .flatMap(record => record.hints)
    .filter(hint => hint.status === 'AllowTcpForwardingDisabled');
}

/** How many forwarding hints the records that started at or after `since` hold. */
function forwardingHints(since: string): number {
  return forwardingEntries(since).length;
}

/** The reason the dialog gives for a refused forward: S046 without its "ERROR: " lead. */
const REFUSED_REASON = SETTING_TEXT.replace(/^ERROR: /u, '');

/** Opens window `name` on `alias` with the notice of a refusal and the dialog and the pick after it dismissed. */
async function opened(alias: string, name: string): Promise<void> {
  appendScript([
    {surface: 'notice', match: REFUSED, answer: 'dismiss', window: name},
    ...dismissals(name),
  ]);
  await openWindow(alias, name);
}

/** What window `name` shows of its failure: the notice count, the dialog count and the indicator. */
async function failureOf(name: string): Promise<[number, number, string]> {
  return [
    recordLines('notice', name).length,
    recordLines('failureDialog', name).length,
    (await statusItem(name, 'status.host')).text,
  ];
}

/** The first failure dialog's text of window `name`. */
function dialogText(name: string): string | undefined {
  return recordLines('failureDialog', name)[0]?.question;
}

/** Waits until window `name` shows its failure dialog; a wait that runs out says what the log of the connection held. */
async function dialogOf(name: string): Promise<void> {
  try {
    await waitFor(
      'the failure dialog',
      () => recordLines('failureDialog', name).length > 0,
      120_000,
    );
  } catch (error) {
    const held = connectionLog().slice(-30).join('\n');
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}; the last lines of the connection log:\n${held}\nthe helpers: ${JSON.stringify(await connectionHelpers())}`,
      {cause: error},
    );
  }
}

/** The dialog the refusal of `noforward` gives, as the record has it. */
function refusedDialog(alias: string): string {
  return `Could not establish connection to "${alias}": ${REFUSED_REASON}`;
}

describe('F-2604: TCP forwarding disabled on the server', function () {
  this.timeout(900_000);
  beforeEach(async () => {
    await closeAllButLocal();
    // A window opened within the grace of the last local connection server would join it instead of starting its own.
    await waitFor(
      'the local connection server of the earlier row to end',
      async () => (await connectionHelpers()).length === 0,
      60_000,
    );
  });

  it('F-2604 AC-4, AC-6 (ruling-1985-forwarding-fails): the refusal shows the notice, and the connect then fails with F-2601’s dialog that names the refused forward, with no wait', async () => {
    await keepingSettings(async () => {
      await userSettings({...PLATFORMS});
      const name = 'c85-wait';
      await opened('noforward', name);
      await dialogOf(name);
      deepStrictEqual(
        [await failureOf(name), dialogText(name)],
        [
          [1, 1, 'Disconnected from SSH: noforward'],
          refusedDialog('noforward'),
        ],
      );
    });
  });

  it('F-2604 AC-7 (c85-close): Close Remote Connection after the failure leaves an empty local window with the settings unchanged, and connecting again repeats the refusal with the dialog and no analysis notice', async () => {
    await keepingSettings(async () => {
      await userSettings({...PLATFORMS});
      const name = 'c85-close';
      await opened('noforward', name);
      await dialogOf(name);
      const settings = readUserSettings();
      const empty = await nextEmptyWindow(() =>
        inWindow(name, 'workbench.action.remote.close'),
      );
      const emptyState = await windowState(empty);
      const again = 'c85-close-again';
      await opened('noforward', again);
      await dialogOf(again);
      deepStrictEqual(
        [
          [emptyState.remoteName, emptyState.folders],
          readUserSettings(),
          recordLines(undefined, again).filter(line =>
            line.question.includes('Analyzing'),
          ).length,
          dialogText(again),
        ],
        [[null, []], settings, 0, refusedDialog('noforward')],
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

  it("F-2604 AC-17 (c85-disturbed): a cut and restored network, or the end of the window's ssh, after the failure adds no notice or dialog", async () => {
    const seen: Array<Awaited<ReturnType<typeof failureOf>>> = [];
    const ended: string[] = [];
    for (const disturbance of ['network', 'ssh']) {
      await closeAllButLocal();
      await keepingSettings(async () => {
        await userSettings({...PLATFORMS});
        const name = `c85-${disturbance}`;
        await opened('noforward', name);
        await dialogOf(name);
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
        seen.push(await failureOf(name));
      });
    }
    deepStrictEqual(
      [seen.map(entry => entry.slice(0, 2)), ended.length > 0],
      [
        [
          [1, 1],
          [1, 1],
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

  it('F-2604 AC-1, AC-2, AC-3, AC-5, AC-22 (c85-line): the log holds the setting line once, directly after the first refused-channel line; the hint is stored when the dialog shows; Show log puts the Remote - SSH channel in front', async () => {
    await keepingSettings(async () => {
      await userSettings({...PLATFORMS});
      const name = 'c85-line';
      const mark = connectionLog().length;
      const since = new Date().toISOString();
      await opened('noforward', name);
      await dialogOf(name);
      const stored = forwardingEntries(since);
      await new Promise(resolve => setTimeout(resolve, 5_000));
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
          stored: stored.map(hint => [
            hint.kind,
            hint.status,
            hint.message,
            hint.mitigations,
          ]),
          documents: stored.map(hint => hint.resources?.length),
          channel,
          focused: await outputPanelFocused(name),
          dialog: dialogText(name),
        },
        {
          after: true,
          lines: 1,
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
          dialog: refusedDialog('noforward'),
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
      await dialogOf(name);
      await new Promise(resolve => setTimeout(resolve, 5_000));
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

  it('F-2604 AC-9, AC-18 (ruling-1985-forwarding-fails): with the second ssh the window shows the failure dialog with the refused-forward reason, and the log holds the setting line', async () => {
    await keepingSettings(async () => {
      await userSettings({...PLATFORMS, 'remote.SSH.useExecServer': false});
      const name = 'c85-second';
      const mark = connectionLog().length;
      await opened('noforward', name);
      await dialogOf(name);
      await new Promise(resolve => setTimeout(resolve, 5_000));
      deepStrictEqual(
        [
          dialogText(name),
          connectionLog()
            .slice(mark)
            .filter(line => line.includes(SETTING_LINE)).length,
        ],
        [refusedDialog('noforward'), 1],
      );
    });
  });

  it('F-2604 AC-20 (c85-key): a key whose authorized_keys line forbids port forwarding gives the setting line, the dialog of AC-4 and the stored hint', async () => {
    await keepingSettings(async () => {
      await userSettings({...PLATFORMS});
      const name = 'c85-key';
      const mark = connectionLog().length;
      const since = new Date().toISOString();
      await opened('noforward-key', name);
      await dialogOf(name);
      await new Promise(resolve => setTimeout(resolve, 5_000));
      deepStrictEqual(
        {
          lines: connectionLog()
            .slice(mark)
            .filter(line => line.includes(SETTING_LINE)).length,
          dialog: dialogText(name),
          stored: forwardingHints(since),
        },
        {
          lines: 1,
          dialog: refusedDialog('noforward-key'),
          stored: 1,
        },
      );
    });
  });

  it('F-2604 AC-19 (ruling-1985-forwarding-fails): a host whose key changed, with every setting at its default, fails the connect at once with S107’s reason and the MitmPortForwardingDisabled hint, and no server-side port forwarding text, setting line or hint', async () => {
    await keepingSettings(async () => {
      await userSettings({...PLATFORMS});
      const name = 'c85-changed';
      const mark = connectionLog().length;
      const since = new Date().toISOString();
      await opened('changedkey', name);
      await dialogOf(name);
      await new Promise(resolve => setTimeout(resolve, 5_000));
      deepStrictEqual(
        {
          lines: connectionLog()
            .slice(mark)
            .filter(line => line.includes(SETTING_LINE)).length,
          dialog: dialogText(name),
          stored: hintRecords()
            .filter(record => record.started >= since)
            .flatMap(record => record.hints)
            .filter(hint => hint.kind === 'error')
            .map(hint => hint.status),
        },
        {
          lines: 0,
          dialog:
            'Could not establish connection to "changedkey": Port forwarding is disabled.',
          stored: ['MitmPortForwardingDisabled'],
        },
      );
    });
  });

  /** Opens window `name` on `changedkey` and gives its failure dialog line, the hint of kind error the connect stored and the time it took. */
  async function changedKeyFailure(
    name: string,
    settings: Record<string, unknown>,
  ) {
    return keepingSettings(async () => {
      await userSettings({...PLATFORMS, ...settings});
      const since = new Date().toISOString();
      appendScript([...dismissals(name)]);
      const started = Date.now();
      await openWindow('changedkey', name);
      await waitFor(
        'the failure dialog',
        () => recordLines('failureDialog', name).length > 0,
        120_000,
      );
      const [dialog] = recordLines('failureDialog', name);
      await new Promise(resolve => setTimeout(resolve, 2000));
      return {
        dialog: [dialog?.question, dialog?.buttons],
        waited: Date.now() - started,
        hints: hintRecords()
          .filter(record => record.started >= since)
          .flatMap(record => record.hints)
          .filter(hint => hint.kind === 'error')
          .map(hint => [hint.status, hint.details]),
      };
    });
  }

  it('F-2604 AC-13, AC-14 (c123-mitm): with the local server off and the dynamic forward at its default, a host whose key changed fails at once with Port forwarding is disabled and F-2601’s buttons, and the hint store holds the error', async () => {
    const found = await changedKeyFailure('c123-mitm', {
      'remote.SSH.useLocalServer': false,
    });
    deepStrictEqual(
      [found.dialog, found.waited < 60_000, found.hints],
      [
        [
          'Could not establish connection to "changedkey": Port forwarding is disabled.',
          ['Close Remote', 'Retry', 'More Actions...'],
        ],
        true,
        [['MitmPortForwardingDisabled', 'Port forwarding is disabled']],
      ],
    );
  });

  it('F-2604 AC-13 (c123-mitm-second): the same with the dynamic forward off, on the second ssh', async () => {
    const found = await changedKeyFailure('c123-mitm-second', {
      'remote.SSH.useLocalServer': false,
      'remote.SSH.enableDynamicForwarding': false,
    });
    deepStrictEqual(
      [found.dialog, found.hints],
      [
        [
          'Could not establish connection to "changedkey": Port forwarding is disabled.',
          ['Close Remote', 'Retry', 'More Actions...'],
        ],
        [['MitmPortForwardingDisabled', 'Port forwarding is disabled']],
      ],
    );
  });

  it('F-2604 AC-15 (c85-reload): after a reload of the failed window with the local server running the refusal fails the connect again, and the log does not repeat the setting line', async () => {
    await keepingSettings(async () => {
      await userSettings({...PLATFORMS});
      const name = 'c85-reload';
      await opened('noforward', name);
      await dialogOf(name);
      const mark = connectionLog().length;
      await reloadWindow(name);
      await waitFor(
        'the second dialog',
        () => recordLines('failureDialog', name).length > 1,
        120_000,
      );
      await new Promise(resolve => setTimeout(resolve, 5_000));
      deepStrictEqual(
        [
          connectionLog()
            .slice(mark)
            .filter(line => line.includes(SETTING_LINE)).length,
          recordLines('failureDialog', name).map(line => line.question),
        ],
        [0, [refusedDialog('noforward'), refusedDialog('noforward')]],
      );
    });
  });
});
