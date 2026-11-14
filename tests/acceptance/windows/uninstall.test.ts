import {deepStrictEqual, ok} from 'node:assert';
import {existsSync, readFileSync, rmSync} from 'node:fs';
import path from 'node:path';
import type {AppendedEntry} from '../../../tools/script-file.ts';
import {
  agentClear,
  appendScript,
  closeWindow,
  connectedWithin,
  connectionLog,
  hostAliases,
  hostAnswer,
  inWindow,
  nextEmptyWindow,
  onHost,
  onHostAs,
  openWindow,
  recordLines,
  reloadWindow,
  terminalsOf,
  userScopeHolds,
  variable,
  waitFor,
  windowState,
} from './harness.ts';
import {
  closeAllButLocal,
  DATA_FOLDER,
  addHarnessCopy,
  existsOnHost,
  FIXED_ROWS,
  HOST_QUESTION,
  INSTALL_MILLISECONDS,
  linesSince,
  waitForReconnection,
  openConnected,
  password,
  passwordAskHosts,
  perWindowMode,
  pickHost,
  platformAnswer,
  restoreConfig,
  runWith,
  serverProcesses,
  serversGoneWithin,
  setting,
  settingsText,
  typeHost,
} from './maintenance.ts';

/** The message of the handler's error when an uninstall could not run. */
const UNINSTALL_FAILED = 'Failed to run command';

/** The data folder of the password accounts' server. */
const PASSWORD_DATA_FOLDER = '/home/harness-pw/.vscodium-server-insiders';

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
  throw new Error(
    `the uninstall did not fail; ${window}'s record: ${JSON.stringify(linesSince(mark, window))}`,
  );
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
async function removedWithin(file: string): Promise<void> {
  try {
    await waitFor(
      `${file} to be removed`,
      async () => !(await existsOnHost(file)),
      10_000,
    );
  } catch (caught) {
    throw new Error(
      `${String(caught)}; local's last lines: ${JSON.stringify(recordLines(undefined, 'local').slice(-4))}; the log:\n${connectionLog().slice(-25).join('\n')}`,
      {cause: caught},
    );
  }
}

/** The bytes of the launch's keybindings file, or nothing when it doesn't exist. */
function keybindingsText(): string | undefined {
  const file = path.join(
    variable('HARNESS_USER_DATA'),
    'User/keybindings.json',
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

/**
 * The server processes once the list has stopped changing: the same list on two reads half a second apart, for up to
 * 15 s. The windows closed before it leave their server-side extension hosts exiting for a moment, and a child the
 * server starts late joins the list, so a snapshot taken at once can differ from the one 2 s later with nothing
 * uninstalled (#2569).
 */
async function settledServerProcesses(): Promise<number[]> {
  let last = await serverProcesses();
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 500));
    const next = await serverProcesses();
    if (JSON.stringify(next) === JSON.stringify(last)) {
      break;
    }
    last = next;
  }
  snapshotListing = await hostListing();
  return last;
}

/** The host's processes with their parent, age and command line, as `ps` lists them; none when it cannot be read. */
async function hostListing(): Promise<string[]> {
  try {
    return (await onHost('ps', '-o', 'pid,ppid,etime,args')).split('\n');
  } catch {
    return [];
  }
}

/** The host's processes as they were when the last settled snapshot was taken, which names a process that ended since. */
let snapshotListing: string[] = [];

/** The line of `listing` for process `processId`, or `gone` when it holds none. */
function lineOf(listing: readonly string[], processId: number): string {
  return (
    listing
      .find(line => line.trim().startsWith(`${String(processId)} `))
      ?.trim() ?? 'gone'
  );
}

/**
 * What tells a server process that appeared after a snapshot (a child the server starts late) from one that ended
 * (an extension host still exiting), for the failure of a row that compares two snapshots to name (#2569): each
 * process that appeared, as the host lists it now, and each that ended, as it was listed with the snapshot, with its
 * parent, age and command line. Nothing when the two are the same.
 */
