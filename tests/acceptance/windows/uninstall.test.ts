import {deepStrictEqual, ok} from 'node:assert';
import {existsSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import type {AppendedEntry} from '../../../tools/script-file.ts';
import {
  agentClear,
  aliases,
  connectionLog,
  connectedWithin,
  hostAnswer,
  inWindow,
  onHost,
  onHostAs,
  recordLines,
  reloadWindow,
  settingIn,
  variable,
  waitFor,
  windowEvents,
  windowState,
} from './harness.ts';
import {
  closeAllButLocal,
  DATA_FOLDER,
  existsOnHost,
  FIXED_ROWS,
  HOST_QUESTION,
  INSTALL_MILLISECONDS,
  linesSince,
  openConnected,
  password,
  passwordAskHosts,
  perWindowMode,
  pickHost,
  runWith,
  serverProcesses,
  setting,
  settingsText,
  typeHost,
} from './maintenance.ts';

/** The message of the handler's error when an uninstall could not run. */
const UNINSTALL_FAILED = 'Failed to run command';

/** The data folder of the password accounts' server. */
const PASSWORD_DATA_FOLDER = '/home/harness-pw/.vscodium-server-insiders';

/** The answer that takes platform `answer` in the platform pick. */
function platform(
  answer: 'linux' | 'windows' | 'macOS' | 'dismiss',
): AppendedEntry {
  return {surface: 'platformPick', match: 'platform', answer};
}

/** Runs an uninstall in window `window` with `answers` scripted for it, and gives the mark it started from. */
function uninstallWith(
  window: string,
  answers: readonly AppendedEntry[],
): Promise<number> {
  return runWith(window, 'opensshremotes.cleanDevBox', answers);
}

/**
 * Runs an uninstall that must fail, and gives its mark, the message it failed with and the time it failed at; a run
 * that succeeds fails the row.
 */
async function failedUninstall(
  window: string,
  answers: readonly AppendedEntry[],
): Promise<{mark: number; message: string; time: number}> {
  const mark = recordLines().length;
  try {
    await uninstallWith(window, answers);
  } catch (caught) {
    return {mark, message: String(caught), time: Date.now()};
  }
  throw new Error('the uninstall did not fail');
}

/** The time of the host pick's line since `mark`, in window `window`. */
function pickTime(mark: number, window: string): number {
  return (
    linesSince(mark, window).find(line => line.surface === 'hostPick')?.time ??
    0
  );
}

/** The surfaces window `window` wrote since `mark`, in order. */
function surfacesSince(mark: number, window: string): string[] {
  return linesSince(mark, window).map(line => line.surface);
}

/** Makes the harness account's data folder, as a server install would leave it. */
function makeDataFolder(): Promise<string> {
  return onHostAs('harness', 'mkdir', '-p', `${DATA_FOLDER}/bin`);
}

/** Waits until `file` no longer exists on the host, for up to 10 s. */
async function goneWithin(file: string): Promise<void> {
  try {
    await waitFor(
      `${file} to be removed`,
      async () => !(await existsOnHost(file)),
      10_000,
    );
  } catch (caught) {
    throw new Error(
      `${String(caught)}; the log:\n${connectionLog().slice(-25).join('\n')}`,
      {cause: caught},
    );
  }
}

/** The names of window `name`'s terminals, as it reports them now. */
async function terminalsOf(name: string): Promise<string[] | undefined> {
  await inWindow(name, 'acceptance.agent.state');
  return windowEvents(name)
    .filter(each => each.event === 'state')
    .at(-1)?.terminals;
}

/** The bytes of the run's keybindings file, or nothing when it doesn't exist. */
function keybindingsText(): string | undefined {
  const file = path.join(
    variable('HARNESS_RUN_FOLDER'),
    'user-data/User/keybindings.json',
  );
  return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
}

/** The user files a row must leave unchanged, as text. */
function userFiles(): [string, string | undefined] {
  return [settingsText(), keybindingsText()];
}

/** The `HostName` the run's `password` block names. */
function passwordHostName(): string {
  const config = readFileSync(variable('HARNESS_SSH_CONFIG'), 'utf8');
  return (
    /HostName (\S+)/.exec(
      config.slice(config.indexOf('Host password\n')),
    )?.[1] ?? ''
  );
}

/** Adds a copy of the `harness` block named `alias` to the run's ssh_config, and gives the original text back. */
function addHarnessCopy(alias: string): string {
  const file = variable('HARNESS_SSH_CONFIG');
  const original = readFileSync(file, 'utf8');
  const start = original.indexOf('Host harness\n');
  const block = original.slice(start, original.indexOf('\n\n', start));
  writeFileSync(
    file,
    `${original}\n${block.replace('Host harness', `Host ${alias}`)}\n`,
  );
  return original;
}

/** Puts the run's ssh_config back to `original`. */
function restoreConfig(original: string): void {
  writeFileSync(variable('HARNESS_SSH_CONFIG'), original);
}

describe('Uninstall VS Code Server (card coverage-40)', function () {
  this.timeout(900_000);

  /** The user files around the rows that must not change them. */
  const filesAround: Array<[unknown, unknown]> = [];

  before(async () => {
    await setting('remote.SSH.remotePlatform', undefined);
    await closeAllButLocal();
  });

  it('setup: a window on the host connects, so its server is installed', async () => {
    await openConnected('u1', INSTALL_MILLISECONDS);
    ok(await existsOnHost(DATA_FOLDER));
  });

  it('F-2412 AC-2, AC-3: the host pick lists the hosts and the fixed rows, and Escape removes nothing', async () => {
    const mark = await uninstallWith('local', [hostAnswer('local', 'dismiss')]);
    deepStrictEqual(
      [
        recordLines()
          .slice(mark)
          .map(line => [line.window, line.surface, line.question, line.items]),
        await existsOnHost(DATA_FOLDER),
      ],
      [
        [['local', 'hostPick', HOST_QUESTION, [...aliases(), ...FIXED_ROWS]]],
        true,
      ],
    );
  });

  it('F-2412 AC-28: a host added to the file is in the pick', async () => {
    const original = addHarnessCopy('uninstall-new');
    try {
      const mark = await uninstallWith('local', [
        hostAnswer('local', 'dismiss'),
      ]);
      deepStrictEqual(
        [
          linesSince(mark, 'local').at(-1)?.items,
          aliases().includes('uninstall-new'),
        ],
        [[...aliases(), ...FIXED_ROWS], true],
      );
    } finally {
      restoreConfig(original);
    }
  });

  it('F-2412 AC-4, AC-5, AC-6: a picked host is uninstalled with no UI, its folder and servers gone, the window unchanged', async () => {
    await closeAllButLocal();
    await openConnected('u1', INSTALL_MILLISECONDS);
    const running = (await serverProcesses()).length > 0;
    const state = await windowState('local');
    const before = userFiles();
    const mark = await uninstallWith('local', [pickHost('harness')]);
    filesAround.push([before, userFiles()]);
    await goneWithin(DATA_FOLDER);
    await waitFor(
      'the server processes to end',
      async () => (await serverProcesses()).length === 0,
      10_000,
    );
    deepStrictEqual(
      [running, surfacesSince(mark, 'local'), await windowState('local')],
      [true, ['hostPick'], state],
    );
  });

  it('F-2412 AC-7: the next open installs the server again', async () => {
    await closeAllButLocal();
    const mark = recordLines().length;
    await openConnected('u1', INSTALL_MILLISECONDS);
    const installing = linesSince(mark, 'u1').filter(
      line =>
        line.surface === 'progress' &&
        /^(Downloading|Installing|Copying) VS Code Server/.test(line.question),
    );
    ok(installing.length > 0, 'no install progress line before u1 connected');
  });

  it('F-2412 AC-22: a typed user@alias is uninstalled with the typed user', async () => {
    await closeAllButLocal();
    const mark = await uninstallWith('local', [typeHost('harness@harness')]);
    await goneWithin(DATA_FOLDER);
    deepStrictEqual(surfacesSince(mark, 'local'), ['hostPick']);
  });

  it('F-2412 AC-12: a refused host fails within 2 s with the handler’s error and no notice of ours', async () => {
    const before = userFiles();
    const failed = await failedUninstall('local', [pickHost('refused')]);
    filesAround.push([before, userFiles()]);
    deepStrictEqual(
      [
        failed.message.includes(UNINSTALL_FAILED),
        failed.time - pickTime(failed.mark, 'local') <= 2000,
        surfacesSince(failed.mark, 'local'),
      ],
      [true, true, ['hostPick']],
    );
  });

  it('F-2412 AC-14: the same command run as a keybinding runs it fails with the same message', async () => {
    const failed = await failedUninstall('local', [pickHost('refused')]);
    ok(failed.message.includes(UNINSTALL_FAILED), failed.message);
  });

  it('F-2412 AC-13: an unreachable host fails between 10 s and 20 s after the pick, with nothing before', async () => {
    const failed = await failedUninstall('local', [pickHost('blackhole')]);
    const elapsed = failed.time - pickTime(failed.mark, 'local');
    deepStrictEqual(
      [
        failed.message.includes(UNINSTALL_FAILED),
        elapsed >= 10_000 && elapsed <= 20_000 ? true : elapsed,
        surfacesSince(failed.mark, 'local'),
      ],
      [true, true, ['hostPick']],
    );
  });

  it('F-2412 AC-15: an account with no server is uninstalled and still has none', async () => {
    const folder = '/home/harness-nofwd/.vscodium-server-insiders';
    await onHostAs('harness-nofwd', 'rm', '-rf', folder);
    const mark = await uninstallWith('local', [pickHost('noforward')]);
    deepStrictEqual(
      [surfacesSince(mark, 'local'), await existsOnHost(folder)],
      [['hostPick'], false],
    );
  });

  it('F-2412 AC-16: a window on the uninstalled host is reconnected by core, and a reload connects it', async () => {
    await closeAllButLocal();
    await openConnected('u1', INSTALL_MILLISECONDS);
    const mark = await uninstallWith('local', [pickHost('harness')]);
    await waitFor(
      'u1 to be resolved again by core’s reconnection',
      () =>
        linesSince(mark, 'u1').some(
          line =>
            line.surface === 'progress' &&
            line.question === 'Setting up SSH Host harness',
        ),
      40_000,
    );
    await reloadWindow('u1');
    await connectedWithin('u1', INSTALL_MILLISECONDS);
  });

  it('F-2412 AC-21: Configure SSH Hosts and Add New SSH Host end the uninstall and remove nothing', async () => {
    await makeDataFolder();
    const configure = await uninstallWith('local', [
      pickHost('Configure SSH Hosts...'),
      {surface: 'filePick', match: 'SSH configuration file', answer: 'dismiss'},
    ]);
    const adding = await uninstallWith('local', [
      pickHost('$(plus) Add New SSH Host...'),
      {
        surface: 'textInput',
        match: 'SSH Connection Command',
        answer: 'dismiss',
      },
    ]);
    deepStrictEqual(
      [
        surfacesSince(configure, 'local'),
        surfacesSince(adding, 'local'),
        await existsOnHost(DATA_FOLDER),
      ],
      [
        ['hostPick', 'filePick', 'hostPick', 'textInput'],
        ['hostPick', 'textInput'],
        true,
      ],
    );
  });

  it('F-2412 AC-26: the uninstall removes only its own data folder, never the siblings', async () => {
    const siblings = [
      '.vscode-server',
      '.vscode-server-insiders',
      '.vscode-remote',
      '.vscode-server-oss',
    ].map(name => `/home/harness/${name}`);
    for (const folder of siblings) {
      await onHostAs('harness', 'mkdir', '-p', folder);
      await onHostAs('harness', 'touch', `${folder}/x`);
    }
    await makeDataFolder();
    try {
      await uninstallWith('local', [pickHost('harness')]);
      await goneWithin(DATA_FOLDER);
      const kept = await Promise.all(
        siblings.map(folder => existsOnHost(`${folder}/x`)),
      );
      deepStrictEqual(kept, [true, true, true, true]);
    } finally {
      await onHost('rm', '-rf', ...siblings);
    }
  });

  it('F-2412 AC-8: an unknown host key accepted is recorded, and the host is uninstalled after the password', async () => {
    rmSync(passwordAskHosts(), {force: true});
    await onHostAs('harness-pw', 'mkdir', '-p', PASSWORD_DATA_FOLDER);
    const mark = await uninstallWith('local', [
      pickHost('password-ask'),
      {surface: 'pick', match: 'has fingerprint', answer: 'yes'},
      password(),
    ]);
    await waitFor(
      `${PASSWORD_DATA_FOLDER} to be removed`,
      async () => !(await existsOnHost(PASSWORD_DATA_FOLDER)),
      10_000,
    );
    const recorded = readFileSync(passwordAskHosts(), 'utf8');
    deepStrictEqual(
      [surfacesSince(mark, 'local'), recorded.trim() !== ''],
      [['hostPick', 'pick', 'maskedInput'], true],
    );
  });

  it('F-2412 AC-9: an unknown host key dismissed or refused fails and records nothing', async () => {
    rmSync(passwordAskHosts(), {force: true});
    const dismissed = await failedUninstall('local', [
      pickHost('password-ask'),
      {surface: 'pick', match: 'has fingerprint', answer: 'dismiss'},
    ]);
    const refused = await failedUninstall('local', [
      pickHost('password-ask'),
      {surface: 'pick', match: 'has fingerprint', answer: 'no'},
    ]);
    deepStrictEqual(
      [
        dismissed.message.includes(UNINSTALL_FAILED),
        refused.message.includes(UNINSTALL_FAILED),
        existsSync(passwordAskHosts()),
      ],
      [true, true, false],
    );
  });

  it('F-2412 AC-11: the password question names the account’s user and host; dismissed it fails, answered it uninstalls', async () => {
    const dismissed = await failedUninstall('local', [
      pickHost('password'),
      {surface: 'maskedInput', match: 'Enter password', answer: 'dismiss'},
    ]);
    const question = linesSince(dismissed.mark, 'local').find(
      line => line.surface === 'maskedInput',
    )?.question;
    await onHostAs('harness-pw', 'mkdir', '-p', PASSWORD_DATA_FOLDER);
    const mark = await uninstallWith('local', [
      pickHost('password'),
      password(),
    ]);
    deepStrictEqual(
      [
        question,
        dismissed.message.includes(UNINSTALL_FAILED),
        surfacesSince(mark, 'local'),
      ],
      [
        `Enter password for harness-pw@${passwordHostName()}`,
        true,
        ['hostPick', 'maskedInput'],
      ],
    );
  });

  it('F-2412 AC-34: a passphrase key dismissed fails and keeps the folder; answered it uninstalls', async () => {
    await agentClear();
    await makeDataFolder();
    const dismissed = await failedUninstall('local', [
      pickHost('passkey'),
      {surface: 'maskedInput', match: 'passphrase', answer: 'dismiss'},
    ]);
    const question = linesSince(dismissed.mark, 'local').find(
      line => line.surface === 'maskedInput',
    )?.question;
    const kept = await existsOnHost(DATA_FOLDER);
    const passphrase = readFileSync(
      variable('HARNESS_PASSPHRASE_FILE'),
      'utf8',
    ).trim();
    const mark = await uninstallWith('local', [
      pickHost('passkey'),
      {surface: 'maskedInput', match: 'passphrase', answer: {text: passphrase}},
    ]);
    await goneWithin(DATA_FOLDER);
    deepStrictEqual(
      [
        question?.startsWith('Enter passphrase for ssh key'),
        kept,
        surfacesSince(mark, 'local'),
      ],
      [true, true, ['hostPick', 'maskedInput']],
    );
  });

  describe('with remote.SSH.useLocalServer false', () => {
    before(async () => {
      await closeAllButLocal();
      await setting('remote.SSH.remotePlatform', undefined);
      await setting('remote.SSH.useLocalServer', false);
    });

    after(async () => {
      await closeAllButLocal();
      await setting('remote.SSH.remotePlatform', undefined);
      await setting('remote.SSH.useLocalServer', undefined);
    });

    it('F-2412 AC-18: the platform pick is asked, no terminal stays, and Linux uninstalls', async () => {
      await makeDataFolder();
      const terminals = await terminalsOf('local');
      const mark = await uninstallWith('local', [
        pickHost('harness'),
        platform('linux'),
      ]);
      await goneWithin(DATA_FOLDER);
      deepStrictEqual(
        [surfacesSince(mark, 'local'), await terminalsOf('local')],
        [['hostPick', 'platformPick'], terminals],
      );
    });

    it('F-2412 AC-29: the next uninstall asks again, and no platform entry was written', async () => {
      await makeDataFolder();
      const mark = await uninstallWith('local', [
        pickHost('harness'),
        platform('linux'),
      ]);
      await goneWithin(DATA_FOLDER);
      deepStrictEqual(
        [
          surfacesSince(mark, 'local'),
          (await settingIn('local', 'remote.SSH.remotePlatform')) ?? null,
          settingsText().includes('"harness"'),
        ],
        [['hostPick', 'platformPick'], null, false],
      );
    });

    it('F-2412 AC-30: an entry or a wildcard entry for the alias skips the pick; another alias still gets it', async () => {
      const original = addHarnessCopy('uninstall-new');
      try {
        await setting('remote.SSH.remotePlatform', {harness: 'linux'});
        await makeDataFolder();
        const exact = await uninstallWith('local', [pickHost('harness')]);
        await goneWithin(DATA_FOLDER);
        await setting('remote.SSH.remotePlatform', {'uninstall-*': 'linux'});
        await makeDataFolder();
        const wildcard = await uninstallWith('local', [
          pickHost('uninstall-new'),
        ]);
        await goneWithin(DATA_FOLDER);
        const other = await uninstallWith('local', [
          pickHost('password'),
          platform('dismiss'),
        ]);
        deepStrictEqual(
          [
            surfacesSince(exact, 'local'),
            surfacesSince(wildcard, 'local'),
            surfacesSince(other, 'local'),
          ],
          [['hostPick'], ['hostPick'], ['hostPick', 'platformPick']],
        );
      } finally {
        restoreConfig(original);
        await setting('remote.SSH.remotePlatform', undefined);
      }
    });

    it('F-2412 AC-31: Escape at the platform pick ends the uninstall with nothing changed', async () => {
      await makeDataFolder();
      const before = userFiles();
      const mark = await uninstallWith('local', [
        pickHost('harness'),
        platform('dismiss'),
      ]);
      filesAround.push([before, userFiles()]);
      deepStrictEqual(
        [surfacesSince(mark, 'local'), await existsOnHost(DATA_FOLDER)],
        [['hostPick', 'platformPick'], true],
      );
    });

    it('F-2412 AC-33: macOS uninstalls as Linux does', async () => {
      await uninstallWith('local', [pickHost('harness'), platform('macOS')]);
      await goneWithin(DATA_FOLDER);
      await waitFor(
        'the server processes to end',
        async () => (await serverProcesses()).length === 0,
        10_000,
      );
    });

    it('F-2412 AC-36: a window on the host is reconnected by core, and a reload installs and connects it', async () => {
      await closeAllButLocal();
      await perWindowMode(true);
      await openConnected('u1', INSTALL_MILLISECONDS);
      const mark = await uninstallWith('local', [pickHost('harness')]);
      await waitFor(
        'u1 to be resolved again by core’s reconnection',
        () =>
          linesSince(mark, 'u1').some(
            line =>
              line.surface === 'progress' &&
              line.question === 'Setting up SSH Host harness',
          ),
        30_000,
      );
      const reload = recordLines().length;
      await reloadWindow('u1');
      await connectedWithin('u1', INSTALL_MILLISECONDS);
      ok(
        linesSince(reload, 'u1').some(
          line =>
            line.surface === 'progress' &&
            /^(Downloading|Installing|Copying) VS Code Server/.test(
              line.question,
            ),
        ),
        'no install progress line after the reload',
      );
    });
  });

  describe('afterwards', () => {
    it('F-2412 AC-23: no uninstall writes the settings or the keybindings file', () => {
      deepStrictEqual(
        filesAround.map(
          ([before, after]) => JSON.stringify(before) === JSON.stringify(after),
        ),
        [true, true, true],
      );
    });
  });
});
