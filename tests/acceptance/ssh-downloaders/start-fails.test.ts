/**
 * @fileoverview A legacy-mode connect to a host whose downloaded server cannot start (card #3155, F-2103 AC-16). The
 * server is the one a real connect downloaded and installed: the row then stops it and replaces its launcher with a
 * script that ends at once, so the next connect finds the install in place, launches it, and sees it die before it
 * reports a port.
 */

import {deepStrictEqual} from 'node:assert';
import {
  appendScript,
  closeWindow,
  editorProduct,
  onHost,
  readUserSettings,
  recordLines,
  restoreUserSettings,
  userSettings,
} from '../windows/harness.ts';
import {
  closeAllButLocal,
  DATA_FOLDER,
  dismissals,
  freshHost,
  openConnected,
  serverMainProcesses,
  serversGoneWithin,
} from '../windows/maintenance.ts';
import {installedCommit, reason} from '../windows/bootstrap-support.ts';
import {failedOn} from '../windows/troubleshooting-support.ts';

const ALIAS = 'harness';

/** A launcher that ends at once, as a server that cannot start does. */
const DEAD_LAUNCHER = '#!/bin/sh\nexit 1\n';

describe('a legacy-mode connect to a host whose downloaded server cannot start (card #3155, F-2103 AC-16)', function () {
  this.timeout(600_000);
  let saved: string | undefined;

  before(async () => {
    saved = readUserSettings();
    await userSettings({
      'terminal.integrated.tabs.hideCondition': 'never',
      'terminal.integrated.fontSize': 6,
    });
    await closeAllButLocal();
  });

  after(async () => {
    restoreUserSettings(saved);
    await closeAllButLocal();
  });

  it('F-2103 AC-16 (c3029-start-fails): the server a legacy connect downloaded, with a launcher that cannot start, gives the dialog with only the text "The VS Code Server failed to start." and the buttons Close Remote (the primary one, listed first), Retry and More Actions...', async () => {
    await userSettings({'remote.SSH.useExecServer': false});
    await freshHost();
    const first = 'c3029-installed';
    const failing = 'c3029-start-fails';
    await openConnected(first, 180_000);
    const commit = await installedCommit();
    const launcher = `${DATA_FOLDER}/bin/${commit}/bin/${editorProduct().serverApplicationName}`;
    const running = await serverMainProcesses();
    await closeWindow(first);
    // The next connect must launch the install, and not attach to the server the first one left.
    await onHost(
      'sh',
      '-c',
      `pkill -f '${DATA_FOLDER.replace('/.', '/[.]')}/bin/' || true`,
    );
    await serversGoneWithin(running, 60_000);
    await onHost(
      'sh',
      '-c',
      `printf '%s' '${DEAD_LAUNCHER}' > '${launcher}' && chmod 755 '${launcher}'`,
    );
    appendScript(dismissals(failing));
    await failedOn(ALIAS, failing);
    try {
      const dialogs = recordLines('failureDialog', failing);
      deepStrictEqual(
        {
          texts: dialogs.map(line => line.question),
          buttons: dialogs.map(line => line.buttons),
          installs: await onHost('sh', '-c', `ls -A '${DATA_FOLDER}/bin'`),
        },
        {
          texts: [reason(ALIAS, 'The VS Code Server failed to start.')],
          buttons: [['Close Remote', 'Retry', 'More Actions...']],
          installs: `${commit}\n`,
        },
      );
    } finally {
      await closeWindow(failing).catch(() => undefined);
    }
  });
});
