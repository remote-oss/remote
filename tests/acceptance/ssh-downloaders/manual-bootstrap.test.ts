/**
 * @fileoverview The switch, the warning and the missing archive of the manual local bootstrap (card #2946, F-2406): with
 * `remote.SSH.localServerDownload` set to `manual-bootstrap` the client reads the server archive from the bootstrap folder
 * of its home, warns once per attempt that the mode is on, and fails naming the path when the archive is not there.
 */

import {deepStrictEqual} from 'node:assert';
import {readdirSync, readFileSync} from 'node:fs';
import {
  appendScript,
  closeWindow,
  connectedWithin,
  inWindow,
  onHost,
  openWindow,
  readUserSettings,
  recordLines,
  reloadWindow,
  restoreUserSettings,
  signal,
  userSettings,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {
  BOOTSTRAP_MESSAGE,
  BOOTSTRAP_MITIGATIONS,
  BOOTSTRAP_FILE,
  BOOTSTRAP_FOLDER,
  compact,
  installedCommit,
  installFolder,
  missingReason,
  placeServerArchive,
  reason,
  S088,
  withBootstrapFolderAside,
} from '../windows/bootstrap-support.ts';
import {
  closeAllButLocal,
  DATA_FOLDER,
  dismissals,
  freshHost,
  INSTALL_MILLISECONDS,
  platformAnswer,
} from '../windows/maintenance.ts';
import {settingControlOf, settingRow, statusItem} from '../windows/renderer.ts';
import {keepingSettings} from '../windows/tunnel-support.ts';
import {
  failedOn,
  firstRowOf,
  wholeTableOf,
} from '../windows/troubleshooting-support.ts';

const ALIAS = 'harness';

/** The setting whose value is the mode. */
const SETTING = 'remote.SSH.localServerDownload';

/** The reason of the failure dialog when the archive is missing. */
const MISSING = missingReason(ALIAS);

/** The number of requests the download host has logged so far. */
function requestsLogged(): number {
  return readFileSync(variable('HARNESS_DOWNLOADS_LOG'), 'utf8')
    .split('\n')
    .filter(line => line !== '').length;
}

/** The lines of window `name`'s record that say S088, in order. */
function warnings(name: string): number {
  return recordLines('notice', name).filter(line => line.question === S088)
    .length;
}

describe('the manual local bootstrap: the switch, the warning and the missing archive (card #2946, F-2406)', function () {
  this.timeout(900_000);
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

  /** Runs `body` on a fresh host with the mode on, the platform stored and `extra` settings, the bootstrap folder set aside. */
  function withSettings(
    extra: Readonly<Record<string, unknown>>,
    body: () => Promise<void>,
  ): Promise<void> {
    return keepingSettings(() =>
      withBootstrapFolderAside(async () => {
        await freshHost();
        await userSettings({
          'remote.SSH.remotePlatform': {[ALIAS]: 'linux'},
          'remote.SSH.localServerDownload': 'manual-bootstrap',
          ...extra,
        });
        await body();
      }),
    );
  }

  it('F-2406 AC-1 (c2946-warn): with the mode on and no archive, a warning without buttons is raised once at the start of the attempt, before the failure dialog', async () => {
    await withSettings({}, async () => {
      const name = 'c2946-warn';
      appendScript(dismissals(name));
      await failedOn(ALIAS, name);
      try {
        const lines = recordLines(undefined, name);
        deepStrictEqual(
          {
            warnings: warnings(name),
            beforeTheDialog:
              lines.findIndex(
                line => line.surface === 'notice' && line.question === S088,
              ) < lines.findIndex(line => line.surface === 'failureDialog'),
            buttons: lines
              .filter(
                line => line.surface === 'notice' && line.question === S088,
              )
              .map(line => line.buttons),
          },
          {warnings: 1, beforeTheDialog: true, buttons: [[]]},
        );
      } finally {
        await closeWindow(name).catch(() => undefined);
      }
    });
  });

  it('F-2406 AC-3 (c2946-auto): with "auto" the window connects and no notice mentions the mode, even with the archive in the bootstrap folder', async () => {
    await withSettings({'remote.SSH.localServerDownload': 'auto'}, async () => {
      const name = 'c2946-auto';
      // The archive is there, as a control: the warning is about the mode, which "auto" is not.
      await placeServerArchive();
      appendScript(dismissals(name));
      await openWindow(ALIAS, name);
      try {
        await connectedWithin(name, INSTALL_MILLISECONDS);
        deepStrictEqual(
          {
            folder: readdirSync(BOOTSTRAP_FOLDER),
            notices: recordLines('notice', name).filter(line =>
              line.question.includes('manual-bootstrap'),
            ),
          },
          {folder: ['vscode-server.tar.gz'], notices: []},
        );
      } finally {
        await closeWindow(name).catch(() => undefined);
      }
    });
  });

  it('F-2406 AC-4 (c2946-missing): the dialog names the path of the missing archive, with the three buttons, within two seconds of the warning', async () => {
    await withSettings({}, async () => {
      const name = 'c2946-missing';
      appendScript(dismissals(name));
      await failedOn(ALIAS, name);
      try {
        const warning = recordLines('notice', name).find(
          line => line.question === S088,
        );
        const dialog = recordLines('failureDialog', name)[0];
        deepStrictEqual(
          {
            question: dialog?.question,
            buttons: dialog?.buttons,
            // "Within about one second", with the suite's margin.
            soon: (dialog?.time ?? Infinity) - (warning?.time ?? 0) < 2000,
          },
          {
            question: MISSING,
            buttons: ['Close Remote', 'Retry', 'More Actions...'],
            soon: true,
          },
        );
      } finally {
        await closeWindow(name).catch(() => undefined);
      }
    });
  });

  it('F-2406 AC-5 (c2946-nothing): that failure installs nothing on the host, downloads nothing and asks no trust question', async () => {
    await withSettings({}, async () => {
      const name = 'c2946-nothing';
      appendScript(dismissals(name));
      const before = requestsLogged();
      await failedOn(ALIAS, name);
      try {
        const lines = recordLines(undefined, name);
        deepStrictEqual(
          {
            installed: (
              await onHost(
                'sh',
                '-c',
                `ls -A '${DATA_FOLDER}/bin' 2>/dev/null; true`,
              )
            ).trim(),
            requests: requestsLogged() - before,
            trust: lines.filter(
              line =>
                (line.surface === 'pick' || line.surface === 'notice') &&
                /trust/iu.test(line.question),
            ).length,
            copied: lines.filter(
              line =>
                line.surface === 'progress' &&
                line.question.includes(
                  'Copying VS Code Server to host with scp',
                ),
            ).length,
          },
          {installed: '', requests: 0, trust: 0, copied: 0},
        );
      } finally {
        await closeWindow(name).catch(() => undefined);
      }
    });
  });

  it('F-2406 AC-6 (c2946-hint): the troubleshooting row says LocalBootstrapFailed, with the expected tarball and the six steps in order', async () => {
    await withSettings({}, async () => {
      const name = 'c2946-hint';
      appendScript(dismissals(name));
      await failedOn(ALIAS, name);
      try {
        const [status, message, mitigations] = firstRowOf(
          await wholeTableOf(name),
        );
        deepStrictEqual(
          {
            status,
            message: compact(message ?? ''),
            mitigations: compact(mitigations ?? ''),
          },
          {
            status: 'LocalBootstrapFailed',
            message: compact(
              `${BOOTSTRAP_MESSAGE} (Expected tarball at local path ${BOOTSTRAP_FILE})`,
            ),
            mitigations: compact(BOOTSTRAP_MITIGATIONS.join('')),
          },
        );
      } finally {
        await closeWindow(name).catch(() => undefined);
      }
    });
  });

  it('F-2406 AC-10 (c2946-installed): on a host with the server already installed, the mode on and no archive: the window connects, with no dialog, no copy and one warning', async () => {
    await withSettings({'remote.SSH.localServerDownload': 'auto'}, async () => {
      const first = 'c2946-installed-first';
      appendScript(dismissals(first));
      await openWindow(ALIAS, first);
      await connectedWithin(first, INSTALL_MILLISECONDS);
      await closeWindow(first);
      const commit = await installedCommit();
      const folder = await installFolder();
      await userSettings({
        'remote.SSH.localServerDownload': 'manual-bootstrap',
      });
      const name = 'c2946-installed';
      appendScript(dismissals(name));
      await openWindow(ALIAS, name);
      try {
        await connectedWithin(name, INSTALL_MILLISECONDS);
        const lines = recordLines(undefined, name);
        deepStrictEqual(
          {
            dialogs: lines.filter(line => line.surface === 'failureDialog')
              .length,
            copied: lines.filter(
              line =>
                line.surface === 'progress' &&
                line.question.includes(
                  'Copying VS Code Server to host with scp',
                ),
            ).length,
            warnings: warnings(name),
            sameInstall: [await installedCommit(), await installFolder()],
          },
          {dialogs: 0, copied: 0, warnings: 1, sameInstall: [commit, folder]},
        );
      } finally {
        await closeWindow(name).catch(() => undefined);
      }
    });
  });

  it('F-2406 AC-18 (c2946-settings): a failed connect in this mode changes no setting', async () => {
    await withSettings({}, async () => {
      const name = 'c2946-settings';
      appendScript(dismissals(name));
      const before = readUserSettings();
      await failedOn(ALIAS, name);
      try {
        deepStrictEqual(readUserSettings(), before);
      } finally {
        await closeWindow(name).catch(() => undefined);
      }
    });
  });

  it('F-2406 AC-21 (c2946-pick): with no stored platform the platform pick comes after the warning, and dismissing it ends the connect as canceled', async () => {
    await withSettings(
      {'remote.SSH.useLocalServer': false, 'remote.SSH.remotePlatform': {}},
      async () => {
        const name = 'c2946-pick';
        appendScript([
          {...platformAnswer('dismiss'), window: name},
          ...dismissals(name),
        ]);
        await failedOn(ALIAS, name);
        try {
          const lines = recordLines(undefined, name);
          deepStrictEqual(
            {
              warned: lines.some(
                line => line.surface === 'notice' && line.question === S088,
              ),
              pick: lines
                .filter(line => line.surface === 'platformPick')
                .map(line => line.question),
              dialog: recordLines('failureDialog', name).map(
                line => line.question,
              ),
            },
            {
              warned: true,
              pick: [`Select the platform of the remote host "${ALIAS}"`],
              dialog: [reason(ALIAS, 'Connecting was canceled.')],
            },
          );
        } finally {
          await closeWindow(name).catch(() => undefined);
        }
      },
    );
  });

  it('F-2406 AC-25 (c2946-switch): switching to "auto" and pressing Retry connects with no second warning; switching back and reloading warns and fails again', async () => {
    await withSettings({}, async () => {
      const name = 'c2946-switch';
      appendScript([
        {
          surface: 'failureDialog',
          match: `"${ALIAS}"`,
          answer: {button: 'Retry'},
          window: name,
          after: 'c2946-auto',
        },
        ...dismissals(name),
      ]);
      await openWindow(ALIAS, name);
      try {
        await waitFor(
          'the first failure dialog',
          () => recordLines('failureDialog', name).length > 0,
          120_000,
        );
        await userSettings({'remote.SSH.localServerDownload': 'auto'});
        signal('c2946-auto');
        await connectedWithin(name, INSTALL_MILLISECONDS);
        const warningsAfterRetry = warnings(name);
        await userSettings({
          'remote.SSH.localServerDownload': 'manual-bootstrap',
        });
        await reloadWindow(name);
        await waitFor(
          'the failure after the reload',
          () => warnings(name) > warningsAfterRetry,
          INSTALL_MILLISECONDS,
        );
        deepStrictEqual(
          {
            warningsAfterRetry,
            warningsAfterReload: warnings(name),
            dialogs: [
              ...new Set(
                recordLines('failureDialog', name).map(line => line.question),
              ),
            ],
          },
          {warningsAfterRetry: 1, warningsAfterReload: 2, dialogs: [MISSING]},
        );
      } finally {
        await closeWindow(name).catch(() => undefined);
      }
    });
  });

  it('F-2406 AC-26 (c2946-again): a Retry with the archive still missing raises the warning again, once per attempt', async () => {
    await withSettings({}, async () => {
      const name = 'c2946-again';
      appendScript([
        {
          surface: 'failureDialog',
          match: `"${ALIAS}"`,
          answer: {button: 'Retry'},
          window: name,
        },
        ...dismissals(name),
      ]);
      await failedOn(ALIAS, name);
      try {
        await waitFor(
          'the second failure dialog',
          () => recordLines('failureDialog', name).length >= 2,
          120_000,
        );
        deepStrictEqual(warnings(name), 2);
      } finally {
        await closeWindow(name).catch(() => undefined);
      }
    });
  });

  it('F-2406 AC-18 (c2946-flagged): with the mode on, the Settings editor shows "auto" for the setting and settings.json carries one warning for the undeclared value', async () => {
    await withSettings({}, async () => {
      await inWindow('local', 'workbench.action.openSettings', SETTING);
      await waitFor(
        'the setting on the Settings editor list',
        async () => (await settingRow('local')) !== undefined,
        60_000,
      );
      const editorShows = await settingControlOf('local');
      await inWindow('local', 'workbench.action.openSettingsJson');
      // Core marks the value once it has validated the file, which takes a moment after the file is open: the wait ends at
      // the flagged count or after a minute, and the assertion below says what the item then showed.
      await waitFor(
        'the warning for the undeclared value in settings.json',
        async () =>
          (await statusItem('local', 'status.problems')).text
            .replaceAll(/\s+/gu, ' ')
            .trim() === '0 1',
        60_000,
      ).catch(() => undefined);
      deepStrictEqual(
        {
          editorShows,
          problems: (await statusItem('local', 'status.problems')).text
            .replaceAll(/\s+/gu, ' ')
            .trim(),
        },
        {editorShows: 'auto', problems: '0 1'},
      );
    });
  });
});
