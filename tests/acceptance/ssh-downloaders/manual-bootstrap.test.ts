/**
 * @fileoverview The switch, the warning and the missing archive of the manual local bootstrap (card #2946, F-2406): with
 * `remote.SSH.localServerDownload` set to `manual-bootstrap` the client reads the server archive from the bootstrap folder
 * of its home, warns once per attempt that the mode is on, and fails naming the path when the archive is not there.
 */

import {deepStrictEqual} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {
  chmodSync,
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
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
  ELF_MACHINE_OFFSET,
  nodeEntryOf,
  otherMachine,
  topFolderOf,
  withElfMachine,
} from '../windows/foreign-archive.ts';
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

/** The progress line the scp copy of an archive shows. */
const COPY_STAGE = 'Copying VS Code Server to host with scp';

/** Whether window `name` showed the scp copy of an archive. */
function copiedByScp(name: string): boolean {
  return recordLines('progress', name).some(line =>
    line.question.includes(COPY_STAGE),
  );
}

/** Whether `lines` show an archive copied by scp or the missing bootstrap file asked for. */
function asksForTheArchive(
  lines: ReadonlyArray<{surface: string; question: string}>,
): {
  copied: boolean;
  asked: boolean;
} {
  return {
    copied: lines.some(
      line => line.surface === 'progress' && line.question.includes(COPY_STAGE),
    ),
    asked: lines.some(
      line =>
        (line.surface === 'notice' || line.surface === 'failureDialog') &&
        line.question.includes('Expected tarball'),
    ),
  };
}

/** The text a bootstrap file holds that is no server archive: 22 bytes. */
const NOT_AN_ARCHIVE = 'not a server archive.\n';

/** Writes `NOT_AN_ARCHIVE` as the bootstrap file. */
function placeNotAnArchive(): void {
  mkdirSync(BOOTSTRAP_FOLDER, {recursive: true});
  writeFileSync(BOOTSTRAP_FILE, NOT_AN_ARCHIVE);
}

/** The standard output of `tar` with `commandWords`; fails with its standard error when it does not end well. */
function tarOutput(...commandWords: string[]): string {
  const ended = spawnSync('tar', commandWords, {encoding: 'utf8'});
  if (ended.status !== 0) {
    throw new Error(
      `tar ${commandWords.join(' ')} ended with ${String(ended.status)}: ${ended.stderr}`,
    );
  }
  return ended.stdout;
}

/**
 * Places the run's server archive unpacked and packed again, the way the foreign archive is made, and when `foreign` is set
 * turns it into one for the other architecture: the file `node` has the machine of its ELF header changed, so that the
 * archive unpacks on the host and its server cannot start there. Without it, the repack is the control: the same archive,
 * packed the same way, whose server starts.
 */
