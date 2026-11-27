import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {
  acceptedKeyLogins,
  appendScript,
  closeWindow,
  connectionHelpers,
  connectedEmpty,
  connectedWithin,
  emptyWindows,
  hexOf,
  hostAnswer,
  hostConnections,
  hostPort,
  inWindow,
  nextEmptyName,
  nextEmptyWindow,
  openWindow,
  recordLines,
  readUserSettings,
  RESOLVING_INDICATOR,
  restoreUserSettings,
  sshdLog,
  userSettings,
  variable,
  waitFor,
  windowEvents,
  windowNames,
  windowState,
} from '../windows/harness.ts';
import {bindKeys} from '../windows/explorer-folders.ts';
import {
  openFolderWindow,
  openWorkspaceWindow,
} from '../windows/folder-windows.ts';
import {closeAllButLocal, serverMainProcesses} from '../windows/maintenance.ts';
import {paletteItems} from '../windows/palette.ts';
import {
  allQuickPickRows,
  pressControlAlt,
  pressEscape,
  quickPickOf,
  statusBarText,
} from '../windows/renderer.ts';
import {PLATFORMS} from '../windows/tunnel-support.ts';

/** The command that reloads the window it runs in onto a picked host. */
const SWITCH = 'opensshremotes.openEmptyWindowInCurrentWindow';

/** The folder `name` of the launch's run, made. */
function folderOf(name: string): string {
  const folder = path.join(variable('HARNESS_RUN_FOLDER'), name);
  mkdirSync(folder, {recursive: true});
  return folder;
}

/** The failing new window's entries: the dialog, then the pick of actions, both dismissed. */
function failureEntries(window: string) {
  return [
    {
      surface: 'failureDialog',
      match: 'Could not establish connection',
      answer: 'dismiss',
      window,
    },
    {
      surface: 'mitigationPick',
      match: 'Pick an action',
      answer: 'dismiss',
      window,
    },
  ] as const;
}

/** Runs the switch of local folder window `first`, answered by `answer`, and gives the empty window it comes back as. */
async function switched(
  first: string,
  answer: Parameters<typeof hostAnswer>[1],
): Promise<string> {
  appendScript([hostAnswer(first, answer)]);
  const next = await nextEmptyWindow(() => inWindow(first, SWITCH));
  await waitFor(
    `${next} to show its host`,
    async () => (await windowState(next)).remoteName === 'ssh-remote',
    120_000,
  );
  return next;
}

/** The pids of this machine's ssh processes toward the host. */
async function sshOfHost(): Promise<number[]> {
  return (await hostConnections())
    .filter(each => each.program === 'ssh')
    .map(each => each.processId);
}

/**
 * The pids of the ssh toward the host that `after` lists but `before` does not: the row's own, started by its
 * windows between the two reads — in the local-server mode as the ssh of a connection helper, in the terminal
 * mode without one — while a master another row's ControlPersist left is in both and not among them (card
 * #3131).
 */
function newSsh(before: readonly number[], after: readonly number[]): number[] {
  return after.filter(each => !before.includes(each));
}

/** The linux clock ticks per second that /proc's process starttimes count in. */
const TICKS_PER_SECOND = 100;

/** The argv of process `processId`, read from /proc, or undefined when it ended between the listing and the read. */
function commandLineOf(processId: number): string[] | undefined {
  try {
    return readFileSync(`/proc/${String(processId)}/cmdline`, 'utf8')
      .split('\0')
      .filter(part => part !== '');
  } catch {
    return undefined;
  }
}

/**
 * The parent of process `processId` and its start, in clock ticks since the boot, from /proc, or undefined when
 * the process ended between the listing and the read.
 */
