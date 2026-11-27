/**
 * @fileoverview F-2501 AC-36 (card coverage-100, tooling-107): the push of the active folders that Remote - SSH makes to
 * Remote Explorer when the first resolve of a window with a folder ends. The explorer records each push its inbox
 * receives; the rows read that record, and the Remotes view for the history of the hosts.
 */

import {deepStrictEqual} from 'node:assert';
import {
  appendScript,
  callCommand,
  closeWindow,
  commandEventsSince,
  companionCalls,
  connectedWithin,
  hostAliases,
  inWindow,
  nextEmptyWindow,
  onHost,
  openWindow,
  recordLines,
  waitFor,
  windowEvents,
} from '../windows/harness.ts';
import {
  rememberPage,
  titleAction,
  toggleRow,
  viewRows,
} from '../windows/renderer.ts';
import {rowsOf, rowsSettled, VIEW} from '../windows/explorer-rows.ts';
import {explainedFailure, section} from '../windows/connect-failure.ts';

/** The command of the push. */
const PUSH = 'remote-internal.setActiveFolders';

/** The command that shows the Remotes view. */
const SHOW_REMOTE_EXPLORER = 'workbench.view.remote';

/** How long the rows leave a window, after its first resolve ended, for a second push to come. */
const SETTLE_MILLISECONDS = 8000;

/** How long a window with no folder is watched for a push, as the criterion says. */
const EMPTY_WINDOW_MILLISECONDS = 30_000;

/**
 * The connect's allowance in the rows: the row's other waits (its opens, its reads, its one Refresh before the history
 * read, its close, and the check of each that may outstay its own deadline) sum to 418 s at their bounds, so the
 * connect's 120 s and its own 60 s check keep the row's sum 2 s under its 600 s timeout.
 */
const CONNECT_MILLISECONDS = 120_000;

/**
 * How long a row gives the push after its window's first resolve ended: the push is the resolve's own end, so by the
 * time the window stands connected a push that is still missing is not a slow one.
 */
const PUSH_MILLISECONDS = 20_000;

/**
 * A row's failure with what the push reached and what its windows said: the wait's own message first, then the pushes
 * the explorer's inbox recorded since the row began (the push has no log line of its own: one that cannot be delivered
 * is dropped without one, so the inbox record is the evidence of it, a line past the row's push wait is a late one, and
 * none is a lost or unsent one), then each window's last reported state and its agent's events, and a read that fails
 * is told in its place.
 */
function rowReadout(
  caught: unknown,
  windows: readonly string[],
  since: number,
): Promise<Error> {
  const inbox = section(
    `the pushes the explorer's inbox recorded since the row began`,
    () => {
      const pushes = companionCalls(PUSH).filter(call => call.time >= since);
      if (pushes.length === 0) {
        return 'none';
      }
      return pushes
        .map(
          call =>
            `[+${((call.time - since) / 1000).toFixed(1)} s] ${JSON.stringify(
              call.envelope,
            )}`,
        )
        .join('\n');
    },
  );
  const windowsReport = windows
    .flatMap(name => [
      section(`the state ${name} last reported`, () => {
        const states = windowEvents(name).filter(
          each => each.event === 'state' && each.time >= since,
        );
        const last = states.at(-1);
        if (last === undefined) {
          return 'the window reported no state';
        }
        const count = `its agent reported its state ${String(states.length)} times since the row began`;
        return `remoteName ${last.remoteName ?? 'none'}, remoteAuthority ${last.remoteAuthority ?? 'none'}, remoteSshActive ${String(last.remoteSshActive === true)}, ${count}`;
      }),
      section(`the events ${name}'s agent reported since the row began`, () => {
        const lines = commandEventsSince(name, since);
        return lines.length === 0 ? 'none' : lines.join('\n');
      }),
    ])
    .join('\n');
  const report = `${inbox}\n${windowsReport}`;
  return explainedFailure(caught, () => Promise.resolve(report));
}

/** The pushes recorded after the first `count` of them. */
function pushesSince(count: number): ReturnType<typeof companionCalls> {
  return companionCalls(PUSH).slice(count);
}

/**
 * The folders the local window's Remotes view lists under the host `host`, by their paths; none when it has no row. The
 * view stands shown by the caller: showing it in here would put a command wait behind every read the row makes.
 */
async function historyOf(host: string): Promise<string[]> {
  let rows = (await viewRows('local', VIEW)) ?? [];
  const hostRow = rows.find(each => each.level === 2 && each.label === host);
  if (hostRow?.expanded === false) {
    await toggleRow('local', VIEW, host);
    rows = (await viewRows('local', VIEW)) ?? [];
  }
  const hostAt = rows.findIndex(
    each => each.level === 2 && each.label === host,
  );
  const folders: string[] = [];
  for (const each of rows.slice(hostAt + 1)) {
    if (hostAt === -1 || each.level <= 2) {
      break;
    }
    folders.push(each.description);
  }
  return folders;
}

