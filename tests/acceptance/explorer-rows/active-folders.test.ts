/**
 * @fileoverview F-2501 AC-36 (card coverage-100, tooling-107): the push of the active folders that Remote - SSH makes to
 * Remote Explorer when the first resolve of a window with a folder ends. The explorer records each push its inbox
 * receives; the rows read that record, and the Remotes view for the history of the hosts.
 */

import {deepStrictEqual} from 'node:assert';
import {
  appendScript,
  closeWindow,
  companionCalls,
  connectedWithin,
  inWindow,
  nextEmptyWindow,
  onHost,
  openWindow,
  recordLines,
  waitFor,
} from '../windows/harness.ts';
import {INSTALL_MILLISECONDS} from '../windows/maintenance.ts';
import {rememberPage, toggleRow, viewRows} from '../windows/renderer.ts';
import {VIEW} from '../windows/explorer-rows.ts';

/** The command of the push. */
const PUSH = 'remote-internal.setActiveFolders';

/** The command that shows the Remotes view. */
const SHOW_REMOTE_EXPLORER = 'workbench.view.remote';

/** How long the rows leave a window, after its first resolve ended, for a second push to come. */
const SETTLE_MILLISECONDS = 8000;

/** How long a window with no folder is watched for a push, as the criterion says. */
const EMPTY_WINDOW_MILLISECONDS = 30_000;

/** The pushes recorded after the first `count` of them. */
function pushesSince(count: number): ReturnType<typeof companionCalls> {
  return companionCalls(PUSH).slice(count);
}

/** The folders the local window's Remotes view lists under the host `host`, by their paths; none when it has no row. */
async function historyOf(host: string): Promise<string[]> {
  await inWindow('local', SHOW_REMOTE_EXPLORER);
  let rows = (await viewRows('local', VIEW)) ?? [];
  const row = rows.find(each => each.level === 2 && each.label === host);
  if (row?.expanded === false) {
    await toggleRow('local', VIEW, host);
    rows = (await viewRows('local', VIEW)) ?? [];
  }
  const at = rows.findIndex(each => each.level === 2 && each.label === host);
  const folders: string[] = [];
  for (const each of rows.slice(at + 1)) {
    if (at === -1 || each.level <= 2) {
      break;
    }
    folders.push(each.description);
  }
  return folders;
}

describe('the push of the active folders (card coverage-100, F-2501 AC-36)', function () {
  this.timeout(600_000);

  before(() => rememberPage('local'));

  it('F-2501 AC-36 (c100-connected): a window with a folder on a reachable alias makes one push when its first resolve ends, and a window on the same alias with no folder makes none within 30 s', async () => {
    await onHost('mkdir', '-p', '/home/harness/af36a');
    const before = companionCalls(PUSH).length;
    await openWindow('harness', 'af36a');
    try {
      await connectedWithin('af36a', INSTALL_MILLISECONDS);
      await waitFor('the push', () => pushesSince(before).length > 0, 30_000);
      await new Promise(resolve => setTimeout(resolve, SETTLE_MILLISECONDS));
      const pushes = pushesSince(before);
      // The reader sees the history of a host that connected, so an empty one means something in the next row.
      await waitFor(
        'the folder in the history of the connected host',
        async () =>
          (await historyOf('harness')).includes('/home/harness/af36a'),
        30_000,
      );
      const afterFolder = companionCalls(PUSH).length;
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
        deepStrictEqual(
          [pushes.map(push => push.envelope), pushesSince(afterFolder).length],
          [
            [
              {
                interfaceVersion: {major: 1, minor: 0},
                outcome: 'connected',
                hostKey: 'harness',
              },
            ],
            0,
          ],
        );
      } finally {
        await closeWindow(empty).catch(() => undefined);
      }
    } finally {
      await closeWindow('af36a').catch(() => undefined);
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
    await openWindow('refused', 'af36b');
    try {
      await waitFor(
        'the failure dialog',
        () => recordLines('failureDialog', 'af36b').length > 0,
        120_000,
      );
      await new Promise(resolve => setTimeout(resolve, SETTLE_MILLISECONDS));
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
    } finally {
      await closeWindow('af36b').catch(() => undefined);
    }
  });
});