function processStatOf(
  processId: number,
): {parent: number; startTicks: number} | undefined {
  try {
    const stat = readFileSync(`/proc/${String(processId)}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const parent = Number(fields[1]);
    const startTicks = Number(fields[19]);
    return Number.isNaN(parent) || Number.isNaN(startTicks)
      ? undefined
      : {parent, startTicks};
  } catch {
    return undefined;
  }
}

/** The boot of the machine this row runs on, in seconds, from /proc/stat, or undefined off linux. */
function bootSeconds(): number | undefined {
  try {
    const line = readFileSync('/proc/stat', 'utf8')
      .split('\n')
      .find(entry => entry.startsWith('btime '));
    return line === undefined ? undefined : Number(line.slice(6));
  } catch {
    return undefined;
  }
}

/** When a process that started at `startMilliseconds` began against the row that started at `rowStart`. */
function startAgainst(startMilliseconds: number, rowStart: number): string {
  const seconds = Math.round(Math.abs(rowStart - startMilliseconds) / 1000);
  return startMilliseconds < rowStart
    ? `started ${String(seconds)} s before the row`
    : `started ${String(seconds)} s after the row`;
}

/**
 * Every ssh toward the host, as the row's failure lists them: each as its pid, its parent, its start against
 * the row's start and its command line, and whether the row counted it — so a red shows what the row counted and
 * what it left out (card #3131).
 */
async function sshListed(
  rowStart: number,
  rowPids: readonly number[],
): Promise<string> {
  const boot = bootSeconds();
  const lines: string[] = [];
  for (const each of await hostConnections()) {
    if (each.program !== 'ssh') continue;
    const argv = commandLineOf(each.processId);
    const stat = processStatOf(each.processId);
    const startMilliseconds =
      boot === undefined || stat === undefined
        ? undefined
        : boot * 1000 + (stat.startTicks / TICKS_PER_SECOND) * 1000;
    const parent = stat === undefined ? '' : ` parent ${String(stat.parent)}`;
    const start =
      startMilliseconds === undefined
        ? ''
        : `, ${startAgainst(startMilliseconds, rowStart)}`;
    const side = rowPids.includes(each.processId)
      ? "the row's"
      : "not the row's";
    const command = argv === undefined ? '' : `: ${argv.join(' ')}`;
    lines.push(
      `  ${String(each.processId)}${parent}${start}, ${side}${command}`,
    );
  }
  return lines.length > 0
    ? `the ssh of the host, each as its pid, its parent, its start against the row and its command line:\n${lines.join('\n')}`
    : 'no ssh of the host left';
}

/**
 * Runs the row's check, and when it fails appends what the row counted — every ssh toward the host, each with
 * its command line and whether the row's own connection started it — so the failure names the red's processes
 * (card #3131).
 */
async function counted(
  check: () => void,
  rowStart: number,
  rowPids: readonly number[],
): Promise<void> {
  try {
    check();
  } catch (failure) {
    throw new Error(
      `${String(failure)}\n${await sshListed(rowStart, rowPids)}`,
      {cause: failure},
    );
  }
}

/**
 * Waits up to 15 s for the row to leave no helper and no ssh of its own, and throws naming what is left: the
 * helpers, and every ssh toward the host with its command line and whether the row counted it (card #3131).
 */
async function rowClean(
  rowStart: number,
  rowPids: readonly number[],
): Promise<void> {
  const clean = await waitFor(
    'no helper or ssh of the row left',
    async () =>
      (await connectionHelpers()).length === 0 &&
      (await sshOfHost()).every(each => !rowPids.includes(each)),
    15_000,
  ).then(
    () => true,
    () => false,
  );
  if (!clean) {
    throw new Error(
      `helpers left: ${(await connectionHelpers()).join(', ')}\n${await sshListed(rowStart, rowPids)}`,
    );
  }
}

/** Whether the held window's ProxyCommand still runs on the runner: true while its `sleep 3600` runs, false when it is gone, and an error when pgrep says neither. */
async function stillHeld(): Promise<boolean> {
  const status = await new Promise<number>(resolve => {
    execFile('pgrep', ['-f', '^sleep 3600$'], error => {
      if (error === null) {
        resolve(0);
      } else if (typeof error.code === 'number') {
        resolve(error.code);
      } else {
        resolve(-1);
      }
    });
  });
  if (status !== 0 && status !== 1) {
    throw new Error(`the held check's pgrep exited ${String(status)}`);
  }
  return status === 0;
}

/**
 * The indicator menu's item labels in window `window`, settled: the item list is stable across two reads and holds
 * at least one item. A settled read that is empty is the menu not read, a harness failure the read fails on rather
 * than an absence read from an empty menu.
 */
async function settledMenuOf(window: string): Promise<string[]> {
  let previous: string[] | undefined;
  let settled: string[] = [];
  await waitFor(
    'the indicator menu to settle',
    async () => {
      const read = (await allQuickPickRows(window)).map(each => each.label);
      const stable =
        previous !== undefined &&
        JSON.stringify(read) === JSON.stringify(previous);
      previous = read;
      if (!stable) {
        return false;
      }
      if (read.length === 0) {
        throw new Error(
          `menu not read: the indicator menu of ${window} settled empty`,
        );
      }
      settled = read;
      return true;
    },
    30_000,
  );
  return settled;
}

describe('Connect Current Window to Host', function () {
  this.timeout(900_000);
  beforeEach(closeAllButLocal);

  it('F-2302 AC-4, AC-20 (pick): the command opens the host pick; dismissed: nothing opens and the window stays', async () => {
    await userSettings({...PLATFORMS});
    const first = await openFolderWindow(folderOf('c41-pick'));
    const before = windowNames();
    appendScript([hostAnswer(first, 'dismiss')]);
    await inWindow(first, SWITCH);
    await waitFor(
      'the host pick',
      () => recordLines('hostPick', first).length > 0,
      30_000,
    );
    await new Promise(resolve => setTimeout(resolve, 3000));
    const pick = recordLines('hostPick', first)[0];
    deepStrictEqual(
      [
        pick?.question,
        pick?.items?.slice(-2),
        windowNames(),
        windowEvents(first).some(event => event.event === 'deactivated'),
      ],
      [
        'Select configured SSH host or enter user@host',
        ['$(plus) Add New SSH Host...', 'Configure SSH Hosts...'],
        before,
        false,
      ],
    );
  });

  it('F-2302 AC-5, AC-6 (switch): a host picked in a local window reloads it onto that host with no folder, and opens no new window', async () => {
    await userSettings({...PLATFORMS});
    const first = await openFolderWindow(folderOf('c41-switch'));
    const leftover = emptyWindows();
    const next = await switched(first, {label: 'harness'});
    deepStrictEqual(
      [
        (await windowState(next)).remoteAuthority,
        (await windowState(next)).folders,
        windowEvents(first).at(-1)?.event,
        emptyWindows().filter(name => !leftover.includes(name)),
      ],
      ['ssh-remote+harness', [], 'deactivated', [next]],
    );
  });

  it('F-2302 AC-7: a typed user@host:port reloads the window onto the authority with that user and port', async () => {
    await userSettings({...PLATFORMS});
    const first = await openFolderWindow(folderOf('c41-typed'));
    const port = hostPort();
    const next = await switched(first, {
      typed: `harness@127.0.0.1:${String(port)}`,
    });
    deepStrictEqual(
      (await windowState(next)).remoteAuthority,
      `ssh-remote+${hexOf({hostName: '127.0.0.1', user: 'harness', port})}`,
    );
  });

  it('F-2302 AC-8: a folder window on one host picks another and reloads onto it with no folder', async () => {
    await userSettings({...PLATFORMS});
    await openWindow('harness', 'c41-from');
    await connectedWithin('c41-from', 90_000);
    const next = await switched('c41-from', {label: 'noforward'});
    deepStrictEqual(
      [
        (await windowState(next)).remoteAuthority,
        (await windowState(next)).folders,
      ],
      ['ssh-remote+noforward', []],
    );
  });

  it('F-2302 AC-17: a window on a host picks that host again and reloads empty on the same authority', async () => {
    await userSettings({...PLATFORMS});
    await openWindow('harness', 'c41-again');
    await connectedWithin('c41-again', 90_000);
    const next = await switched('c41-again', {label: 'harness'});
    deepStrictEqual(
      [
        (await windowState(next)).remoteAuthority,
        (await windowState(next)).folders,
        recordLines('notice', next),
      ],
      ['ssh-remote+harness', [], []],
    );
  });

  it('F-2302 AC-18: an empty local window picks a host and reloads onto it', async () => {
    await userSettings({...PLATFORMS});
    const empty = await nextEmptyWindow(() =>
      inWindow('local', 'workbench.action.newWindow'),
    );
    const next = await switched(empty, {label: 'harness'});
    deepStrictEqual(
      (await windowState(next)).remoteAuthority,
      'ssh-remote+harness',
    );
  });

  it('F-2302 AC-21: the command given a host name argument reloads onto it with no pick', async () => {
    await userSettings({...PLATFORMS});
    const first = await openFolderWindow(folderOf('c41-arg'));
    const next = await nextEmptyWindow(() =>
      inWindow(first, SWITCH, {host: 'harness'}),
    );
    await waitFor(
      `${next} to show its host`,
      async () => (await windowState(next)).remoteName === 'ssh-remote',
      120_000,
    );
    deepStrictEqual(
      [
        (await windowState(next)).remoteAuthority,
        recordLines('hostPick', first),
      ],
      ['ssh-remote+harness', []],
    );
  });

  it('F-2302 AC-19: a window whose connection failed and whose dialog was dismissed picks a host and reloads onto it', async () => {
    await userSettings({...PLATFORMS});
    appendScript(failureEntries('c41-refused'));
    await openWindow('refused', 'c41-refused');
    await waitFor(
      'the dismissed failure',
      () => recordLines('mitigationPick', 'c41-refused').length > 0,
      120_000,
    );
    const next = await switched('c41-refused', {label: 'harness'});
    deepStrictEqual(
      (await windowState(next)).remoteAuthority,
      'ssh-remote+harness',
    );
  });

  it('F-2302 AC-27: the command given user@host:22 reloads onto an ssh-remote authority with no pick', async () => {
    await userSettings({...PLATFORMS});
    const first = await openFolderWindow(folderOf('c41-port'));
    const next = nextEmptyName();
    appendScript(failureEntries(next));
    await nextEmptyWindow(() =>
      inWindow(first, SWITCH, {host: 'harness@127.0.0.1:22'}),
    );
    deepStrictEqual(
      [
        (await windowState(next)).remoteAuthority?.startsWith('ssh-remote+'),
        recordLines('hostPick', first),
      ],
      [true, []],
    );
  });

  it('F-2302 AC-23, F-2606 AC-16: a typed unresolvable host fails in the reloaded window, whose dialog has Close Remote, Retry and More Actions..., and whose More Actions pick opens', async () => {
    await userSettings({...PLATFORMS});
    const first = await openFolderWindow(folderOf('c41-nohost'));
    const next = nextEmptyName();
    appendScript([
      {
        surface: 'failureDialog',
        match: 'Could not establish connection',
        answer: {button: 'More Actions...'},
        window: next,
      },
      {
        surface: 'mitigationPick',
        match: 'Pick an action',
        answer: 'dismiss',
        window: next,
      },
    ]);
    await switched(first, {typed: 'nohost.invalid'});
    await waitFor(
      'the pick of actions',
      () => recordLines('mitigationPick', next).length > 0,
      120_000,
    );
    deepStrictEqual(
      [
        recordLines('failureDialog', next)[0]?.question.includes(
          'Could not resolve hostname',
        ),
        recordLines('failureDialog', next)[0]?.buttons,
        recordLines('mitigationPick', next)[0]?.question,
      ],
      [
        true,
        ['Close Remote', 'Retry', 'More Actions...'],
        'Pick an action to help resolve the problem.',
      ],
    );
  });

  it('F-2302 AC-22: a refused password in the reloaded window ends in the failure dialog with the permission reason', async () => {
    await userSettings({...PLATFORMS});
    const first = await openFolderWindow(folderOf('c41-wrong'));
    const next = nextEmptyName();
    appendScript([
      ...[1, 2, 3].map(() => ({
        surface: 'maskedInput' as const,
        match: 'Enter password',
        answer: {text: 'not-the-password'},
        window: next,
      })),
      ...failureEntries(next),
    ]);
    await switched(first, {label: 'password-retry'});
    await waitFor(
      'the failure dialog',
      () => recordLines('failureDialog', next).length > 0,
      120_000,
    );
    deepStrictEqual(
      recordLines('failureDialog', next)[0]?.question.includes(
        'Permission denied',
      ),
      true,
    );
  });

  it('F-2302 AC-10: a window that stays on the host stays connected when another window switches away', async () => {
    await userSettings({...PLATFORMS});
    await openWindow('harness', 'c41-stay');
    await openWindow('harness', 'c41-leave');
    await connectedWithin('c41-stay', 90_000);
    await connectedWithin('c41-leave', 90_000);
    await switched('c41-leave', {label: 'noforward'});
    deepStrictEqual(
      [
        windowEvents('c41-stay').some(event => event.event === 'deactivated'),
        (await windowState('c41-stay')).remoteAuthority,
      ],
      [false, 'ssh-remote+harness'],
    );
  });

  it('F-2302 AC-31: a window on a multi-root workspace reloads onto the host with no folder and no workspace', async () => {
    await userSettings({...PLATFORMS});
    const file = path.join(
      variable('HARNESS_RUN_FOLDER'),
      'c41.code-workspace',
    );
    writeFileSync(
      file,
      JSON.stringify({
        folders: [
          {path: folderOf('c41-root-a')},
          {path: folderOf('c41-root-b')},
        ],
      }),
    );
    const first = await openWorkspaceWindow(file);
    const next = await switched(first, {label: 'harness'});
    const state = await windowState(next);
    deepStrictEqual([state.folders, state.workspaceFile], [[], null]);
  });

  it('F-2302 AC-28: Add New SSH Host then Connect opens a new window on the added host and the first keeps its folder', async () => {
    await userSettings({...PLATFORMS});
    const config = variable('HARNESS_SSH_CONFIG');
    const original = readFileSync(config, 'utf8');
    try {
      const first = await openFolderWindow(folderOf('c41-add'));
      const next = nextEmptyName();
      appendScript([
        hostAnswer(first, {label: '$(plus) Add New SSH Host...'}),
        {
          surface: 'textInput',
          match: 'Enter SSH Connection Command',
          answer: {text: 'cw-added'},
          window: first,
        },
        {
          surface: 'filePick',
          match: 'SSH configuration file',
          answer: {label: config},
          window: first,
        },
        {
          surface: 'notice',
          match: 'Host added',
          answer: {button: 'Connect'},
          window: first,
        },
        ...failureEntries(next),
      ]);
      await nextEmptyWindow(() => inWindow(first, SWITCH));
      deepStrictEqual(
        [
          (await windowState(next)).remoteAuthority,
          windowEvents(first).some(event => event.event === 'deactivated'),
        ],
        ['ssh-remote+cw-added', false],
      );
    } finally {
      writeFileSync(config, original);
    }
  });

  it('F-2302 AC-29: Configure SSH Hosts opens the picked file in the same window, which keeps its folder', async () => {
    await userSettings({...PLATFORMS});
    const config = variable('HARNESS_SSH_CONFIG');
    const first = await openFolderWindow(folderOf('c41-configure'));
    appendScript([
      hostAnswer(first, {label: 'Configure SSH Hosts...'}),
      {
        surface: 'filePick',
        match: 'SSH configuration file',
        answer: {label: config},
        window: first,
      },
    ]);
    await inWindow(first, SWITCH);
    await waitFor(
      'the file in the editor',
      async () =>
        (await windowState(first)).activeTab?.uri.endsWith('ssh_config') ===
        true,
      30_000,
    );
    deepStrictEqual(
      [
        (await windowState(first)).folders.length,
        windowEvents(first).some(event => event.event === 'deactivated'),
      ],
      [1, false],
    );
  });

  it('F-2302 AC-9 (c3014-leave): the only window on a host switches to another; 10 s later no helper or ssh of the first host is left, and its server still runs', async () => {
    const rowStart = Date.now();
    await closeAllButLocal();
    await userSettings({...PLATFORMS});
    await waitFor(
      'no helper left',
      async () => (await connectionHelpers()).length === 0,
      15_000,
    );
    const before = await sshOfHost();
    await openWindow('harness', 'c3014-leave');
    await connectedWithin('c3014-leave', 90_000);
    const helpers = await connectionHelpers();
    const sshPids = newSsh(before, await sshOfHost());
    const servers = await serverMainProcesses();
    const next = await switched('c3014-leave', {label: 'noforward'});
    try {
      await new Promise(resolve => setTimeout(resolve, 10_000));
      const after = await serverMainProcesses();
      const leftHelpers = (await connectionHelpers()).filter(each =>
        helpers.includes(each),
      );
      const leftSsh = (await sshOfHost()).filter(each =>
        sshPids.includes(each),
      );
      await counted(
        () => {
          deepStrictEqual(
            [
              {
                helpers: helpers.length,
                sshPids: sshPids.length > 0,
                servers: servers.length > 0,
              },
              leftHelpers,
              leftSsh,
              servers.every(each => after.includes(each)),
            ],
            [{helpers: 1, sshPids: true, servers: true}, [], [], true],
          );
        },
        rowStart,
        sshPids,
      );
    } finally {
      await closeWindow(next).catch(() => undefined);
      await rowClean(rowStart, sshPids);
    }
  });

  it('F-2302 AC-33 (c3014-own): with the local server off, a switch ends the window’s ssh within 10 s, and picking the window’s own host ends its ssh and logs one new login', async () => {
    const rowStart = Date.now();
    try {
      await closeAllButLocal();
      await rowClean(rowStart, []);
      await userSettings({
        'remote.SSH.remotePlatform': {
          ...PLATFORMS['remote.SSH.remotePlatform'],
          '127.0.0.1': 'linux',
        },
        'remote.SSH.useLocalServer': false,
      });
      const before = await sshOfHost();
      await openWindow('harness', 'c3014-own');
      await connectedWithin('c3014-own', 90_000);
      const afterConnect = await sshOfHost();
      const first = newSsh(before, afterConnect);
      const next = await switched('c3014-own', {typed: '127.0.0.1'});
      await connectedEmpty(next, '127.0.0.1', 90_000);
      const goneFirst = await waitFor(
        'the first ssh gone',
        async () => (await sshOfHost()).every(each => !first.includes(each)),
        10_000,
      ).then(
        () => true,
        () => false,
      );
      const second = newSsh(afterConnect, await sshOfHost());
      const since = new Date().toISOString();
      const again = await switched(next, {typed: '127.0.0.1'});
      await connectedEmpty(again, '127.0.0.1', 90_000);
      const goneSecond = await waitFor(
        'the second ssh gone',
        async () => (await sshOfHost()).every(each => !second.includes(each)),
        10_000,
      ).then(
        () => true,
        () => false,
      );
      await waitFor(
        'the sshd line for the disconnect',
        async () =>
          (await sshdLog(since)).some(line =>
            line.includes('Disconnected from user harness'),
          ),
        10_000,
      );
      const logins = await acceptedKeyLogins(since);
      await counted(
        () => {
          deepStrictEqual(
            {
              first: first.length > 0,
              goneFirst,
              second: second.length > 0,
              goneSecond,
              logins,
            },
            {
              first: true,
              goneFirst: true,
              second: true,
              goneSecond: true,
              logins: 1,
            },
          );
        },
        rowStart,
        second,
      );
    } finally {
      await userSettings({
        ...PLATFORMS,
        'remote.SSH.useLocalServer': undefined,
      });
    }
  });

  it('F-2302 AC-32 (c3017-inflight): while a window shows Opening Remote..., neither the palette nor the indicator menu offers Connect Current Window to Host..., and a key bound with a host abandons the connect and reloads the same window onto that host, connected', async () => {
    const restore = await bindKeys([
      {key: 'ctrl+alt+h', command: SWITCH, argument: {host: 'harness'}},
    ]);
    const savedSettings = readUserSettings();
    let next = '';
    try {
      await closeAllButLocal();
      await userSettings({...PLATFORMS, 'remote.SSH.connectTimeout': 300});
      await openWindow('held', 'c3017-inflight');
      await waitFor(
        'Opening Remote...',
        async () =>
          (await statusBarText('c3017-inflight', 'status.host')) ===
          RESOLVING_INDICATOR,
        60_000,
      );
      const palette = await paletteItems(
        'c3017-inflight',
        'Connect Current Window',
      );
      await pressEscape('c3017-inflight');
      // pressEscape only dispatches the key: the menu's read must not land on the palette's rows.
      await waitFor(
        'the palette closed',
        async () => (await quickPickOf('c3017-inflight')) === undefined,
        10_000,
      );
      void inWindow('c3017-inflight', 'workbench.action.remote.showMenu').catch(
        () => undefined,
      );
      // The menu's own placeholder, so the read is the menu's.
      await waitFor(
        'the indicator menu',
        async () =>
          (await quickPickOf('c3017-inflight'))?.placeholder ===
          'Select an option to open a Remote Window',
        30_000,
      );
      const menu = await settledMenuOf('c3017-inflight');
      await pressEscape('c3017-inflight');
      const leftover = emptyWindows();
      // The remote name in the title is what tells the reloaded window's page from the other empty ones when the control reads it.
      await userSettings({
        ...PLATFORMS,
        'window.title': '[${rootName}]${remoteName}',
      });
      next = await nextEmptyWindow(() =>
        pressControlAlt('c3017-inflight', 'h'),
      );
      await connectedEmpty(next, 'harness', 90_000);
      const held = await waitFor(
        'the held connect ended',
        async () => !(await stillHeld()),
        15_000,
      ).then(
        () => true,
        () => false,
      );
      const remoteAuthority = (await windowState(next)).remoteAuthority;
      const lastEvent = windowEvents('c3017-inflight').at(-1)?.event;
      // The control: the same menu offers the entry once the connect has ended, so the read reads the menu it claims.
      // The reloaded window's host re-registered under the name the switch gave it, so the read keys to that name.
      void inWindow(next, 'workbench.action.remote.showMenu').catch(
        () => undefined,
      );
      await waitFor(
        'the indicator menu again',
        async () =>
          (await quickPickOf(next))?.placeholder ===
          'Select an option to open a Remote Window',
        30_000,
      );
      const menuEnded = await settledMenuOf(next);
      await pressEscape(next);
      process.stdout.write(
        `the indicator menu while connecting: ${JSON.stringify(
          menu,
        )}; after the connect ended: ${JSON.stringify(
          menuEnded,
        )}; the held connect ended: ${String(held)}\n`,
      );
      deepStrictEqual(
        [
          palette.filter(each =>
            each.includes('Connect Current Window to Host'),
          ),
          menu.filter(each => each.includes('Connect Current Window to Host')),
          menuEnded.some(each =>
            each.includes('Connect Current Window to Host'),
          ),
          remoteAuthority,
          lastEvent,
          emptyWindows().filter(each => !leftover.includes(each)),
          held,
        ],
        [[], [], true, 'ssh-remote+harness', 'deactivated', [next], true],
      );
    } finally {
      restore();
      restoreUserSettings(savedSettings);
      await userSettings({});
      await closeWindow('c3017-inflight').catch(() => undefined);
      await closeWindow(next).catch(() => undefined);
    }
  });
});