describe('the push of the active folders (card coverage-100, F-2501 AC-36)', function () {
  this.timeout(600_000);

  before(() => rememberPage('local'));

  // The two halves of the criterion run as two rows: the waits of one half alone (the connect, a window's open and
  // the closes) add past the row's own timeout on a slow machine, and the part's own limit cannot stand two such rows.
  it('F-2501 AC-36 (c100-connected): a window with a folder on a reachable alias makes one push when its first resolve ends, and the history of the connected host shows the folder', async () => {
    await onHost('mkdir', '-p', '/home/harness/af36a');
    const before = companionCalls(PUSH).length;
    const rowStart = Date.now();
    await inWindow('local', SHOW_REMOTE_EXPLORER);
    await openWindow('harness', 'af36a');
    try {
      await connectedWithin('af36a', CONNECT_MILLISECONDS);
      await waitFor(
        'the push',
        () => pushesSince(before).length > 0,
        PUSH_MILLISECONDS,
      );
      await new Promise(resolve => setTimeout(resolve, SETTLE_MILLISECONDS));
      const pushes = pushesSince(before);
      // F-5104 BR-11: the local window's view takes no cross-window update — the push lands in the explorer's
      // record, but this window's rows show it only after its own Refresh (ruling-2684-no-cross-window).
      await inWindow('local', 'remote-explorer.refresh');
      await waitFor(
        'the folder in the history of the connected host',
        async () =>
          (await historyOf('harness')).includes('/home/harness/af36a'),
        30_000,
      );
      deepStrictEqual(
        pushes.map(push => push.envelope),
        [
          {
            interfaceVersion: {major: 1, minor: 0},
            outcome: 'connected',
            hostKey: 'harness',
          },
        ],
      );
    } catch (caught) {
      throw await rowReadout(caught, ['local', 'af36a'], rowStart);
    } finally {
      await closeWindow('af36a').catch(() => undefined);
    }
  });

  it('F-2501 AC-36 (c100-empty): a window on the same alias with no folder makes no push within 30 s', async () => {
    await inWindow('local', SHOW_REMOTE_EXPLORER);
    const before = companionCalls(PUSH).length;
    const empty = await nextEmptyWindow(() =>
      inWindow(
        'local',
        'acceptance.agent.openWindow',
        'vscode-remote://ssh-remote+harness',
      ),
    );
    try {
      await new Promise(resolve =>
        setTimeout(resolve, EMPTY_WINDOW_MILLISECONDS),
      );
      deepStrictEqual(pushesSince(before).length, 0);
    } finally {
      await closeWindow(empty).catch(() => undefined);
    }
  });

  it('F-2501 AC-36 (c100-failed): a window with a folder on an alias that refuses makes one push when its first resolve fails, and the Remotes view keeps no entry for the folder under that host', async () => {
    appendScript([
      {
        surface: 'failureDialog',
        match: 'Could not establish connection',
        answer: 'dismiss',
        window: 'af36b',
      },
      {
        surface: 'mitigationPick',
        match: 'Pick an action',
        answer: 'dismiss',
        window: 'af36b',
      },
    ]);
    const before = companionCalls(PUSH).length;
    const rowStart = Date.now();
    await inWindow('local', SHOW_REMOTE_EXPLORER);
    await openWindow('refused', 'af36b');
    try {
      await waitFor(
        'the failure dialog',
        () => recordLines('failureDialog', 'af36b').length > 0,
        120_000,
      );
      await new Promise(resolve => setTimeout(resolve, SETTLE_MILLISECONDS));
      // F-5104 BR-11: the local window's view takes no cross-window update — the clause reads the history after the
      // window's own Refresh (ruling-2684-no-cross-window).
      await inWindow('local', 'remote-explorer.refresh');
      deepStrictEqual(
        [
          pushesSince(before).map(push => push.envelope),
          await historyOf('refused'),
        ],
        [
          [
            {
              interfaceVersion: {major: 1, minor: 0},
              outcome: 'failed',
              hostKey: 'refused',
            },
          ],
          [],
        ],
      );
    } catch (caught) {
      throw await rowReadout(caught, ['local', 'af36b'], rowStart);
    } finally {
      await closeWindow('af36b').catch(() => undefined);
    }
  });
  it('F-5902 AC-19 (push-not-mark): (reading-1809-harness-push) a push of the outcome connected for a listed host, while the companion’s query answers none, marks no row connected before or after Refresh', async () => {
    const hosts = hostAliases();
    await inWindow('local', SHOW_REMOTE_EXPLORER);
    await rowsSettled('local', rowsOf(hosts, undefined));
    const before = companionCalls(PUSH).length;
    const answer = await callCommand('local', PUSH, {
      interfaceVersion: {major: 1, minor: 0},
      outcome: 'connected',
      hostKey: hosts[0],
    });
    async function marked(): Promise<string[]> {
      return ((await viewRows('local', VIEW)) ?? [])
        .filter(each => each.description === 'connected')
        .map(each => each.label);
    }
    const seen = [await marked()];
    await new Promise(resolve => setTimeout(resolve, SETTLE_MILLISECONDS));
    seen.push(await marked());
    await titleAction('local', VIEW, 'Refresh');
    await new Promise(resolve => setTimeout(resolve, SETTLE_MILLISECONDS));
    seen.push(await marked());
    deepStrictEqual(
      [answer.rejection, pushesSince(before).length, seen],
      [undefined, 1, [[], [], []]],
    );
  });
});