async function placeRepackedServerArchive(foreign: boolean): Promise<void> {
  await placeServerArchive();
  const listing = tarOutput('-tzf', BOOTSTRAP_FILE).split('\n');
  const nodeEntry = nodeEntryOf(listing).replace(/^\.\//u, '');
  const topFolder = topFolderOf(listing);
  const folder = mkdtempSync(path.join(tmpdir(), 'c2948-foreign-'));
  try {
    tarOutput('-xzpf', BOOTSTRAP_FILE, '-C', folder);
    if (foreign) {
      const descriptor = openSync(path.join(folder, nodeEntry), 'r+');
      try {
        const header = Buffer.alloc(ELF_MACHINE_OFFSET + 2);
        readSync(descriptor, header, 0, header.length, 0);
        const patched = withElfMachine(header, otherMachine(process.arch));
        writeSync(
          descriptor,
          patched,
          ELF_MACHINE_OFFSET,
          2,
          ELF_MACHINE_OFFSET,
        );
      } finally {
        closeSync(descriptor);
      }
    }
    tarOutput('-czf', BOOTSTRAP_FILE, '-C', folder, topFolder ?? '.');
  } finally {
    rmSync(folder, {recursive: true, force: true});
  }
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
      await waitFor(
        'a problem in settings.json',
        async () =>
          /\d/u.test((await statusItem('local', 'status.problems')).text),
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
  it('F-2406 AC-12 (c2948-text-part): the text case of AC-12: a bootstrap file that is not a server archive is copied, and the dialog reason is "Failed to install the VS Code Server." with the UnpackFailed row of the table', async () => {
    await withSettings({}, async () => {
      const name = 'c2948-text-part';
      placeNotAnArchive();
      appendScript(dismissals(name));
      await failedOn(ALIAS, name);
      try {
        const [status] = firstRowOf(await wholeTableOf(name));
        deepStrictEqual(
          {
            dialogs: recordLines('failureDialog', name).map(
              line => line.question,
            ),
            copied: copiedByScp(name),
            status,
          },
          {
            dialogs: [reason(ALIAS, 'Failed to install the VS Code Server.')],
            copied: true,
            status: 'UnpackFailed',
          },
        );
      } finally {
        await closeWindow(name).catch(() => undefined);
      }
    });
  });

  it('F-2406 AC-24 (c2948-leftover): the failed text file stays in the install folder, 22 bytes and nothing unpacked, and after a valid archive and Retry the window connects and that file is gone', async () => {
    await withSettings({}, async () => {
      const name = 'c2948-leftover';
      placeNotAnArchive();
      appendScript([
        {
          surface: 'failureDialog',
          match: `"${ALIAS}"`,
          answer: {button: 'Retry'},
          window: name,
          after: `${name}-placed`,
        },
        ...dismissals(name),
      ]);
      await openWindow(ALIAS, name);
      try {
        await waitFor(
          'the first failure dialog',
          () => recordLines('failureDialog', name).length > 0,
          INSTALL_MILLISECONDS,
        );
        const install = await installFolder();
        const listed = await onHost('ls', '-A', install);
        const size = await onHost(
          'stat',
          '-c',
          '%s',
          `${install}/vscode-server.tar.gz`,
        );
        await placeServerArchive();
        signal(`${name}-placed`);
        await connectedWithin(name, INSTALL_MILLISECONDS);
        const after = await onHost('ls', '-A', install);
        deepStrictEqual(
          {
            listed,
            size,
            leftAfter: after.split('\n').includes('vscode-server.tar.gz'),
          },
          {listed: 'vscode-server.tar.gz\n', size: '22\n', leftAfter: false},
        );
      } finally {
        await closeWindow(name).catch(() => undefined);
      }
    });
  });

  it('F-2406 AC-13 (c2948-arch): an archive for another architecture unpacks and the dialog reason is "The VS Code Server failed to start."', async () => {
    await withSettings({}, async () => {
      const name = 'c2948-arch';
      await placeRepackedServerArchive(true);
      appendScript(dismissals(name));
      await failedOn(ALIAS, name);
      try {
        deepStrictEqual(
          recordLines('failureDialog', name).map(line => line.question),
          [reason(ALIAS, 'The VS Code Server failed to start.')],
        );
      } finally {
        await closeWindow(name).catch(() => undefined);
      }
    });
  });

  it('F-2406 AC-13 (c2948-arch-control): the same archive, unpacked and packed again without the architecture patch, connects, so the refusal of the foreign one is the ELF\u2019s and not the repack\u2019s', async () => {
    await withSettings({}, async () => {
      const name = 'c2948-arch-control';
      await placeRepackedServerArchive(false);
      appendScript(dismissals(name));
      await openWindow(ALIAS, name);
      try {
        await connectedWithin(name, INSTALL_MILLISECONDS);
        deepStrictEqual(
          recordLines('failureDialog', name).map(line => line.question),
          [],
        );
      } finally {
        await closeWindow(name).catch(() => undefined);
      }
    });
  });

  it('F-2406 AC-28 (c2948-arch-again): after that failure, a Retry and a new window with the bootstrap file removed ask for no archive and copy none, and each fails the same way', async () => {
    await withSettings({}, async () => {
      const name = 'c2948-arch-again';
      const again = `${name}-new`;
      await placeRepackedServerArchive(true);
      appendScript([
        {
          surface: 'failureDialog',
          match: `"${ALIAS}"`,
          answer: {button: 'Retry'},
          window: name,
          after: `${name}-removed`,
        },
        ...dismissals(name),
        ...dismissals(again),
      ]);
      await openWindow(ALIAS, name);
      try {
        await waitFor(
          'the first failure dialog',
          () => recordLines('failureDialog', name).length > 0,
          INSTALL_MILLISECONDS,
        );
        const mark = recordLines(undefined, name).length;
        rmSync(BOOTSTRAP_FILE);
        signal(`${name}-removed`);
        await waitFor(
          'the second failure dialog',
          () => recordLines('failureDialog', name).length >= 2,
          INSTALL_MILLISECONDS,
        );
        const retried = {
          dialogs: recordLines('failureDialog', name).map(
            line => line.question,
          ),
          ...asksForTheArchive(recordLines(undefined, name).slice(mark)),
        };
        await closeWindow(name);
        await failedOn(ALIAS, again);
        const opened = {
          dialogs: recordLines('failureDialog', again).map(
            line => line.question,
          ),
          ...asksForTheArchive(recordLines(undefined, again)),
        };
        const failed = reason(ALIAS, 'The VS Code Server failed to start.');
        deepStrictEqual(
          {retried, opened},
          {
            retried: {
              dialogs: [failed, failed],
              copied: false,
              asked: false,
            },
            opened: {dialogs: [failed], copied: false, asked: false},
          },
        );
      } finally {
        await closeWindow(name).catch(() => undefined);
        await closeWindow(again).catch(() => undefined);
      }
    });
  });

  it('F-2406 AC-14 (c2948-unreadable): a bootstrap file the editor cannot read gives its read error as the reason, and the LocalBootstrapFailed row with S087 and S106', async () => {
    if (process.getuid?.() === 0) {
      throw new Error('an unreadable file needs a client that is not root');
    }
    await withSettings({}, async () => {
      const name = 'c2948-unreadable';
      await placeServerArchive();
      chmodSync(BOOTSTRAP_FILE, 0o000);
      appendScript(dismissals(name));
      await failedOn(ALIAS, name);
      try {
        const question = recordLines('failureDialog', name)[0]?.question ?? '';
        const [status, message, mitigations] = firstRowOf(
          await wholeTableOf(name),
        );
        deepStrictEqual(
          {
            reason: question.startsWith(
              `Could not establish connection to "${ALIAS}": `,
            ),
            error: question.includes('EACCES'),
            path: question.includes(BOOTSTRAP_FILE),
            status,
            message: compact(message ?? '').startsWith(
              compact(BOOTSTRAP_MESSAGE),
            ),
            steps: compact(mitigations ?? '').includes(
              compact(BOOTSTRAP_MITIGATIONS[3] ?? ''),
            ),
          },
          {
            reason: true,
            error: true,
            path: true,
            status: 'LocalBootstrapFailed',
            message: true,
            steps: true,
          },
        );
      } finally {
        await closeWindow(name).catch(() => undefined);
      }
    });
  });

  it('F-2406 AC-27 (c2948-unreadable-host): after that failure nothing was copied to the host: its install folders hold no archive, and once the file is readable and Retry is pressed the same listing shows the install', async () => {
    await withSettings({}, async () => {
      const name = 'c2948-unreadable-host';
      await placeServerArchive();
      chmodSync(BOOTSTRAP_FILE, 0o000);
      appendScript([
        {
          surface: 'failureDialog',
          match: `"${ALIAS}"`,
          answer: {button: 'Retry'},
          window: name,
          after: `${name}-readable`,
        },
        ...dismissals(name),
      ]);
      await openWindow(ALIAS, name);
      try {
        await waitFor(
          'the first failure dialog',
          () => recordLines('failureDialog', name).length > 0,
          INSTALL_MILLISECONDS,
        );
        async function listing(): Promise<string[]> {
          const output = await onHost(
            'sh',
            '-c',
            `ls -A '${DATA_FOLDER}'/bin/*/ 2>/dev/null; true`,
          );
          return output.split('\n').filter(line => line !== '');
        }
        const failed = {
          archive: (await listing()).includes('vscode-server.tar.gz'),
          copied: copiedByScp(name),
        };
        // The control: the same listing, once the file is readable and a Retry installs, shows the install folder, so
        // that an empty listing before it is an empty install folder and not a path that holds nothing.
        chmodSync(BOOTSTRAP_FILE, 0o644);
        signal(`${name}-readable`);
        await connectedWithin(name, INSTALL_MILLISECONDS);
        const installed = (await installFolder()).startsWith(
          `${DATA_FOLDER}/bin/`,
        );
        const after = await listing();
        deepStrictEqual(
          {
            failed,
            installed,
            listingSeesTheInstall: after.length > 0,
            archiveAfter: after.includes('vscode-server.tar.gz'),
          },
          {
            failed: {archive: false, copied: false},
            installed: true,
            listingSeesTheInstall: true,
            archiveAfter: false,
          },
        );
      } finally {
        await closeWindow(name).catch(() => undefined);
      }
    });
  });

  it('F-2406 AC-15 (c2948-noscp): with the mode on and no scp next to the configured ssh the dialog reason is "scp installation not found."', async () => {
    await withSettings(
      {
        'remote.SSH.path': path.join(
          variable('HARNESS_RUN_FOLDER'),
          'clients',
          'configured',
          'ssh',
        ),
      },
      async () => {
        const name = 'c2948-noscp';
        await placeServerArchive();
        appendScript(dismissals(name));
        await failedOn(ALIAS, name);
        try {
          deepStrictEqual(
            recordLines('failureDialog', name).map(line => line.question),
            [reason(ALIAS, 'scp installation not found.')],
          );
        } finally {
          await closeWindow(name).catch(() => undefined);
        }
      },
    );
  });
});
