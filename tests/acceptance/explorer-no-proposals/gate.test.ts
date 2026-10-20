/**
 * @fileoverview The recorded gate row 8 of explorer slice 1 (card coverage-25b, #645): without the proposed API the
 * core drops the view, the family's setup notice in the record, when any, is the one that names the explorer, and
 * nothing fails.
 */

import {deepStrictEqual} from 'node:assert';
import {inWindow, recordLines} from '../windows/harness.ts';
import {notifications, viewRows} from '../windows/renderer.ts';

/** The launch's first window and the view the core drops without the proposal. */
const LOCAL = 'local';
const VIEW = 'Remotes (Tunnels/SSH)';

/** The explorer id the family setup notice offers, as explorer-03b's `familySetupPortsOf` lists it. */
const EXPLORER_ID = 'remote-oss.remote-explorer';

/** What running `command` in `local` gave: it finished, or it failed with this message. */
async function outcomeOf(
  command: string,
  ...parameters: unknown[]
): Promise<string> {
  try {
    await inWindow(LOCAL, command, ...parameters);
    return 'done';
  } catch (caught) {
    return caught instanceof Error ? caught.message : String(caught);
  }
}

describe('the gate row of explorer slice 1 in the explorer-no-proposals launch (card coverage-25b, row 8)', function () {
  this.timeout(180_000);

  it('contracts §3.4: F-3903 §5 rule 4, F-5001: without the proposals the view is dropped, nothing fails, and the family setup notice covers the explorer', async () => {
    await outcomeOf('remote-explorer.refresh');
    await outcomeOf('opensshremotes.openEmptyWindow', {host: 'harness'});
    const view = await viewRows(LOCAL, VIEW);
    const notices = recordLines('notice', LOCAL);
    const toasts = await notifications(LOCAL);
    deepStrictEqual(
      {
        viewDropped: view === undefined,
        noticesAtMostOne: notices.length <= 1,
        noticesCoverExplorer: notices.every(
          notice =>
            notice.question.startsWith(
              'Remote - SSH needs proposed VS Code APIs that',
            ) && notice.question.includes(`'${EXPLORER_ID}'`),
        ),
        failingToasts: toasts.filter(toast =>
          ['Error', 'error', 'not found', 'failed'].some(word =>
            toast.includes(word),
          ),
        ),
      },
      {
        viewDropped: true,
        noticesAtMostOne: true,
        noticesCoverExplorer: true,
        failingToasts: [],
      },
    );
  });
});
