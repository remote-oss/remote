import {deepStrictEqual, ok} from 'node:assert';
import {readFileSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import type {AppendedEntry} from '../../../tools/script-file.ts';
import {
  aliases,
  appendScript,
  closeWindow,
  connected,
  connectedWithin,
  hostAnswer,
  inWindow,
  newKeyPair,
  nextEmptyWindow,
  onHost,
  onHostAs,
  openWindow,
  recordLines,
  reloadWindow,
  variable,
  waitFor,
  windowEvents,
  windowState,
} from './harness.ts';
import {
  closeAllButLocal,
  DATA_FOLDER,
  FIXED_ROWS,
  harnessPort,
  HOST_QUESTION,
  INSTALL_MILLISECONDS,
  linesSince,
  openConnected,
  openLocalWindow,
  password,
  passwordAskHosts,
  perWindowMode,
  pickHost,
  runWith,
  serverProcesses,
  serversGoneWithin,
  setting,
  settingsText,
  typeHost,
} from './maintenance.ts';

/** The extension's log channel. */
const LOG_CHANNEL = 'Remote - SSH';

/** The answer to the notice of a kill: its Open Logs button. */
const OPEN_LOGS: AppendedEntry = {
  surface: 'notice',
  match: 'VS Code Server on',
  answer: {button: 'Open Logs'},
};

/** The notice of a kill that ran. */
function killed(host: string): string {
  return `Killed VS Code Server on ${host}.`;
}

/** The notice of a kill that could not run. */
function killFailed(host: string): string {
  return `Failed to kill VS Code Server on ${host}.`;
}

/** Has window `name` run Kill VS Code Server on Host..., whose questions are already in the script. */
function killOnHost(name: string): Promise<void> {
  return inWindow(name, 'opensshremotes.cleanRemoteServer');
}

/** Has window `name` run Kill Current VS Code Server. */
function killCurrent(name: string): Promise<void> {
  return inWindow(name, 'opensshremotes.cleanCurrentRemoteServer');
}

/** The notices window `window` showed since `mark`, as their text and buttons. */
function noticesSince(mark: number, window: string): Array<[string, string[]]> {
  return linesSince(mark, window)
    .filter(line => line.surface === 'notice')
    .map(line => [line.question, line.buttons ?? []]);
}

/** Runs a kill on host in window `window` with `answers` scripted for it, and gives the mark it started from. */
function killWith(
  window: string,
  answers: readonly AppendedEntry[],
): Promise<number> {
  return runWith(window, 'opensshremotes.cleanRemoteServer', answers);
}

/** The output channel window `name` shows once the log channel is up, or after 5 s whatever it shows. */
async function shownChannel(name: string): Promise<string | null | undefined> {
  let shown: string | null | undefined;
  await waitFor(
    `${name} to show the log channel`,
    async () => {
      await inWindow(name, 'acceptance.agent.state');
      shown = windowEvents(name)
        .filter(each => each.event === 'state')
        .at(-1)?.visibleOutputChannel;
      return shown === LOG_CHANNEL;
    },
    5000,
  ).catch(() => undefined);
  return shown;
}

describe('Kill VS Code Server (card coverage-39)', function () {
  this.timeout(900_000);

  /** The mark of the record at the first kill of the host, which the next row reads on from. */
  let firstKill = 0;

  /** The settings file before the rows that must not change it, and after them. */
  const settingsAround: Array<[string, string]> = [];

  before(closeAllButLocal);

  it('setup: a window on the host connects and its server runs', async () => {
    await openConnected('x1');
    ok((await serverProcesses()).length > 0);
  });

  it('F-2411 AC-2, AC-4: the host pick lists the hosts and the fixed rows, and Escape kills nothing', async () => {
    const servers = await serverProcesses();
    const mark = await killWith('local', [hostAnswer('local', 'dismiss')]);
    deepStrictEqual(
      [
        recordLines()
          .slice(mark)
          .map(line => [line.window, line.surface, line.question, line.items]),
        await serverProcesses(),
      ],
      [
        [['local', 'hostPick', HOST_QUESTION, [...aliases(), ...FIXED_ROWS]]],
        servers,
      ],
    );
  });

  it('F-2411 AC-3: a host added to the file is in the pick at its place', async () => {
    const file = variable('HARNESS_SSH_CONFIG');
    const original = readFileSync(file, 'utf8');
    const block = original.slice(
      original.indexOf('Host harness\n'),
      original.indexOf('\n\n', original.indexOf('Host harness\n')),
    );
    writeFileSync(
      file,
      `${original}\n${block.replace('Host harness', 'Host kill-new')}\n`,
    );
    try {
      const mark = await killWith('local', [hostAnswer('local', 'dismiss')]);
      deepStrictEqual(
        [
          linesSince(mark, 'local').at(-1)?.items,
          aliases().includes('kill-new'),
        ],
        [[...aliases(), ...FIXED_ROWS], true],
      );
    } finally {
      writeFileSync(file, original);
    }
  });

  it('F-2411 AC-5: a picked host is killed within 2 s, with the notice and no progress', async () => {
    const before = settingsText();
    const state = await windowState('local');
    const servers = await serverProcesses();
    const mark = await killWith('local', [pickHost('harness')]);
    firstKill = mark;
    settingsAround.push([before, settingsText()]);
    const lines = linesSince(mark, 'local');
    const pick = lines.find(line => line.surface === 'hostPick');
    const notice = lines.find(line => line.surface === 'notice');
    await serversGoneWithin(servers, 10_000);
    deepStrictEqual(
      {
        notice: [notice?.question, notice?.buttons],
        within: (notice?.time ?? Infinity) - (pick?.time ?? 0) <= 2000,
        progress: lines.filter(line => line.surface === 'progress'),
        local: await windowState('local'),
      },
      {
        notice: [killed('harness'), ['Open Logs']],
        within: true,
        progress: [],
        local: state,
      },
    );
  });

  it('F-2411 AC-10: the window on the killed host stays where it is, core reconnects it, and a reload connects it', async () => {
    const mark = firstKill;
    await waitFor(
      'x1 to be resolved again by core’s reconnection',
      () =>
        linesSince(mark, 'x1').some(
          line =>
            line.surface === 'progress' &&
            line.question === 'Setting up SSH Host harness',
        ),
      30_000,
    );
    const state = await windowState('x1');
    await reloadWindow('x1');
    deepStrictEqual(
      [state.remoteName, state.folders, await connected('x1')],
      [
        'ssh-remote',
        ['vscode-remote://ssh-remote%2Bharness/home/harness/x1'],
        true,
      ],
    );
  });

  it('F-2411 AC-9: the local window that killed is unchanged', async () => {
    deepStrictEqual(await windowState('local'), {
      remoteName: null,
      remoteAuthority: null,
      folders: [],
    });
  });

  it('F-2411 AC-8: Open Logs on the killed notice shows the log channel', async () => {
    await closeAllButLocal();
    await inWindow('local', 'workbench.action.closePanel');
    const mark = await killWith('local', [pickHost('harness'), OPEN_LOGS]);
    deepStrictEqual(
      [noticesSince(mark, 'local'), await shownChannel('local')],
      [[[killed('harness'), ['Open Logs']]], LOG_CHANNEL],
    );
  });

  it('F-2411 AC-14, AC-8: a refused host fails within 2 s, and Open Logs shows the log channel', async () => {
    await inWindow('local', 'workbench.action.closePanel');
    const before = settingsText();
    const mark = await killWith('local', [pickHost('refused'), OPEN_LOGS]);
    settingsAround.push([before, settingsText()]);
    const lines = linesSince(mark, 'local');
    const pick = lines.find(line => line.surface === 'hostPick');
    const notice = lines.find(line => line.surface === 'notice');
    deepStrictEqual(
      [
        [notice?.question, notice?.buttons],
        (notice?.time ?? Infinity) - (pick?.time ?? 0) <= 2000,
        await shownChannel('local'),
      ],
      [[killFailed('refused'), ['Open Logs']], true, LOG_CHANNEL],
    );
  });

  it('F-2411 AC-13: a host that does not resolve fails with the notice and nothing before it', async () => {
    const mark = await killWith('local', [pickHost('nowhere')]);
    deepStrictEqual(
      linesSince(mark, 'local').map(line => [line.surface, line.question]),
      [
        ['hostPick', HOST_QUESTION],
        ['notice', killFailed('nowhere')],
      ],
    );
  });

  it('F-2411 AC-12: Configure SSH Hosts and Add New SSH Host end the kill with no notice', async () => {
    await openConnected('x1');
    const servers = await serverProcesses();
    const before = settingsText();
    const configure = await killWith('local', [
      pickHost('Configure SSH Hosts...'),
      {surface: 'filePick', match: 'SSH configuration file', answer: 'dismiss'},
    ]);
    const adding = await killWith('local', [
      pickHost('$(plus) Add New SSH Host...'),
      {
        surface: 'textInput',
        match: 'SSH Connection Command',
        answer: 'dismiss',
      },
    ]);
    settingsAround.push([before, settingsText()]);
    deepStrictEqual(
      [
        linesSince(configure, 'local').map(line => line.surface),
        linesSince(adding, 'local').map(line => line.surface),
        await serverProcesses(),
      ],
      [
        ['hostPick', 'filePick', 'hostPick', 'textInput'],
        ['hostPick', 'textInput'],
        servers,
      ],
    );
  });

  it('F-2411 AC-11: a typed user@host:port is killed on its host, named by the host part', async () => {
    await openConnected('x2');
    await closeWindow('x2');
    const servers = await serverProcesses();
    const running = servers.length > 0;
    const mark = await killWith('local', [
      typeHost(`harness@127.0.0.1:${harnessPort()}`),
    ]);
    await serversGoneWithin(servers, 10_000);
    deepStrictEqual(
      [running, noticesSince(mark, 'local')],
      [true, [[killed('127.0.0.1'), ['Open Logs']]]],
    );
  });

  it('F-2411 AC-15: a password host fails when the password is dismissed, and is killed with it', async () => {
    const dismissed = await killWith('local', [
      pickHost('password'),
      {surface: 'maskedInput', match: 'Enter password', answer: 'dismiss'},
    ]);
    const firstNotices = noticesSince(dismissed, 'local');
    const answered = await killWith('local', [
      pickHost('password'),
      password(),
    ]);
    deepStrictEqual(
      [firstNotices, noticesSince(answered, 'local')],
      [
        [[killFailed('password'), ['Open Logs']]],
        [[killed('password'), ['Open Logs']]],
      ],
    );
  });

  it('F-2411 AC-17: an unknown host key dismissed fails and records nothing; accepted, it kills', async () => {
    rmSync(passwordAskHosts(), {force: true});
    const dismissed = await killWith('local', [
      pickHost('password-ask'),
      {surface: 'pick', match: 'has fingerprint', answer: 'dismiss'},
    ]);
    const firstNotices = noticesSince(dismissed, 'local');
    const recorded = (() => {
      try {
        return readFileSync(passwordAskHosts(), 'utf8');
      } catch {
        return '';
      }
    })();
    const accepted = await killWith('local', [
      pickHost('password-ask'),
      {surface: 'pick', match: 'has fingerprint', answer: 'yes'},
      password(),
    ]);
    rmSync(passwordAskHosts(), {force: true});
    deepStrictEqual(
      [firstNotices, recorded, noticesSince(accepted, 'local')],
      [
        [[killFailed('password-ask'), ['Open Logs']]],
        '',
        [[killed('password-ask'), ['Open Logs']]],
      ],
    );
  });

  it('F-2411 AC-16: a changed host key fails with no question', async () => {
    const keyFile = path.join(variable('HARNESS_RUN_FOLDER'), 'kill-wrong-key');
    rmSync(keyFile, {force: true});
    rmSync(`${keyFile}.pub`, {force: true});
    await newKeyPair(keyFile);
    const publicKey = readFileSync(`${keyFile}.pub`, 'utf8')
      .split(' ')
      .slice(0, 2)
      .join(' ');
    writeFileSync(
      passwordAskHosts(),
      `[127.0.0.1]:${harnessPort()} ${publicKey}\n`,
    );
    try {
      const mark = await killWith('local', [pickHost('password-ask')]);
      deepStrictEqual(
        linesSince(mark, 'local').map(line => [line.surface, line.question]),
        [
          ['hostPick', HOST_QUESTION],
          ['notice', killFailed('password-ask')],
        ],
      );
    } finally {
      rmSync(passwordAskHosts(), {force: true});
    }
  });

  it('F-2411 AC-18: an account with no server is killed and still has none', async () => {
    const folder = '/home/harness-nofwd/.vscodium-server-insiders';
    await onHostAs('harness-nofwd', 'rm', '-rf', folder);
    const mark = await killWith('local', [pickHost('noforward')]);
    const exists = await onHostAs('harness-nofwd', 'test', '-e', folder).then(
      () => true,
      () => false,
    );
    deepStrictEqual(
      [noticesSince(mark, 'local'), exists],
      [[[killed('noforward'), ['Open Logs']]], false],
    );
  });

  it('F-2411 AC-30: a remote.SSH.path that names no program does not stop the kill', async () => {
    await setting(
      'remote.SSH.path',
      path.join(variable('HARNESS_RUN_FOLDER'), 'no-such-ssh'),
    );
    try {
      const mark = await killWith('local', [pickHost('harness')]);
      deepStrictEqual(
        linesSince(mark, 'local').map(line => [line.surface, line.question]),
        [
          ['hostPick', HOST_QUESTION],
          ['notice', killed('harness')],
        ],
      );
    } finally {
      await setting('remote.SSH.path', undefined);
    }
  });

  it('F-2411 AC-31: a kill that waits on one host does not hold back a kill of another', async () => {
    await openLocalWindow('kl2', 'kill-folders');
    appendScript([
      {...pickHost('blackhole'), window: 'local'},
      {...pickHost('harness'), window: 'kl2'},
    ]);
    const mark = recordLines().length;
    const waiting = killOnHost('local');
    await killOnHost('kl2');
    await waiting;
    const notices = recordLines()
      .slice(mark)
      .filter(line => line.surface === 'notice')
      .map(line => line.question);
    await closeWindow('kl2');
    deepStrictEqual(notices, [killed('harness'), killFailed('blackhole')]);
  });

  it('F-2411 AC-23: no kill writes the settings file', () => {
    deepStrictEqual(
      settingsAround.map(([before, after]) => before === after),
      [true, true, true],
    );
  });

  /** The server's process ids before the kill of the next row, for the row after it. */
  let killedServers: number[] = [];

  it('F-2411 AC-7: a kill of a server installed without the CLI removes its bin folder, and the next open installs', async () => {
    await closeAllButLocal();
    await setting('remote.SSH.useExecServer', false);
    await openWindow('harness', 'x1');
    await connectedWithin('x1', INSTALL_MILLISECONDS);
    killedServers = await serverProcesses();
    await closeWindow('x1');
    await killWith('local', [pickHost('harness')]);
    const binExists = await onHost('test', '-e', `${DATA_FOLDER}/bin`).then(
      () => true,
      () => false,
    );
    const mark = recordLines().length;
    await openWindow('harness', 'x1');
    await connectedWithin('x1', INSTALL_MILLISECONDS);
    deepStrictEqual(
      [
        binExists,
        linesSince(mark, 'x1').some(
          line =>
            line.surface === 'progress' &&
            line.question === 'Installing VS Code Server',
        ),
      ],
      [false, true],
    );
  });

  it('F-2411 AC-28: the next open starts a new server', async () => {
    const servers = await serverProcesses();
    await setting('remote.SSH.useExecServer', undefined);
    deepStrictEqual(
      [
        killedServers.length > 0,
        servers.length > 0,
        servers.some(server => killedServers.includes(server)),
      ],
      [true, true, false],
    );
  });

  it('F-2411 AC-19: Kill Current in a default-mode window makes it an empty local window and leaves the server', async () => {
    await closeAllButLocal();
    await openConnected('x1');
    const servers = await serverProcesses();
    const name = await nextEmptyWindow(() => killCurrent('x1'));
    const state = await windowState(name);
    deepStrictEqual(
      [state.remoteName, state.folders, await serverProcesses()],
      [null, [], servers],
    );
    await closeWindow(name);
  });

  it('F-2411 AC-20: Kill Current in a per-window window kills the server and keeps the window remote', async () => {
    await closeAllButLocal();
    await perWindowMode(true);
    try {
      await openConnected('x1');
      const servers = await serverProcesses();
      const mark = recordLines().length;
      await killCurrent('x1');
      await serversGoneWithin(servers, 10_000);
      deepStrictEqual(
        [noticesSince(mark, 'x1'), (await windowState('x1')).remoteName],
        [[[killed('harness'), ['Open Logs']]], 'ssh-remote'],
      );
    } finally {
      await closeAllButLocal();
      await perWindowMode(false);
    }
  });

  it('F-2411 AC-21: Kill on Host picking the window’s own host acts as Kill Current, in each mode', async () => {
    await openConnected('x1');
    const servers = await serverProcesses();
    appendScript([{...pickHost('harness'), window: 'x1'}]);
    const name = await nextEmptyWindow(() => killOnHost('x1'));
    const defaultMode = [
      (await windowState(name)).remoteName,
      await serverProcesses(),
    ];
    await closeWindow(name);
    await closeAllButLocal();
    await perWindowMode(true);
    try {
      await openConnected('x1');
      const perWindowServers = await serverProcesses();
      const mark = await killWith('x1', [pickHost('harness')]);
      await serversGoneWithin(perWindowServers, 10_000);
      deepStrictEqual(
        [
          defaultMode,
          noticesSince(mark, 'x1'),
          (await windowState('x1')).remoteName,
        ],
        [[null, servers], [[killed('harness'), ['Open Logs']]], 'ssh-remote'],
      );
    } finally {
      await closeAllButLocal();
      await perWindowMode(false);
    }
  });

  it('F-2411 AC-22: Kill Current outside a connected window does nothing visible', async () => {
    appendScript([
      {
        surface: 'failureDialog',
        match: 'refused',
        answer: 'dismiss',
        window: 'x3',
      },
      {surface: 'mitigationPick', match: '', answer: 'dismiss', window: 'x3'},
    ]);
    await openWindow('refused', 'x3');
    await waitFor(
      'x3 to show its failure',
      () => recordLines('failureDialog', 'x3').length > 0,
      60_000,
    );
    const before = settingsText();
    const mark = recordLines().length;
    await killCurrent('local');
    await killCurrent('x3');
    await inWindow('local', 'acceptance.agent.state');
    await inWindow('x3', 'acceptance.agent.state');
    deepStrictEqual(
      [
        recordLines()
          .slice(mark)
          .filter(line => line.surface === 'notice'),
        settingsText() === before,
      ],
      [[], true],
    );
    await closeWindow('x3');
  });

  it('F-2411 AC-26: Kill Current in one window leaves the other window on the host connected, with no failure dialog', async () => {
    await closeAllButLocal();
    await openConnected('x1');
    await openConnected('x2');
    const mark = recordLines().length;
    const name = await nextEmptyWindow(() => killCurrent('x1'));
    await closeWindow(name);
    await connectedWithin('x2', 60_000);
    deepStrictEqual(
      linesSince(mark, 'x2').filter(line => line.surface === 'failureDialog'),
      [],
    );
    await closeAllButLocal();
  });
});
