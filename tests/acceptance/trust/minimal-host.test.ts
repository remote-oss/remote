/**
 * @fileoverview The untrusted-folder connect on the account whose login `PATH` holds no `bash` (card #2877, F-2703
 * part 1, the part 1 row of this launch): core's trust question left open while the connect runs, and the window's
 * state after the question is refused.
 */

import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  connectedWithin,
  isTrusted,
  openWindow,
} from '../windows/harness.ts';
import {INSTALL_MILLISECONDS} from '../windows/maintenance.ts';
import {
  answerDialog,
  dialogOf,
  pageText,
  statusItemText,
  waitForDialog,
} from '../windows/renderer.ts';

describe('the untrusted-folder connect on the account without bash (card #2877, F-2703)', function () {
  this.timeout(300_000);

  it('F-2703 AC-26 (c2877-trust): the connect on the no-bash account with the trust question left open still reaches the indicator, and after refusing the trust stays connected in Restricted Mode', async () => {
    await openWindow('nobash', 'c2877-trust', 'harness-nobash');
    try {
      await waitForDialog('c2877-trust');
      // The question is left open: the connect runs behind it.
      await connectedWithin('c2877-trust', INSTALL_MILLISECONDS, 'harness-nobash');
      await new Promise(resolve => setTimeout(resolve, 2000));
      const whileHeld = [
        await statusItemText('c2877-trust', 'status.host', 'SSH: nobash', 30_000),
        dialogOf('c2877-trust') !== undefined,
      ];
      // In local-server mode the question is core's startup prompt, whose refusing button is this one.
      await answerDialog('c2877-trust', "No, I don't trust the authors");
      await new Promise(resolve => setTimeout(resolve, 2000));
      deepStrictEqual(
        [
          whileHeld,
          await statusItemText('c2877-trust', 'status.host', 'SSH: nobash', 30_000),
          await dialogOf('c2877-trust'),
          await isTrusted('c2877-trust'),
          (await pageText('c2877-trust')).includes('Restricted Mode'),
        ],
        [
          ['SSH: nobash', true],
          'SSH: nobash',
          undefined,
          false,
          true,
        ],
      );
    } finally {
      await closeWindow('c2877-trust').catch(() => undefined);
    }
  });
});
