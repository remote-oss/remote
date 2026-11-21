/**
 * @fileoverview The server install location the user setting picks (card #2487, F-2407): the folder it names on the
 * host, the check the client makes of the value before any SSH connection, and what a changed value waits for.
 */

import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {
  acceptedKeyLogins,
  appendScript,
  closeWindow,
  connectedWithin,
  inWindow,
  onHost,
  openWindow,
  recordLines,
  readUserSettings,
  restoreUserSettings,
  userSettings,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {
  DATA_FOLDER,
  INSTALL_MILLISECONDS,
  closeAllButLocal,
  dismissals,
  freshHost,
  openConnected,
  pickHost,
  runWith,
  setting,
} from '../windows/maintenance.ts';
import {
  answerDialog,
  dialogOf,
  notifications,
  pageText,
  settingRow,
  settingsTab,
  settingsTabs,
} from '../windows/renderer.ts';
import {PLATFORMS, keepingSettings} from '../windows/tunnel-support.ts';
import {
  cellsOf,
  failedOn,
  wholeTableOf,
} from '../windows/troubleshooting-support.ts';
import {hintRecords, waitForRecords} from '../windows/hint-store.ts';

/** The setting that names the install folder. */
const SETTING = 'remote.SSH.serverInstallPath';

/** The remote user's home on the host. */
const HOME = '/home/harness';

/** The server data folder the launch's editor writes on the host. */
const SERVER_NAME = path.basename(DATA_FOLDER);

/** The setting's host entry for `folder`. */
function value(folder: string): Record<string, unknown> {
  return {harness: folder};
}

/** The dialog's detail of a connect the client refused with `value` (7.E1). */
function invalidDetail(value: string): string {
  return `Could not establish connection to "harness": Provided: "${value}".`;
}

/** The dialog's detail of a connect whose install folder the host could not create (7.E2). */
const DIR_DETAIL = `Could not establish connection to "harness": Failed to create the remote server's install directory.`;

/** The `ls -a` entries of `folder`, or `undefined` when the host has no such listing. */
async function listed(folder: string): Promise<string[] | undefined> {
  try {
    return (await onHost('ls', '-a', folder)).trim().split(/\s+/u);
  } catch {
    return undefined;
  }
}

/** Whether `folder` holds the launch's server data folder. */
async function serverAt(folder: string): Promise<boolean> {
  return (await listed(folder))?.includes(SERVER_NAME) ?? false;
}

/** Waits for window `name`'s failure dialog and gives it. */
async function failedDialog(name: string) {
  await waitFor(
    `the failure dialog of ${name}`,
    () => recordLines('failureDialog', name).length > 0,
    60_000,
  );
  return dialogOf(name);
}

/** `text` without its white space (the table draws a space as a no-break space): the row compares what is written. */
function squeezed(text: string): string {
  return text.replaceAll(/\s/gu, '');
}

/** The cells of column `column` of the data rows of `table`, one per line. */
function columnOf(table: readonly string[], column: number): string[] {
  const end = table.findIndex(
    (line, index) => index > 2 && line.startsWith('╚'),
  );
  return table
    .slice(3, end)
    .map(line => cellsOf(line)[column] ?? '')
    .filter(cell => cell !== '');
}

/** The setting's description as the manifest declares it: the nls text with its format holes filled. */
function settingDescription(): string {
  const folder = path.join(
    import.meta.dirname,
    '..',
    '..',
    '..',
    'packages',
    'remote-ssh',
  );
  const manifest = JSON.parse(
    readFileSync(path.join(folder, 'package.json'), 'utf8'),
  ) as {
    contributes: {
      configuration: {
        properties: Record<
          string,
          {description?: string; markdownDescription?: string}
        >;
      };
    };
  };
  const strings = JSON.parse(
    readFileSync(path.join(folder, 'package.nls.json'), 'utf8'),
  ) as Record<string, string>;
  const declared = manifest.contributes.configuration.properties[SETTING];
  const reference =
    declared?.description ?? declared?.markdownDescription ?? '';
  return strings[reference.replaceAll('%', '')] ?? reference;
}

describe('the install location the user setting picks (card #2487)', function () {
  this.timeout(600_000);
  let saved: string | undefined;

  before(async () => {
    saved = readUserSettings();
    await userSettings({
      ...PLATFORMS,
      'terminal.integrated.tabs.hideCondition': 'never',
      'terminal.integrated.fontSize': 6,
    });
    await closeAllButLocal();
  });

  after(async () => {
    restoreUserSettings(saved);
    await closeAllButLocal();
  });

  it('F-2407 AC-1 (c2487-install): a writable absolute folder for the host gets the server, and the window connects with no message that names the folder', async () => {
    const folder = `${HOME}/cust1`;
    await keepingSettings(async () => {
      await freshHost();
      await setting(SETTING, value(folder));
      const name = 'c2487-install';
      appendScript(dismissals(name));
      try {
        await openConnected(name, INSTALL_MILLISECONDS);
        deepStrictEqual(
          {
            server: await serverAt(folder),
            binary:
              (await listed(`${folder}/${SERVER_NAME}`))?.some(entry =>
                entry.startsWith('code-'),
              ) ?? false,
            homeBinary:
              (await listed(`${HOME}/${SERVER_NAME}`))?.some(entry =>
                entry.startsWith('code-'),
              ) ?? false,
            messages: (await notifications(name)).filter(text =>
              text.includes(folder),
            ).length,
          },
          {server: true, binary: true, homeBinary: false, messages: 0},
        );
      } finally {
        await closeWindow(name).catch(() => undefined);
        await setting(SETTING, undefined);
      }
    });
  });

  it('F-2407 AC-2 (c2487-reuse): a connect through the running connection server, and one after the server is killed, reuse the folder and make no new one', async () => {
    const folder = `${HOME}/cust2`;
    await keepingSettings(async () => {
      await freshHost();
      await setting(SETTING, value(folder));
      const names = ['c2487-reuse-a', 'c2487-reuse-b', 'c2487-reuse-c'];
      for (const name of names) {
        appendScript(dismissals(name));
      }
      try {
        await openConnected(names[0] ?? '', INSTALL_MILLISECONDS);
        await openConnected(names[1] ?? '', INSTALL_MILLISECONDS);
        await runWith('local', 'opensshremotes.cleanLocalServer', [
          pickHost('harness'),
        ]);
        await openConnected(names[2] ?? '', INSTALL_MILLISECONDS);
        deepStrictEqual(
          {
            entries: (await listed(folder))?.filter(
              entry => entry !== '.' && entry !== '..',
            ),
            home: (await listed(HOME))?.filter(entry =>
              entry.startsWith('cust2'),
            ),
          },
          {entries: [SERVER_NAME], home: []},
        );
      } finally {
        for (const name of names) {
          await closeWindow(name).catch(() => undefined);
        }
        await setting(SETTING, undefined);
      }
    });
  });

  it('F-2407 AC-3 (c2487-parents): every missing parent level of the folder is created, and the install succeeds', async () => {
    const base = `${HOME}/p3`;
    const folder = `${base}/a/b`;
    await keepingSettings(async () => {
      await freshHost();
      await setting(SETTING, value(folder));
      const name = 'c2487-parents';
      appendScript(dismissals(name));
      try {
        await openConnected(name, INSTALL_MILLISECONDS);
        deepStrictEqual(
          {
            levels: [
              (await listed(base))?.includes('a') ?? false,
              (await listed(`${base}/a`))?.includes('b') ?? false,
              await serverAt(folder),
            ],
          },
          {levels: [true, true, true]},
        );
      } finally {
        await closeWindow(name).catch(() => undefined);
        await setting(SETTING, undefined);
      }
    });
  });

  it('F-2407 AC-4 (c2487-default): no entry, an empty object, an empty string, null and a non-object value all install into the home folder, with no message about the setting', async () => {
    await keepingSettings(async () => {
      const shapes: Array<string | Record<string, unknown> | undefined> = [
        undefined,
        {},
        value(''),
        {harness: null},
        'a plain string',
      ];
      const home = [];
      const dialogs = [];
      const names = shapes.map(
        (each, index) => `c2487-default-${String(index)}`,
      );
      for (const name of names) {
        appendScript(dismissals(name));
      }
      for (const [index, shape] of shapes.entries()) {
        await userSettings({
          ...PLATFORMS,
          ...(shape === undefined ? {} : {[SETTING]: shape}),
        });
        if (index > 0) {
          await runWith('local', 'opensshremotes.cleanLocalServer', [
            pickHost('harness'),
          ]);
        }
        const name = names[index] ?? '';
        await openConnected(name, INSTALL_MILLISECONDS);
        home.push(await serverAt(HOME));
        dialogs.push(recordLines('failureDialog', name).length);
        await closeWindow(name).catch(() => undefined);
      }
      deepStrictEqual(
        {
          home,
          dialogs,
          mentions: (await notifications('local')).filter(text =>
            text.includes(SETTING),
          ).length,
        },
        {
          home: [true, true, true, true, true],
          dialogs: [0, 0, 0, 0, 0],
          mentions: 0,
        },
      );
    });
  });

  it('F-2407 AC-5 (c2487-keys): a key that is not the alias — the host name, another case, a star, a glob — leaves the home folder', async () => {
    const config = readFileSync(variable('HARNESS_SSH_CONFIG'), 'utf8');
    const block = config.slice(config.indexOf('Host harness\n'));
    const hostName =
      block === '' ? '' : (/HostName (\S+)/u.exec(block)?.slice(1)[0] ?? '');
    await keepingSettings(async () => {
      const keys = [hostName, 'Harness', '*', 'harn*'];
      const folder = `${HOME}/k5`;
      const named = [];
      const home = [];
      for (const [index, key] of keys.entries()) {
        await userSettings({
          ...PLATFORMS,
          [SETTING]: {[key]: folder},
        });
        if (index > 0) {
          await runWith('local', 'opensshremotes.cleanLocalServer', [
            pickHost('harness'),
          ]);
        }
        const name = `c2487-keys-${String(index)}`;
        appendScript(dismissals(name));
        await openConnected(name, INSTALL_MILLISECONDS);
        named.push(await serverAt(folder));
        home.push(await serverAt(HOME));
        await closeWindow(name).catch(() => undefined);
      }
      deepStrictEqual(
        {host: hostName !== '', named, home},
        {
          host: true,
          named: [false, false, false, false],
          home: [true, true, true, true],
        },
      );
    });
  });

  it('F-2407 AC-6 (c2487-shapes): a trailing slash, a .. segment and a doubled leading slash install into the folder the host resolves the written path to', async () => {
    const shapes: Array<[string, string]> = [
      [`${HOME}/ts6/`, `${HOME}/ts6`],
      [`${HOME}/up6/../up6b`, `${HOME}/up6b`],
      [`//${HOME.slice(1)}/dbl6`, `${HOME}/dbl6`],
    ];
    await keepingSettings(async () => {
      const resolved = [];
      for (const [index, [written, target]] of shapes.entries()) {
        await userSettings({
          ...PLATFORMS,
          [SETTING]: value(written),
        });
        if (index > 0) {
          await runWith('local', 'opensshremotes.cleanLocalServer', [
            pickHost('harness'),
          ]);
        }
        const name = `c2487-shapes-${String(index)}`;
        appendScript(dismissals(name));
        await openConnected(name, INSTALL_MILLISECONDS);
        resolved.push(await serverAt(target));
        await closeWindow(name).catch(() => undefined);
      }
      deepStrictEqual({resolved}, {resolved: [true, true, true]});
    });
  });

  it('F-2407 AC-7 (c2487-invalid): a value that is not a plain absolute path is checked on the client: no SSH login, and the dialog holds the value as written', async () => {
    await keepingSettings(async () => {
      const values = ['relative/inst', '$HOME/inst'];
      const since = new Date().toISOString();
      const details = [];
      const buttons = [];
      for (const [index, item] of values.entries()) {
        await setting(SETTING, value(item));
        if (index > 0) {
          await runWith('local', 'opensshremotes.cleanLocalServer', [
            pickHost('harness'),
          ]);
        }
        const name = `c2487-invalid-${String(index)}`;
        appendScript(dismissals(name));
        await openWindow('harness', name);
        const shown = await failedDialog(name);
        details.push(shown?.details);
        buttons.push(shown?.buttons);
        await closeWindow(name).catch(() => undefined);
      }
      deepStrictEqual(
        {
          details: values.map(invalidDetail),
          buttons,
          logins: await acceptedKeyLogins(since),
        },
        {
          details: values.map(invalidDetail),
          buttons: [
            ['Retry', 'More Actions...', 'Close Remote'],
            ['Retry', 'More Actions...', 'Close Remote'],
          ],
          logins: 0,
        },
      );
    });
  });

  it('F-2407 AC-8 (c2487-charset-part1): the dollars, quotes, backtick, semicolon, asterisk, at, comma, equals, percent, tilde, colon and sharp in an absolute value are all refused as in AC-7, with no SSH login', async () => {
    await keepingSettings(async () => {
      const chars = [
        '$',
        '"',
        "'",
        '`',
        ';',
        '*',
        '@',
        ',',
        '=',
        '%',
        '~',
        ':',
        '#',
      ];
      const since = new Date().toISOString();
      const details = [];
      for (const [index, each] of chars.entries()) {
        const item = `/c8${each}`;
        await setting(SETTING, value(item));
        if (index > 0) {
          await runWith('local', 'opensshremotes.cleanLocalServer', [
            pickHost('harness'),
          ]);
        }
        const name = `c2487-charset-${String(index)}`;
        appendScript(dismissals(name));
        await openWindow('harness', name);
        const shown = await failedDialog(name);
        details.push(shown?.details === invalidDetail(item));
        await closeWindow(name).catch(() => undefined);
      }
      deepStrictEqual(
        {details, logins: await acceptedKeyLogins(since)},
        {
          details: Array(chars.length).fill(true),
          logins: 0,
        },
      );
    });
  });

  it('F-2407 AC-8 (c2487-charset-part2): the bang, ampersand, brackets, braces, angle, pipe, question, caret, plus, backslash, tab and non-ASCII letter in an absolute value are all refused as in AC-7, with no SSH login', async () => {
    await keepingSettings(async () => {
      const chars = [
        '&',
        '(',
        ')',
        '[',
        ']',
        '{',
        '}',
        '<',
        '>',
        '|',
        '?',
        '^',
        '+',
        '\\',
        '\t',
        'é',
      ];
      const since = new Date().toISOString();
      const details = [];
      for (const [index, each] of chars.entries()) {
        const item = `/c8${each}`;
        await setting(SETTING, value(item));
        if (index > 0) {
          await runWith('local', 'opensshremotes.cleanLocalServer', [
            pickHost('harness'),
          ]);
        }
        const name = `c2487-charset-${String(index)}`;
        appendScript(dismissals(name));
        await openWindow('harness', name);
        const shown = await failedDialog(name);
        details.push(
          shown?.details === invalidDetail(item.replaceAll('\t', ' ')),
        );
        await closeWindow(name).catch(() => undefined);
      }
      deepStrictEqual(
        {details, logins: await acceptedKeyLogins(since)},
        {
          details: Array(chars.length).fill(true),
          logins: 0,
        },
      );
    });
  });

  it('F-2407 AC-10 (c2487-retry): "Retry" at the refused value\'s dialog, with the value unchanged, brings the same dialog back and still no SSH login', async () => {
    const item = 'relative/inst';
    await keepingSettings(async () => {
      const since = new Date().toISOString();
      await setting(SETTING, value(item));
      const name = 'c2487-retry';
      appendScript(dismissals(name));
      try {
        await openWindow('harness', name);
        const first = await failedDialog(name);
        const mark = recordLines('failureDialog', name).length;
        await answerDialog(name, 'Retry');
        await waitFor(
          `the dialog again on ${name}`,
          () => recordLines('failureDialog', name).length > mark,
          60_000,
        );
        const again = await dialogOf(name);
        deepStrictEqual(
          {
            first: first?.details,
            again: again?.details,
            logins: await acceptedKeyLogins(since),
          },
          {
            first: invalidDetail(item),
            again: invalidDetail(item),
            logins: 0,
          },
        );
      } finally {
        await closeWindow(name).catch(() => undefined);
        await setting(SETTING, undefined);
      }
    });
  });

  it('F-2407 AC-11 (c2487-dircannot): a parent that cannot be written, a slash, an existing file and an existing non-writable folder all give the install directory dialog', async () => {
    await onHost('mkdir', '-p', `${HOME}/ro11`);
    await onHost('chmod', '0555', `${HOME}/ro11`);
    await onHost('touch', `${HOME}/f11`);
    await onHost('mkdir', `${HOME}/nw11`);
    await onHost('chmod', '0555', `${HOME}/nw11`);
    try {
      const values = [`${HOME}/ro11/inner`, '/', `${HOME}/f11`, `${HOME}/nw11`];
      const details = [];
      const buttons = [];
      for (const [index, item] of values.entries()) {
        await setting(SETTING, value(item));
        if (index > 0) {
          await runWith('local', 'opensshremotes.cleanLocalServer', [
            pickHost('harness'),
          ]);
        }
        const name = `c2487-dircannot-${String(index)}`;
        appendScript(dismissals(name));
        await openWindow('harness', name);
        const shown = await failedDialog(name);
        details.push(shown?.details);
        buttons.push(shown?.buttons);
        await closeWindow(name).catch(() => undefined);
      }
      deepStrictEqual(
        {
          details,
          buttons,
        },
        {
          details: [DIR_DETAIL, DIR_DETAIL, DIR_DETAIL, DIR_DETAIL],
          buttons: [
            ['Retry', 'More Actions...', 'Close Remote'],
            ['Retry', 'More Actions...', 'Close Remote'],
            ['Retry', 'More Actions...', 'Close Remote'],
            ['Retry', 'More Actions...', 'Close Remote'],
          ],
        },
      );
    } finally {
      await onHost('chmod', '0755', `${HOME}/ro11`).catch(() => undefined);
      await onHost('chmod', '0755', `${HOME}/nw11`).catch(() => undefined);
      await onHost('rm', '-f', `${HOME}/f11`).catch(() => undefined);
      await setting(SETTING, undefined);
    }
  });

  it('F-2407 AC-12 (c2487-homedir): without the setting, a home directory the remote user cannot write gives the same dialog', async () => {
    await freshHost();
    await onHost('chmod', '0555', HOME);
    const name = 'c2487-homedir';
    appendScript(dismissals(name));
    try {
      await setting(SETTING, undefined);
      await openWindow('harness', name);
      const shown = await failedDialog(name);
      deepStrictEqual(
        {
          detail: shown?.details,
          buttons: shown?.buttons,
        },
        {
          detail: DIR_DETAIL,
          buttons: ['Retry', 'More Actions...', 'Close Remote'],
        },
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
      await onHost('chmod', '0755', HOME).catch(() => undefined);
      await setting(SETTING, undefined);
    }
  });

  it("F-2407 AC-13 (c2487-failtable): the install directory failure's table lists its status, its message with $HOME and the setting, and the four mitigations in order", async () => {
    await onHost('mkdir', `${HOME}/ro13`);
    await onHost('chmod', '0555', `${HOME}/ro13`);
    const name = 'c2487-failtable';
    appendScript(dismissals(name));
    try {
      await userSettings({
        ...PLATFORMS,
        'terminal.integrated.tabs.hideCondition': 'never',
        'terminal.integrated.fontSize': 6,
        [SETTING]: value(`${HOME}/ro13`),
      });
      await failedOn('harness', name);
      const table = await wholeTableOf(name);
      deepStrictEqual(
        {
          status: squeezed(columnOf(table, 0).join('')),
          message: squeezed(columnOf(table, 1).join('')),
          mitigations: squeezed(columnOf(table, 2).join('')),
        },
        {
          status: 'CreateInstallDirFailed',
          message: squeezed(
            `The install directory on the remote host could not be created. By default this is the '$HOME' directory and can be overridden with the setting ${SETTING} (Failed to create the remote server's install directory)`,
          ),
          mitigations: squeezed(
            `•Remove or edit setting ${SETTING}•Ensure that the parent directory exists•Ensure that the remote user has write permissions to the parent directory•Ensure there is sufficient free disk space on the remote machine`,
          ),
        },
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
      await onHost('chmod', '0755', `${HOME}/ro13`).catch(() => undefined);
      await setting(SETTING, undefined);
    }
  });

  it('F-2407 AC-14 (c2487-retryfix): the folder made writable at the dialog, then "Retry", reloads the window, installs into the folder and connects', async () => {
    await freshHost();
    await onHost('mkdir', '-p', `${HOME}/ro14`);
    await onHost('chmod', '0555', `${HOME}/ro14`);
    const name = 'c2487-retryfix';
    appendScript(dismissals(name));
    try {
      await setting(SETTING, value(`${HOME}/ro14/inner`));
      await openWindow('harness', name);
      const shown = await failedDialog(name);
      await onHost('chmod', '0755', `${HOME}/ro14`);
      await answerDialog(name, 'Retry');
      await connectedWithin(name, INSTALL_MILLISECONDS);
      deepStrictEqual(
        {
          detail: shown?.details,
          server: await serverAt(`${HOME}/ro14/inner`),
        },
        {detail: DIR_DETAIL, server: true},
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
      await onHost('chmod', '0755', `${HOME}/ro14`).catch(() => undefined);
      await setting(SETTING, undefined);
    }
  });

  it('F-2407 AC-15 (c2487-inertchange): a changed value at a connected window shows nothing and creates nothing, and a reload while the connection server runs keeps the old folder', async () => {
    await freshHost();
    const prior = `${HOME}/cust15`;
    const now = `${HOME}/cust15b`;
    const name = 'c2487-inertchange';
    appendScript(dismissals(name));
    try {
      await setting(SETTING, value(prior));
      await openConnected(name, INSTALL_MILLISECONDS);
      await setting(SETTING, value(now));
      await new Promise(resolve => setTimeout(resolve, 8_000));
      await inWindow(name, 'workbench.action.reloadWindow');
      await connectedWithin(name, INSTALL_MILLISECONDS);
      deepStrictEqual(
        {
          prior: await serverAt(prior),
          now: await serverAt(now),
          dialogs: recordLines('failureDialog', name).length,
        },
        {prior: true, now: false, dialogs: 0},
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
      await setting(SETTING, undefined);
    }
  });

  it('F-2407 AC-16 (c2487-newvalue): after the connection server for the host is ended, the reconnect checks and uses the new value, and the old folder is still on the host', async () => {
    await freshHost();
    const prior = `${HOME}/cust16`;
    const now = `${HOME}/cust16b`;
    const name = 'c2487-newvalue';
    appendScript(dismissals(name));
    try {
      await setting(SETTING, value(prior));
      await openConnected(name, INSTALL_MILLISECONDS);
      await setting(SETTING, value(now));
      await runWith('local', 'opensshremotes.cleanLocalServer', [
        pickHost('harness'),
      ]);
      await waitFor(`the new folder on the host`, () => serverAt(now), 120_000);
      await connectedWithin(name, INSTALL_MILLISECONDS);
      deepStrictEqual(
        {prior: await serverAt(prior), now: await serverAt(now)},
        {prior: true, now: true},
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
      await setting(SETTING, undefined);
    }
  });

  it('F-2407 AC-17 (c2487-hints): a refused connect stores the error hint with the section 7 message, its mitigations in order and its details', async () => {
    const item = 'relative/inst';
    await inWindow('local', 'opensshremotes.clearAllSessionHints');
    const name = 'c2487-hints';
    appendScript(dismissals(name));
    try {
      await setting(SETTING, value(item));
      await openWindow('harness', name);
      await failedDialog(name);
      await waitForRecords(
        'the stored error hint',
        () =>
          hintRecords().some(record =>
            record.hints.some(hint => hint.kind === 'error'),
          ),
        60_000,
      );
      const hint = hintRecords()
        .at(-1)
        ?.hints.find(each => each.kind === 'error');
      deepStrictEqual(
        {
          status: hint?.status,
          message: hint?.message,
          details: hint?.details,
          mitigations: hint?.mitigations,
        },
        {
          status: 'InvalidCustomServerPath',
          message: 'The provided custom server path is invalid',
          details: `Provided: "${item}"`,
          mitigations: [
            'Ensure the provide path is an absolute path',
            `Edit setting ${SETTING} to an absolute path on the remote server`,
            `Do not use variables, double quotes, or other non-path characters when setting ${SETTING}`,
            'Delete the setting for this host to use the default path in the user home directory',
          ],
        },
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
      await setting(SETTING, undefined);
    }
  });

  it('F-2407 AC-18 (c2487-nonstring): a number for the host makes no SSH connection with an undefined folder, writes no setting or file, and the window stays usable', async () => {
    await freshHost();
    const before = readUserSettings();
    await userSettings({...PLATFORMS, [SETTING]: {harness: 42}});
    const name = 'c2487-nonstring';
    appendScript(dismissals(name));
    const since = new Date().toISOString();
    try {
      await openWindow('harness', name);
      await waitFor(
        `the outcome of ${name}`,
        async () =>
          (await dialogOf(name)) !== undefined ||
          recordLines('failureDialog', name).length > 0 ||
          (await serverAt(HOME)) ||
          (await pageText(name)).includes('SSH: harness'),
        90_000,
      );
      const shown = await dialogOf(name);
      deepStrictEqual(
        {
          dialog: shown?.details,
          usable: (await pageText(name)).length > 0,
          unchanged: readUserSettings() === before,
          logins: await acceptedKeyLogins(since),
        },
        {
          dialog: undefined,
          usable: true,
          unchanged: true,
          logins: 1,
        },
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
      await setting(SETTING, undefined);
    }
  });

  it('F-2407 AC-19 (c2487-settingseditor): the Settings editor shows the entry with its exact description and its Item and Value table in the User tab, and a connected window finds none in its Remote or Workspace tab', async () => {
    await inWindow('local', 'workbench.action.openSettings', SETTING);
    const remote = 'c2487-remote-settings';
    appendScript(dismissals(remote));
    try {
      await waitFor(
        'the setting on the Settings editor list',
        async () => (await settingRow('local')) !== undefined,
        30_000,
      );
      const entry = await settingRow('local');
      const local = await pageText('local');
      await openConnected(remote, INSTALL_MILLISECONDS);
      await inWindow(remote, 'workbench.action.openSettings', SETTING);
      await waitFor(
        'the scope tabs on the remote window',
        async () => (await settingsTabs(remote)).length > 0,
        30_000,
      );
      const remoteText = await pageText(remote);
      await settingsTab(remote, 'Workspace');
      const workspaceText = await pageText(remote);
      deepStrictEqual(
        {
          title: entry?.lines[0],
          description: entry?.lines[1] === settingDescription(),
          table: [
            local.includes('Item'),
            local.includes('Value'),
            local.includes('Add Item'),
          ],
          section: entry?.section,
          count: entry?.count,
          tabs: (await settingsTabs(remote)).map(each => each.label),
          remote: remoteText.includes('No Settings Found'),
          workspace: workspaceText.includes('No Settings Found'),
        },
        {
          title: 'Remote.SSH: Server Install Path(Applies to all profiles)',
          description: true,
          table: [true, true, true],
          section: 'User',
          count: 1,
          tabs: ['User', 'Remote [SSH: harness]', 'Workspace'],
          remote: true,
          workspace: true,
        },
      );
    } finally {
      await inWindow('local', 'workbench.action.closeActiveEditor').catch(
        () => undefined,
      );
      await closeWindow(remote).catch(() => undefined);
    }
  });

  it('F-2407 AC-20 (c2487-retryfixed): the value changed to a writable folder at the dialog, then "Retry", reloads the window and installs into the new folder', async () => {
    await freshHost();
    const item = 'relative/inst';
    const fixed = `${HOME}/q20`;
    const name = 'c2487-retryfixed';
    appendScript(dismissals(name));
    try {
      await setting(SETTING, value(item));
      await openWindow('harness', name);
      await failedDialog(name);
      await setting(SETTING, value(fixed));
      await answerDialog(name, 'Retry');
      await waitFor(
        `the new folder on the host`,
        () => serverAt(fixed),
        120_000,
      );
      await connectedWithin(name, INSTALL_MILLISECONDS);
      deepStrictEqual({fixed: await serverAt(fixed)}, {fixed: true});
    } finally {
      await closeWindow(name).catch(() => undefined);
      await setting(SETTING, undefined);
    }
  });

  it('F-2407 AC-21 (c2487-userhost): on a window whose authority names the user, a key with the user prefix alone leaves the home folder, and the host part key is used with or without it', async () => {
    const authority = 'harness@127.0.0.1';
    const folder = `${HOME}/ak21`;
    const entries = [
      {[authority]: folder},
      {'127.0.0.1': folder},
      {[authority]: folder, '127.0.0.1': folder},
    ];
    await keepingSettings(async () => {
      const home = [];
      const named = [];
      for (const [index, entry] of entries.entries()) {
        await userSettings({
          ...PLATFORMS,
          [SETTING]: entry,
        });
        if (index > 0) {
          await runWith('local', 'opensshremotes.cleanLocalServer', [
            pickHost('harness'),
          ]);
        }
        const name = `c2487-userhost-${String(index)}`;
        appendScript(dismissals(name));
        await openWindow(authority, name);
        await connectedWithin(name, INSTALL_MILLISECONDS);
        home.push(await serverAt(HOME));
        named.push(await serverAt(folder));
        await closeWindow(name).catch(() => undefined);
      }
      deepStrictEqual(
        {home, named},
        {
          home: [true, false, false],
          named: [false, true, true],
        },
      );
    });
  });

  it('F-2407 AC-22 (c2487-space): an absolute value holding a space either installs and connects or is refused as in AC-7, and never ends with a partly filled folder and the install failure', async () => {
    const item = `${HOME}/with space`;
    await keepingSettings(async () => {
      const since = new Date().toISOString();
      await setting(SETTING, value(item));
      const name = 'c2487-space';
      appendScript(dismissals(name));
      try {
        await openWindow('harness', name);
        await waitFor(
          `the outcome of ${name}`,
          async () =>
            (await dialogOf(name)) !== undefined || (await serverAt(item)),
          90_000,
        );
        const shown = await dialogOf(name);
        const detail = shown?.details ?? '';
        deepStrictEqual(
          {
            refused: detail === invalidDetail(item),
            installed: (await serverAt(item)) && detail === '',
            partlyFilled:
              (await listed(item))?.some(entry => entry.startsWith('code-')) ??
              false,
            installFailed: detail.includes(
              'Failed to install the VS Code Server',
            ),
            logins: await acceptedKeyLogins(since),
          },
          {
            refused: false,
            installed: true,
            partlyFilled: false,
            installFailed: false,
            logins: 1,
          },
        );
      } finally {
        await closeWindow(name).catch(() => undefined);
        await setting(SETTING, undefined);
      }
    });
  });

  it("F-2407 AC-23 (c2487-reconnectcheck): the reconnect at a value that fails the check makes no SSH connection, opens the troubleshooting terminal, and shows core's Cannot reconnect dialog instead of the refusal dialog", async () => {
    await freshHost();
    const good = `${HOME}/cust23`;
    const refused = 'relative/inst';
    const name = 'c2487-reconnectcheck';
    appendScript(dismissals(name));
    try {
      await setting(SETTING, value(good));
      await openConnected(name, INSTALL_MILLISECONDS);
      await setting(SETTING, value(refused));
      const since = new Date().toISOString();
      await runWith('local', 'opensshremotes.cleanLocalServer', [
        pickHost('harness'),
      ]);
      await waitFor(
        `the reconnect dialog of ${name}`,
        async () =>
          ((await dialogOf(name))?.details ?? '').includes('Cannot reconnect'),
        90_000,
      );
      const shown = await dialogOf(name);
      deepStrictEqual(
        {
          dialog: shown?.details.includes(
            'Cannot reconnect. Please reload the window.',
          ),
          buttons: shown?.buttons,
          terminal: (await pageText(name)).includes('Session Troubleshooting'),
          logins: await acceptedKeyLogins(since),
        },
        {
          dialog: true,
          buttons: ['Cancel', 'Reload Window'],
          terminal: true,
          logins: 0,
        },
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
      await setting(SETTING, undefined);
    }
  });
});
