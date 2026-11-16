import {deepStrictEqual} from 'node:assert';
import {chmodSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {
  appendScript,
  closeWindow,
  connectedWithin,
  isTrusted,
  onHost,
  openWindow,
  recordLines,
  reloadWindow,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {INSTALL_MILLISECONDS} from '../windows/maintenance.ts';
import {answerDialog, dialogOf, waitForDialog} from '../windows/renderer.ts';

/** The setting that names the pre-connection script. */
const SETTING = 'remote.SSH.preconnect';

/** The words the confirmation dialog of a script holds. */
const QUESTION = 're-connection script';

/** The detail of each confirmation dialog window `window` showed, not the ones that wait: it names the script. */
function confirmations(window: string): string[] {
  return recordLines('preconnectDialog', window)
    .filter(line => line.held !== true)
    .map(line => line.detail ?? '');
}

describe('the pre-connection script set only in the remote folder, in Restricted Mode (F-2108, card #2716)', function () {
  this.timeout(300_000);

  it('F-2108 AC-32 (c2716-restricted-folder): a script set only in the remote folder’s settings gets its confirmation dialog from the second load on, also while the folder is untrusted', async () => {
    const script = path.join(variable('HARNESS_RUN_FOLDER'), 'restricted.sh');
    writeFileSync(script, '#!/bin/sh\nexit 0\n');
    chmodSync(script, 0o755);
    const home = '/home/harness/c2716-restricted';
    await onHost('mkdir', '-p', `${home}/.vscode`);
    await onHost(
      'sh',
      '-c',
      `printf '%s' '${JSON.stringify({[SETTING]: script})}' > ${home}/.vscode/settings.json`,
    );
    const window = 'c2716-restricted';
    appendScript([
      {
        surface: 'preconnectDialog',
        match: QUESTION,
        answer: {button: 'Allow'},
        window,
      },
    ]);
    await openWindow('harness', 'c2716-restricted');
    try {
      await waitForDialog(window);
      await answerDialog(window, "No, I don't trust the authors");
      await connectedWithin(window, INSTALL_MILLISECONDS);
      const first = confirmations(window);
      const untrusted = await isTrusted(window);
      await reloadWindow(window);
      await waitFor(
        'the confirmation dialog of the second load',
        async () => {
          if ((await dialogOf(window)) !== undefined) {
            await answerDialog(window, "No, I don't trust the authors");
          }
          return confirmations(window).length > 0;
        },
        INSTALL_MILLISECONDS,
      );
      await connectedWithin(window, INSTALL_MILLISECONDS);
      deepStrictEqual(
        [
          first,
          untrusted,
          await isTrusted(window),
          confirmations(window).map(detail => detail.includes(script)),
        ],
        [[], false, false, [true]],
      );
    } finally {
      await closeWindow(window).catch(() => undefined);
    }
  });
});