async function processFacts(
  before: readonly number[],
  after: readonly number[],
): Promise<string | undefined> {
  const appeared = after.filter(processId => !before.includes(processId));
  const ended = before.filter(processId => !after.includes(processId));
  if (appeared.length === 0 && ended.length === 0) {
    return undefined;
  }
  const now = await hostListing();
  return `processes that appeared since the snapshot, listed now: ${JSON.stringify(appeared.map(processId => `${String(processId)} -> ${lineOf(now, processId)}`))}; processes that ended, listed with the snapshot: ${JSON.stringify(ended.map(processId => `${String(processId)} -> ${lineOf(snapshotListing, processId)}`))}`;
}

describe('Uninstall VS Code Server (card coverage-40)', function () {
  this.timeout(900_000);

  /** The user files around the rows that must not change them. */
  const filesAround: Array<[string, unknown, unknown]> = [];

  before(async () => {
    await setting('remote.SSH.remotePlatform', undefined);
    await setting('remote.SSH.useLocalServer', undefined);
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
        [
          [
            'local',
            'hostPick',
            HOST_QUESTION,
            [...hostAliases(), ...FIXED_ROWS],
          ],
        ],
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
          hostAliases().includes('uninstall-new'),
        ],
        [[...hostAliases(), ...FIXED_ROWS], true],
      );
    } finally {
      restoreConfig(original);
    }
  });

  it('F-2412 AC-4, AC-5, AC-6: a picked host is uninstalled with no UI, its folder and servers gone, the window unchanged', async () => {
    await closeAllButLocal();
    await openConnected('u1', INSTALL_MILLISECONDS);
    const servers = await serverProcesses();
    const state = await windowState('local');
    const marker = `${DATA_FOLDER}/uninstall-marker`;
    await onHostAs('harness', 'touch', marker);
    const before = userFiles();
    const mark = await uninstallWith('local', [pickHost('harness')]);
    filesAround.push(['AC-4', before, userFiles()]);
    const removed = !(await existsOnHost(marker));
    await serversGoneWithin(servers, 10_000);
    deepStrictEqual(
      [
        servers.length > 0,
        removed,
        surfacesSince(mark, 'local'),
        await windowState('local'),
      ],
      [true, true, ['hostPick'], state],
    );
    await closeAllButLocal();
  });

  it('F-2412 AC-35 (c100-host-kinds): on the Alpine host whose login shell is BusyBox sh and which has no bash, directly and through a ProxyJump, an uninstall shows no UI and removes the data folder', async () => {
    await closeAllButLocal();
    // The image carries bash for the rows that want it; this one runs without it, and puts it back in the `finally`.
    await onHostAs('root', 'mv', '/bin/bash', '/bin/bash.off');
    try {
      const login = (
        await onHostAs('harness', 'sh', '-c', 'getent passwd harness')
      ).trim();
      const facts = {
        alpine: (await onHostAs('harness', 'cat', '/etc/os-release')).includes(
          'ID=alpine',
        ),
        loginShell: login.split(':').at(-1),
        bash: (
          await onHostAs('harness', 'sh', '-c', 'command -v bash || echo none')
        ).trim(),
      };
      const seen: unknown[] = [];
      for (const [alias, window] of [
        ['harness', 'u35a'],
        ['jumped', 'u35b'],
      ] as const) {
        await openWindow(alias, window);
        await connectedWithin(window, INSTALL_MILLISECONDS);
        const installed = await existsOnHost(DATA_FOLDER);
        await closeAllButLocal();
        const mark = await uninstallWith('local', [pickHost(alias)]);
        await removedWithin(DATA_FOLDER);
        seen.push([alias, installed, surfacesSince(mark, 'local')]);
      }
      deepStrictEqual(
        [facts, seen],
        [
          {alpine: true, loginShell: '/bin/sh', bash: 'none'},
          [
            ['harness', true, ['hostPick']],
            ['jumped', true, ['hostPick']],
          ],
        ],
      );
    } finally {
      await onHostAs('root', 'mv', '/bin/bash.off', '/bin/bash');
    }
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
    await removedWithin(DATA_FOLDER);
    deepStrictEqual(surfacesSince(mark, 'local'), ['hostPick']);
  });

  it('F-2412 AC-12: a refused host fails within 2 s with the handler’s error and no notice of ours', async () => {
    const before = userFiles();
    const failed = await failedUninstall('local', [pickHost('refused')]);
    filesAround.push(['AC-12', before, userFiles()]);
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
    await waitForReconnection(mark, 'u1', 'harness', 40_000);
    await reloadWindow('u1');
    await connectedWithin('u1', INSTALL_MILLISECONDS);
  });

  it('F-2412 AC-21: Configure SSH Hosts and Add New SSH Host end the uninstall and remove nothing', async () => {
    await closeAllButLocal();
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
      await removedWithin(DATA_FOLDER);
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
    await removedWithin(DATA_FOLDER);
    deepStrictEqual(
      [
        question?.startsWith('Enter passphrase for ssh key'),
        kept,
        surfacesSince(mark, 'local'),
      ],
      [true, true, ['hostPick', 'maskedInput']],
    );
  });

  it('F-2412 AC-20: with serverInstallPath set, the home data folder goes, the servers stop and the custom folder stays', async () => {
    const custom = '/home/harness/custom';
    await setting('remote.SSH.serverInstallPath', {harness: custom});
    try {
      await onHostAs('harness', 'mkdir', '-p', custom);
      await onHostAs('harness', 'touch', `${custom}/keep.txt`);
      await makeDataFolder();
      await openConnected('u1', INSTALL_MILLISECONDS);
      await closeAllButLocal();
      const mark = await uninstallWith('local', [pickHost('harness')]);
      await removedWithin(DATA_FOLDER);
      await waitFor(
        'no server process of the run',
        async () => (await serverProcesses()).length === 0,
        10_000,
      );
      deepStrictEqual(
        [
          await existsOnHost(`${custom}/keep.txt`),
          surfacesSince(mark, 'local'),
        ],
        [true, ['hostPick']],
      );
    } finally {
      await setting('remote.SSH.serverInstallPath', undefined);
      await onHostAs('harness', 'rm', '-rf', custom);
    }
  });

  it('F-2412 AC-17 (c43-own-alias): picking the window’s own host turns the window into an empty local window within 1 s, with no notice, and leaves the host', async () => {
    await closeAllButLocal();
    await openConnected('u1', INSTALL_MILLISECONDS);
    await makeDataFolder();
    const started = Date.now();
    let picked = 0;
    const name = await nextEmptyWindow(async () => {
      appendScript([{...pickHost('harness'), window: 'u1'}]);
      await inWindow('u1', 'opensshremotes.cleanDevBox');
      picked = Date.now();
    });
    const state = await windowState(name);
    deepStrictEqual(
      [
        state.remoteName,
        state.folders,
        picked - started <= 1000 ? true : picked - started,
        linesSince(0, name).filter(line => line.surface === 'notice'),
        await existsOnHost(DATA_FOLDER),
      ],
      [null, [], true, [], true],
    );
    await closeWindow(name);
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

    it('F-2412 AC-18, F-2206 AC-33: the platform pick is asked, no terminal stays, and Linux uninstalls', async () => {
      await makeDataFolder();
      const terminals = await terminalsOf('local');
      const mark = await uninstallWith('local', [
        pickHost('harness'),
        platformAnswer('linux'),
      ]);
      await removedWithin(DATA_FOLDER);
      deepStrictEqual(
        [surfacesSince(mark, 'local'), await terminalsOf('local')],
        [['hostPick', 'platformPick'], terminals],
      );
    });

    it('F-2412 AC-29, F-2206 AC-33: the next uninstall asks again, and no platform entry was written', async () => {
      await makeDataFolder();
      const mark = await uninstallWith('local', [
        pickHost('harness'),
        platformAnswer('linux'),
      ]);
      await removedWithin(DATA_FOLDER);
      deepStrictEqual(
        [
          surfacesSince(mark, 'local'),
          await userScopeHolds('local', 'remote.SSH.remotePlatform'),
          settingsText().includes('"harness"'),
        ],
        [['hostPick', 'platformPick'], false, false],
      );
    });

    it('F-2412 AC-30: an entry or a wildcard entry for the alias skips the pick; another alias still gets it', async () => {
      const original = addHarnessCopy('uninstall-new');
      try {
        await setting('remote.SSH.remotePlatform', {harness: 'linux'});
        await makeDataFolder();
        const exact = surfacesSince(
          await uninstallWith('local', [pickHost('harness')]),
          'local',
        );
        await removedWithin(DATA_FOLDER);
        await setting('remote.SSH.remotePlatform', {'uninstall-*': 'linux'});
        await makeDataFolder();
        const wildcard = surfacesSince(
          await uninstallWith('local', [pickHost('uninstall-new')]),
          'local',
        );
        await removedWithin(DATA_FOLDER);
        const other = await uninstallWith('local', [
          pickHost('password'),
          platformAnswer('dismiss'),
        ]);
        deepStrictEqual(
          [exact, wildcard, surfacesSince(other, 'local')],
          [['hostPick'], ['hostPick'], ['hostPick', 'platformPick']],
        );
      } finally {
        restoreConfig(original);
        await setting('remote.SSH.remotePlatform', undefined);
      }
    });

    it('F-2412 AC-31, F-2206 AC-33: Escape at the platform pick ends the uninstall with nothing changed', async () => {
      await makeDataFolder();
      const before = userFiles();
      const mark = await uninstallWith('local', [
        pickHost('harness'),
        platformAnswer('dismiss'),
      ]);
      filesAround.push(['AC-31', before, userFiles()]);
      deepStrictEqual(
        [surfacesSince(mark, 'local'), await existsOnHost(DATA_FOLDER)],
        [['hostPick', 'platformPick'], true],
      );
    });

    it('F-2412 AC-32: Windows answered for a Linux host shows nothing and changes nothing', async () => {
      await closeAllButLocal();
      await makeDataFolder();
      await perWindowMode(true);
      await openConnected('u1', INSTALL_MILLISECONDS);
      // The pick is asked only for a host with no `remotePlatform` entry; the window above needed one.
      await setting('remote.SSH.remotePlatform', undefined);
      const servers = await settledServerProcesses();
      const mark = await uninstallWith('local', [
        pickHost('harness'),
        platformAnswer('windows'),
      ]);
      await new Promise(resolve => setTimeout(resolve, 2000));
      const observed = await serverProcesses();
      deepStrictEqual(
        [
          servers.length > 0,
          surfacesSince(mark, 'local'),
          observed,
          await existsOnHost(DATA_FOLDER),
        ],
        [true, ['hostPick', 'platformPick'], servers, true],
        await processFacts(servers, observed),
      );
      await closeAllButLocal();
    });

    it('F-2412 AC-33: macOS uninstalls as Linux does', async () => {
      await uninstallWith('local', [
        pickHost('harness'),
        platformAnswer('macOS'),
      ]);
      await removedWithin(DATA_FOLDER);
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
      await waitForReconnection(mark, 'u1', 'harness', 30_000);
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

    it('F-2412 AC-25 (c43-unknown-key): with no local server, a host whose key is unknown is not uninstalled by the pick, writes no setting, and leaves the window usable', async () => {
      rmSync(passwordAskHosts(), {force: true});
      await onHostAs('harness-pw', 'mkdir', '-p', PASSWORD_DATA_FOLDER);
      const before = userFiles();
      const mark = recordLines().length;
      await uninstallWith('local', [
        pickHost('password-ask'),
        platformAnswer('linux'),
      ]).catch(() => undefined);
      await new Promise(resolve => setTimeout(resolve, 5000));
      await inWindow('local', 'acceptance.agent.state');
      deepStrictEqual(
        [
          surfacesSince(mark, 'local'),
          await existsOnHost(PASSWORD_DATA_FOLDER),
          userFiles(),
          existsSync(passwordAskHosts()),
        ],
        [['hostPick', 'platformPick', 'pick'], true, before, false],
      );
    });
  });

  describe('afterwards', () => {
    it('F-2412 AC-23: no uninstall writes the settings or the keybindings file', () => {
      deepStrictEqual(
        filesAround.map(([label, before, after]) => [
          label,
          JSON.stringify(before) === JSON.stringify(after),
        ]),
        [
          ['AC-4', true],
          ['AC-12', true],
          ['AC-31', true],
        ],
      );
    });
  });
});
