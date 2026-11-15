/**
 * @fileoverview The ssh_config keywords newer than the runners' OpenSSH (card #2600, F-2109): the launch's Remote - SSH
 * runs the pinned client through `remote.SSH.path`, and each row runs plain `ssh` through the same path first.
 */

import {deepStrictEqual} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {
  connectWith,
  launchSsh,
  MODES,
  plainSsh,
} from '../windows/config-keywords-support.ts';
import {
  activeEditorOf,
  activeEditorTextOf,
  connectionLog,
  dirtyDocumentsOf,
  inWindow,
  onHostAs,
  recordLines,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {editorHasFocus, statusItem} from '../windows/renderer.ts';

/** The text the untitled editor of the reconnect row holds. */
const UNSAVED = 'unsaved text of c2600';

/** The longest the reconnect row waits for the window to connect again once its connection has ended. */
const RECONNECT_MILLISECONDS = 60_000;

/** What ssh prints when ChannelTimeout closes the session channel of the connection. */
const CHANNEL_CLOSED = 'seconds of inactivity';

/** A line the connection log gains once per connect of a window, the reconnection's included. */
const CONNECTED_LINE = 'Remote server listening on port';

/** How many connects the connection log holds so far. */
function connects(): number {
  return connectionLog().filter(line => line.includes(CONNECTED_LINE)).length;
}

/** The process id of the shell in the active terminal of window `name`, which the shell itself prints into a file of the host. */
async function shellOf(name: string): Promise<string> {
  const file = `/home/harness/c2600-shell-${String(Date.now())}`;
  await inWindow(name, 'workbench.action.terminal.sendSequence', {
    text: `echo $$ > ${file}.tmp && mv ${file}.tmp ${file}\n`,
  });
  let shell = '';
  await waitFor(
    `the shell of ${name} to write ${file}`,
    async () => {
      shell = (await onHostAs('harness', 'cat', file).catch(() => '')).trim();
      return shell !== '';
    },
    30_000,
  );
  return shell;
}

describe('ssh_config keywords newer than the runners’ OpenSSH (card #2600)', function () {
  this.timeout(300_000);

  it('contracts harness: the launch’s remote.SSH.path is the pinned client the run built, and it reports OpenSSH 10.6p2', () => {
    const client = launchSsh();
    const version = spawnSync(client, ['-V'], {encoding: 'utf8'});
    deepStrictEqual(
      [client, version.status, version.stderr.startsWith('OpenSSH_10.6p2,')],
      [variable('HARNESS_SSH_CLIENT'), 0, true],
      version.stderr,
    );
  });

  it('F-2109 AC-7 (c2593-refuse): RefuseConnection shows the dialog without a reason in either mode, the text is not shown and the log holds ssh’s line', async () => {
    const results = [];
    for (const {mode, settings} of MODES) {
      const alias = `c2593-refuse-${mode}`;
      results.push(
        await connectWith(
          alias,
          ['RefuseConnection "c2593-refused-text"'],
          'fails',
          async (outcome, file) => ({
            plain: (await plainSsh(file, alias)).status,
            dialog: outcome.dialog,
            toasts: outcome.toasts,
            logged: outcome.connectLog.some(line =>
              line.includes('c2593-refused-text'),
            ),
          }),
          {
            settings: {
              ...settings,
              'remote.SSH.remotePlatform': {[alias]: 'linux'},
            },
          },
        ),
      );
    }
    deepStrictEqual(
      results,
      MODES.map(({mode}) => ({
        plain: 255,
        dialog: `Could not establish connection to "c2593-refuse-${mode}".`,
        toasts: [],
        logged: true,
      })),
    );
  });

  it('F-2109 AC-19 (c2593-weak-default): KexAlgorithms restricted to a non-post-quantum method the server offers, with WarnWeakCrypto at its default, connects with no notification and no dialog', async () => {
    const result = await connectWith(
      'c2593-weak-default',
      ['KexAlgorithms curve25519-sha256'],
      'connects',
      async (outcome, file) => ({
        outcome,
        plain: await plainSsh(file, 'c2593-weak-default'),
      }),
    );
    deepStrictEqual(
      [result.plain.status, result.outcome.toasts, result.outcome.dialog],
      [0, [], undefined],
      result.plain.stderr,
    );
  });

  it('F-2109 AC-19 (c2593-weak-no-pq): the same with WarnWeakCrypto no-pq-kex', async () => {
    const result = await connectWith(
      'c2593-weak-no-pq',
      ['KexAlgorithms curve25519-sha256', 'WarnWeakCrypto no-pq-kex'],
      'connects',
      async (outcome, file) => ({
        outcome,
        plain: await plainSsh(file, 'c2593-weak-no-pq'),
      }),
    );
    deepStrictEqual(
      [result.plain.status, result.outcome.toasts, result.outcome.dialog],
      [0, [], undefined],
      result.plain.stderr,
    );
  });

  it('F-2109 AC-15 (c2600-channel-timeout): when ssh ends after the connect (ChannelTimeout closes its session channel, then the host ends the connection), the window reconnects by itself with no dialog, shows Reconnecting to SSH and then SSH again, and keeps the terminal’s shell, the unsaved text and the focus', async () => {
    const alias = 'c2600-timeout';
    const result = await connectWith(
      alias,
      ['ChannelTimeout session=5s'],
      'connects',
      async () => {
        await inWindow(alias, 'workbench.action.terminal.new');
        const shellBefore = await shellOf(alias);
        await inWindow(alias, 'acceptance.agent.openUntitled', UNSAVED);
        await waitFor(
          'the untitled editor to be unsaved',
          async () => (await dirtyDocumentsOf(alias)).length > 0,
          15_000,
        );
        const before = {
          editor: await activeEditorOf(alias),
          focused: await editorHasFocus(alias),
        };
        const mark = Date.now();
        // ChannelTimeout closes the session channel, but the window's forwarded channels keep ssh running: the host
        // then ends the connection, as a server does, so ssh ends on its own after a successful connect.
        const channelClosed = await waitFor(
          'ChannelTimeout to close the session channel',
          () => connectionLog().some(line => line.includes(CHANNEL_CLOSED)),
          30_000,
        ).then(
          () => true,
          () => false,
        );
        const connectsBefore = connects();
        const ended = await onHostAs(
          'root',
          'pkill',
          '-TERM',
          'sshd-session',
        ).then(
          () => 'ended',
          (error: unknown) => String(error),
        );
        const endedAt = Date.now();
        const indicators = new Set<string>();
        await waitFor(
          'the window to connect again',
          async () => {
            indicators.add((await statusItem(alias, 'status.host')).text);
            return connects() > connectsBefore;
          },
          RECONNECT_MILLISECONDS,
        ).catch(() => undefined);
        const reconnected = connects() > connectsBefore;
        const droppedAfter = Math.round((Date.now() - endedAt) / 1000);
        await waitFor(
          'the indicator to read SSH again',
          async () => {
            const text = (await statusItem(alias, 'status.host')).text;
            indicators.add(text);
            return text === `SSH: ${alias}`;
          },
          30_000,
        ).catch(() => undefined);
        const after = {
          editor: await activeEditorOf(alias),
          focused: await editorHasFocus(alias),
        };
        return {
          reconnected,
          droppedAfter,
          channelClosed,
          ended,
          indicators: [...indicators].sort(),
          dialogs: recordLines('failureDialog', alias)
            .filter(line => line.time >= mark)
            .map(line => line.question),
          sameFocus: after.editor === before.editor && after.focused,
          focusedBefore: before.focused,
          text: await activeEditorTextOf(alias),
          sameShell: (await shellOf(alias)) === shellBefore,
          lastLines: connectionLog().slice(-8),
        };
      },
    );
    deepStrictEqual(
      [
        result.reconnected,
        result.indicators,
        result.dialogs,
        result.focusedBefore,
        result.sameFocus,
        result.text,
        result.sameShell,
      ],
      [
        true,
        [`Reconnecting to SSH: ${alias}...`, `SSH: ${alias}`],
        [],
        true,
        true,
        UNSAVED,
        true,
      ],
      `session channel closed: ${String(result.channelClosed)}; the host's sessions: ${result.ended}; ${String(result.droppedAfter)} s from the end to the reconnect; the log's last lines: ${JSON.stringify(result.lastLines)}`,
    );
  });
});
