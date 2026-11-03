/**
 * @fileoverview The active-folders command run by a key with no argument in set C0 (card coverage-102, part 3c,
 * F-5001 AC-11): the command is the companion's push, so a key can reach it with nothing to report.
 */

import {deepStrictEqual} from 'node:assert';
import {bindKeys} from '../windows/explorer-folders.ts';
import {VIEW} from '../windows/explorer-rows.ts';
import {
  closeWindow,
  extensionActive,
  inWindow,
  nextEmptyWindow,
  waitFor,
} from '../windows/harness.ts';
import {
  dialogOf,
  notifications,
  pressControlAlt,
  rememberPage,
  viewRows,
} from '../windows/renderer.ts';

const EXPLORER = 'remote-oss.remote-explorer';

/** The command of the push of the active folders. */
const PUSH = 'remote-internal.setActiveFolders';

/** The key bound to it. */
const PUSH_KEY = 'z';

/** How long a new window stays untouched before the row asks whether the explorer is active. */
const UNTOUCHED_MILLISECONDS = 20_000;

describe('the active-folders command by a key in set C0 (card coverage-102, part 3c)', function () {
  this.timeout(240_000);

  before(() => rememberPage('local'));

  it('F-5001 AC-11 (push-key): in a window without the companion the key activates the explorer with no notification, no error and no dialog, and the view is unchanged', async () => {
    const restore = await bindKeys([
      {key: `ctrl+alt+${PUSH_KEY}`, command: PUSH},
    ]);
    const window = await nextEmptyWindow(() =>
      inWindow('local', 'workbench.action.newWindow'),
    );
    try {
      await new Promise(resolve => setTimeout(resolve, UNTOUCHED_MILLISECONDS));
      const before = [
        await extensionActive(window, EXPLORER),
        await viewRows(window, VIEW),
      ];
      await pressControlAlt(window, PUSH_KEY);
      await waitFor(
        `the explorer to activate in window ${window}`,
        () => extensionActive(window, EXPLORER),
        20_000,
      );
      await new Promise(resolve => setTimeout(resolve, 3_000));
      deepStrictEqual(
        [
          before,
          await notifications(window),
          await dialogOf(window),
          await viewRows(window, VIEW),
        ],
        [[false, undefined], [], undefined, undefined],
      );
    } finally {
      restore();
      await closeWindow(window);
    }
  });
});
