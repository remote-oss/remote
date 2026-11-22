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
  signal,
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

/** The part of the connect's failure text that every failure dialog carries, for a script entry's match. */
const DIALOG_MATCH = 'Could not establish connection';

/** Waits for window `name`'s failure dialog to be recorded and gives the line: its text and the buttons it was shown with. */
async function refusedLine(name: string, milliseconds = 30_000) {
  await waitFor(
    `the failure dialog of ${name}`,
    () => recordLines('failureDialog', name).length > 0,
    milliseconds,
  );
  return recordLines('failureDialog', name)[0];
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
        await waitFor(
          `the server in ${folder}`,
          async () =>
            (await listed(`${folder}/${SERVER_NAME}/bin`)) !== undefined,
          60_000,
        );
        deepStrictEqual(
          {
            server: await serverAt(folder),
            binary:
              (await listed(`${folder}/${SERVER_NAME}/bin`)) !== undefined,
            homeBinary:
              (await listed(`${HOME}/${SERVER_NAME}/bin`)) !== undefined,
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
          {entries: [SERVER_NAME], home: ['cust2']},
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
      const items = chars.map(each => `/c8${each}`);
      for (const [index, item] of items.entries()) {
        await setting(SETTING, value(item));
        if (index > 0) {
          await runWith('local', 'opensshremotes.cleanLocalServer', [
            pickHost('harness'),
          ]);
        }
        const name = `c2487-charset-${String(index)}`;
        appendScript([
          {
            surface: 'failureDialog',
            match: DIALOG_MATCH,
            answer: 'dismiss',
            window: name,
          },
        ]);
        await openWindow('harness', name);
        const line = await refusedLine(name);
        details.push(line?.question ?? '');
        await closeWindow(name).catch(() => undefined);
      }
      deepStrictEqual(
        {details, logins: await acceptedKeyLogins(since)},
        {details: items.map(invalidDetail), logins: 0},
      );
    });
  });

  it('F-2407 AC-8 (c2487-charset-part2): the bang, ampersand, brackets, braces, angle, pipe, question, caret, plus, backslash, tab and non-ASCII letter in an absolute value are all refused as in AC-7, with no SSH login', async () => {
    await keepingSettings(async () => {
      const chars = [
        '!',
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
      const items = chars.map(each => `/c8${each}`);
      for (const [index, item] of items.entries()) {
        await setting(SETTING, value(item));
        if (index > 0) {
          await runWith('local', 'opensshremotes.cleanLocalServer', [
            pickHost('harness'),
          ]);
        }
        const name = `c2487-charset2-${String(index)}`;
        appendScript([
          {
            surface: 'failureDialog',
            match: DIALOG_MATCH,
            answer: 'dismiss',
            window: name,
          },
        ]);
        await openWindow('harness', name);
        const line = await refusedLine(name);
        details.push(line?.question ?? '');
        await closeWindow(name).catch(() => undefined);
      }
      deepStrictEqual(
        {details, logins: await acceptedKeyLogins(since)},
        {
          details: items.map(invalidDetail),
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
      appendScript([
        {
          surface: 'failureDialog',
          match: DIALOG_MATCH,
          answer: {button: 'Retry'},
          window: name,
        },
        {
          surface: 'failureDialog',
          match: DIALOG_MATCH,
          answer: 'dismiss',
          window: name,
        },
      ]);
      try {
        await openWindow('harness', name);
        await waitFor(
          `the dialog again on ${name}`,
          () => recordLines('failureDialog', name).length > 1,
          60_000,
        );
        const lines = recordLines('failureDialog', name);
        deepStrictEqual(
          {
            first: lines[0]?.question,
            again: lines[1]?.question,
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
    const hold = 'c2487-retryfix-hold';
    appendScript([
      {
        surface: 'failureDialog',
        match: DIALOG_MATCH,
        answer: {button: 'Retry'},
        window: name,
        after: hold,
      },
    ]);
    try {
      await setting(SETTING, value(`${HOME}/ro14/inner`));
      await openWindow('harness', name);
      await waitFor(
        `the held dialog on ${name}`,
        () =>
          recordLines('failureDialog', name).some(
            line => line.answer === 'held',
          ),
        INSTALL_MILLISECONDS,
      );
      const held = recordLines('failureDialog', name).find(
        line => line.answer === 'held',
      );
      await onHost('chmod', '0755', `${HOME}/ro14`);
      signal(hold);
      await connectedWithin(name, INSTALL_MILLISECONDS);
      deepStrictEqual(
        {
          detail: held?.question,
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

  it('F-2407 AC-18 (c2487-nonstring): a number for the host makes no SSH connection with an undefined folder, writes no setting or file, and the window stays usable', async () => {
    await freshHost();
    await userSettings({...PLATFORMS, [SETTING]: {harness: 42}});
    const afterWrite = readUserSettings();
    const name = 'c2487-nonstring';
    appendScript(dismissals(name));
    const since = new Date().toISOString();
    try {
      await openWindow('harness', name);
      await waitFor(
        `the outcome of ${name}`,
        async () =>
          (await dialogOf(name)) !== undefined || (await serverAt(HOME)),
        120_000,
      );
      // The dialog of 7.E4, when it comes, comes within two seconds of the window starting: give it time.
      await new Promise(resolve => setTimeout(resolve, 15_000));
      const shown = await dialogOf(name);
      const homeInstall = await serverAt(HOME);
      console.log(
        `c2487-nonstring the open dialog's detail: ${JSON.stringify(shown?.details ?? null)}; the home install: ${String(homeInstall)}`,
      );
      deepStrictEqual(
        {
          logins: await acceptedKeyLogins(since),
          unchanged: readUserSettings() === afterWrite,
          usable: (await pageText(name)).length > 0,
        },
        {logins: homeInstall ? 1 : 0, unchanged: true, usable: true},
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
      await settingsTab(remote, 'Remote [SSH: harness]');
      const remoteText = await pageText(remote);
      await settingsTab(remote, 'Workspace');
      const workspaceText = await pageText(remote);
      console.log(
        `c2487-settingseditor the entry's lines: ${JSON.stringify(entry?.lines ?? [])}`,
      );
      console.log(
        `c2487-settingseditor the expected description: ${JSON.stringify(settingDescription())}`,
      );
      console.log(
        `c2487-settingseditor the remote window's setting lines: ${JSON.stringify(
          remoteText
            .split('\n')
            .filter(line => /ettings|Found/i.test(line))
            .slice(0, 10),
        )}`,
      );
      console.log(
        `c2487-settingseditor the workspace tab's setting lines: ${JSON.stringify(
          workspaceText
            .split('\n')
            .filter(line => /ettings|Found/i.test(line))
            .slice(0, 10),
        )}`,
      );
      deepStrictEqual(
        {
          title: entry?.lines[0],
          description: entry?.lines[2] === settingDescription(),
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
          title: 'Remote.SSH: Server Install Path',
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
    const hold = 'c2487-retryfixed-hold';
    appendScript([
      {
        surface: 'failureDialog',
        match: DIALOG_MATCH,
        answer: {button: 'Retry'},
        window: name,
        after: hold,
      },
    ]);
    try {
      await setting(SETTING, value(item));
      await openWindow('harness', name);
      await waitFor(
        `the held dialog on ${name}`,
        () =>
          recordLines('failureDialog', name).some(
            line => line.answer === 'held',
          ),
        30_000,
      );
      const held = recordLines('failureDialog', name).find(
        line => line.answer === 'held',
      );
      await setting(SETTING, value(fixed));
      signal(hold);
      await waitFor(
        `the new folder on the host`,
        () => serverAt(fixed),
        120_000,
      );
      await connectedWithin(name, INSTALL_MILLISECONDS);
      deepStrictEqual(
        {detail: held?.question, fixed: await serverAt(fixed)},
        {detail: invalidDetail(item), fixed: true},
      );
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
        await freshHost();
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
        await openWindow(authority, name);
        await connectedWithin(name, INSTALL_MILLISECONDS);
        home.push((await listed(`${HOME}/${SERVER_NAME}/bin`)) !== undefined);
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
});
