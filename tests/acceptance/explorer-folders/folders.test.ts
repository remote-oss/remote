/**
 * @fileoverview The recent folders under a host row (card coverage-102, part 1): F-2503's history store as the view
 * shows it. The history of a run outlives a row, so each row names its folders with a prefix of its own and counts only
 * the entries that start with it.
 */

import {deepStrictEqual} from 'node:assert';
import {mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {
  callCommand,
  connectionLog,
  hostPort,
  inWindow,
  isOpen,
  nextEmptyWindow,
  onHost,
  openWindow,
  readUserSettings,
  recentlyOpenedIn,
  relaunch,
  remoteSshActive,
  restoreUserSettings,
  startInWindow,
  userSettings,
  userSettingsFile,
  variable,
  waitFor,
  windowNames,
  windowState,
} from '../windows/harness.ts';
import {activations, openFolderWindow} from '../windows/folder-windows.ts';
import {
  answerDialog,
  dialogOf,
  notifications,
  pressControlAlt,
  rememberPage,
  rowAction,
  rowMenuAction,
  titleAction,
  toggleRow,
  viewRows,
  waitForDialog,
} from '../windows/renderer.ts';
import {VIEW} from '../windows/explorer-rows.ts';
import {
  appearsAfter,
  bindKeys,
  closeIfOpen,
  connectedTo,
  ENVELOPE,
  folderRowsOf,
  foldersSettled,
  historyOf,
  HOME,
  openAddress,
  ownPathsOf,
  pathsOf,
  viewWindow,
  visit,
} from '../windows/explorer-folders.ts';

/** Four aliases of the run's file that reach the same host and the same account. */
const HOST_A = 'agentfwd-off';
const HOST_B = 'harness';
const HOST_C = '127.0.0.1';
const HOST_D = 'agentfwd';

const CURRENT = 'Connect in Current Window...';
const IN_NEW = 'Connect in New Window...';
const REMOVE = 'Remove from Recent List';

/** Shows the view in the local window and refreshes it, so that it reads the history as it is now. */
async function refreshed(): Promise<void> {
  await inWindow('local', 'workbench.view.remote');
  await titleAction('local', VIEW, 'Refresh');
}

describe('the recent folders under a host (card coverage-102, part 1)', function () {
  this.timeout(600_000);

  before(async () => {
    await rememberPage('local');
    deepStrictEqual(await historyOf(), {}, 'the launch starts with no history');
  });

  it('F-2503 AC-3, AC-4, AC-8 (order-and-hosts): a folder opened on a host is the first child of its row, a folder opened again moves to the top with no duplicate, and each host row lists only its own', async () => {
    const first = `${HOME}/c102-a1`;
    const second = `${HOME}/c102-a2`;
    const other = `${HOME}/c102-b1`;
    const scope = `${HOME}/c102-a`;
    await visit(HOST_B, 'c102-b1');
    await visit(HOST_A, 'c102-a1');
    await refreshed();
    await foldersSettled('local', HOST_A, [first], scope);
    await visit(HOST_A, 'c102-a2');
    await titleAction('local', VIEW, 'Refresh');
    await foldersSettled('local', HOST_A, [second, first], scope);
    await foldersSettled('local', HOST_B, [other], `${HOME}/c102-b`);
    await visit(HOST_A, 'c102-a1');
    await titleAction('local', VIEW, 'Refresh');
    await foldersSettled('local', HOST_A, [first, second], scope);
    // The launch's first row: the history holds these two hosts and nothing else.
    deepStrictEqual(
      Object.entries(await historyOf()).map(([host, entries]) => [
        host,
        entries.map(entry => entry.path),
      ]),
      [
        [HOST_B, [other]],
        [HOST_A, [first, second]],
      ],
    );
  });

  it('F-2503 AC-29 (same-hostname): two aliases with the same HostName list their own entries, and only the alias of the window is marked connected', async () => {
    const name = 'c102-s1';
    const scope = `${HOME}/c102-s`;
    try {
      await visit(HOST_A, 'c102-s2');
      await openWindow(HOST_B, name);
      await connectedTo(name, HOST_B);
      await waitFor(
        `the history of ${HOST_B} to hold ${name}`,
        async () => (await ownPathsOf(HOST_B, scope)).length > 0,
        30_000,
      );
      await inWindow(name, 'workbench.view.remote');
      await foldersSettled(name, HOST_B, [`${HOME}/${name}`], scope);
      await foldersSettled(name, HOST_A, [`${HOME}/c102-s2`], scope);
      deepStrictEqual(
        ((await viewRows(name, VIEW)) ?? [])
          .filter(
            entry => entry.level === 2 && entry.description === 'connected',
          )
          .map(entry => entry.label),
        [HOST_B],
      );
    } finally {
      await closeIfOpen(name);
    }
  });

  it('F-2503 AC-5 (workspace): a workspace file opened in an SSH window is the first entry of the host and the view shows it as a workspace row', async () => {
    const folder = `${HOME}/c102-w1`;
    const file = `${folder}/c102-w.code-workspace`;
    let name: string | undefined;
    try {
      await onHost('mkdir', '-p', folder);
      await onHost(
        'sh',
        '-c',
        `printf '%s' '{"folders":[{"path":"."}]}' > ${file}`,
      );
      // A remote workspace window has no folders when its agent starts, so it is named after the workspace file's folder.
      name = 'c102-w1';
      await openAddress(`vscode-remote://ssh-remote+${HOST_A}${file}`, name);
      await connectedTo(name, HOST_A);
      await waitFor(
        `the history of ${HOST_A} to hold ${file}`,
        async () => (await pathsOf(HOST_A))[0] === file,
        30_000,
      );
      const stored = (await historyOf())[HOST_A]?.[0];
      await closeIfOpen(name);
      await refreshed();
      await foldersSettled('local', HOST_A, [file], folder);
      deepStrictEqual(
        [
          stored,
          (await folderRowsOf('local', HOST_A)).find(
            entry => entry.description === file,
          )?.label,
        ],
        [{path: file, kind: 'workspace'}, 'c102-w (Workspace)'],
      );
    } finally {
      if (name !== undefined) {
        await closeIfOpen(name);
      }
    }
  });

  it('F-2503 AC-6 (trailing-slash): a folder opened with a trailing slash is recorded without it', async () => {
    const folder = `${HOME}/c102-t1`;
    try {
      await onHost('mkdir', '-p', folder);
      await openAddress(
        `vscode-remote://ssh-remote+${HOST_A}${folder}/`,
        'c102-t1',
      );
      await connectedTo('c102-t1', HOST_A);
      await waitFor(
        `the history of ${HOST_A} to hold an entry`,
        async () => (await ownPathsOf(HOST_A, folder)).length > 0,
        30_000,
      );
      const stored = await ownPathsOf(HOST_A, folder);
      await closeIfOpen('c102-t1');
      await refreshed();
      await foldersSettled('local', HOST_A, [folder], folder);
      deepStrictEqual(stored, [folder]);
    } finally {
      await closeIfOpen('c102-t1');
    }
  });

  it('F-2503 AC-7 (file-only): a file opened in an SSH window with no folder leaves the history as it was', async () => {
    const file = `${HOME}/c102-file.txt`;
    const folder = `${HOME}/c102-e1`;
    let name: string | undefined;
    try {
      await visit(HOST_A, 'c102-e1');
      await onHost('sh', '-c', `printf x > ${file}`);
      name = await nextEmptyWindow(() =>
        inWindow(
          'local',
          'acceptance.agent.openWindow',
          `vscode-remote://ssh-remote+${HOST_A}`,
        ),
      );
      await connectedTo(name, HOST_A);
      const before = await pathsOf(HOST_A);
      await inWindow(
        name,
        'acceptance.agent.openUri',
        `vscode-remote://ssh-remote+${HOST_A}${file}`,
      );
      await new Promise(resolve => setTimeout(resolve, 5_000));
      deepStrictEqual([await pathsOf(HOST_A), before[0]], [before, folder]);
    } finally {
      if (name !== undefined) {
        await closeIfOpen(name);
      }
    }
  });

  it("F-2503 AC-9, AC-10, AC-31 (remove): Remove from Recent List drops the row at once without a dialog or notification, keeps the others' order and the editor's Open Recent entry, a reopened folder is first again, and a host's only entry leaves the row with no children", async () => {
    const first = `${HOME}/c102-r1`;
    const second = `${HOME}/c102-r2`;
    const third = `${HOME}/c102-r3`;
    const scope = `${HOME}/c102-r`;
    let window = '';
    try {
      await visit(HOST_B, 'c102-r1');
      await visit(HOST_B, 'c102-r2');
      await visit(HOST_B, 'c102-r3');
      await visit(HOST_C, 'c102-r4');
      window = await viewWindow('c102-remove');
      await foldersSettled(window, HOST_B, [third, second, first], scope);
      await rowMenuAction(window, VIEW, 'c102-r2', REMOVE);
      await foldersSettled(window, HOST_B, [third, first], scope);
      const shown = [
        await notifications(window),
        await dialogOf(window),
        await ownPathsOf(HOST_B, scope),
      ];
      const recent = (await recentlyOpenedIn('local')).map(entry =>
        decodeURIComponent(entry.uri),
      );
      await visit(HOST_B, 'c102-r2');
      await titleAction(window, VIEW, 'Refresh');
      await foldersSettled(window, HOST_B, [second, third, first], scope);
      // The rows of the host above are many by now: fold them, so that the next host's row is drawn.
      await toggleRow(window, VIEW, HOST_B);
      await rowMenuAction(window, VIEW, 'c102-r4', REMOVE);
      await foldersSettled(window, HOST_C, []);
      deepStrictEqual(
        [
          shown,
          recent.some(address => address.endsWith(second)),
          await pathsOf(HOST_C),
        ],
        [[[], undefined, [third, first]], true, []],
      );
    } finally {
      await closeIfOpen(window);
    }
  });

  it('F-2503 AC-1 (activation): each of the four ids, run in a window where Remote - SSH is not active, activates it and is handled', async () => {
    const known = `${HOME}/c102-act`;
    const windows: string[] = [];
    await visit(HOST_B, 'c102-act');
    const calls: Array<[string, unknown]> = [
      ['getSshFoldersHistory', ENVELOPE],
      ['getActiveSshRemote', ENVELOPE],
      [
        'openRemoteSshTarget',
        {
          ...ENVELOPE,
          hostKey: HOST_B,
          path: known,
          kind: 'folder',
          window: 'new',
        },
      ],
      [
        'deleteSshFolderFromHistory',
        {...ENVELOPE, hostKey: HOST_B, path: known},
      ],
    ];
    const outcomes: unknown[] = [];
    try {
      for (const [position, [command, argument]] of calls.entries()) {
        const folder = path.join(
          variable('HARNESS_RUN_FOLDER'),
          'explorer-folders',
          `c102-act-${String(position)}`,
        );
        mkdirSync(folder, {recursive: true});
        const window = await openFolderWindow(folder);
        windows.push(window);
        const before = await remoteSshActive(window);
        const opened = activations('c102-act');
        const answer = await callCommand(
          window,
          `remote-internal.${command}`,
          argument,
        );
        if (command === 'openRemoteSshTarget') {
          await appearsAfter('c102-act', opened);
          await connectedTo('c102-act', HOST_B);
          await closeIfOpen('c102-act');
        }
        const value = answer.value as {
          hosts?: Array<{hostKey: string}>;
          connected?: boolean;
          changed?: boolean;
        } | null;
        outcomes.push([
          command,
          before,
          answer.rejection,
          await remoteSshActive(window),
          {
            getSshFoldersHistory: (value?.hosts ?? []).some(
              host => host.hostKey === HOST_B,
            ),
            getActiveSshRemote: value?.connected,
            openRemoteSshTarget: 'opened',
            deleteSshFolderFromHistory: value?.changed,
          }[command],
        ]);
      }
      deepStrictEqual(outcomes, [
        ['getSshFoldersHistory', false, undefined, true, true],
        ['getActiveSshRemote', false, undefined, true, false],
        ['openRemoteSshTarget', false, undefined, true, 'opened'],
        ['deleteSshFolderFromHistory', false, undefined, true, true],
      ]);
    } finally {
      await closeIfOpen('c102-act');
      for (const window of windows) {
        await closeIfOpen(window);
      }
    }
  });

  it('F-2503 AC-16, AC-17, AC-18, AC-19, AC-25 (connect-rows): Connect in New Window on a folder row opens that folder and makes it first, on a deleted folder it opens with no error and moves the entry to the top, on a host row it opens with no folder and changes nothing, and Connect in Current Window reloads the window into the folder; none shows anything of the extension', async () => {
    const first = `${HOME}/c102-c1`;
    const second = `${HOME}/c102-c2`;
    const gone = `${HOME}/c102-cgone`;
    const scope = `${HOME}/c102-c`;
    const seen: unknown[] = [];
    let from = '';
    async function firstEntry(expected: string): Promise<void> {
      await waitFor(
        `${expected} to be the first entry`,
        async () => (await ownPathsOf(HOST_B, scope))[0] === expected,
        30_000,
      );
    }
    try {
      await visit(HOST_B, 'c102-c1');
      await visit(HOST_B, 'c102-c2');
      await visit(HOST_B, 'c102-cgone');
      await onHost('rm', '-rf', gone);
      from = await viewWindow('c102-from');
      await foldersSettled(from, HOST_B, [gone, second, first], scope);

      let before = activations('c102-c1');
      await rowAction(from, VIEW, 'c102-c1', IN_NEW);
      await appearsAfter('c102-c1', before);
      await connectedTo('c102-c1', HOST_B);
      await firstEntry(first);
      seen.push([
        'new',
        await ownPathsOf(HOST_B, scope),
        await notifications(from),
      ]);
      await closeIfOpen('c102-c1');

      before = activations('c102-cgone');
      await rowAction(from, VIEW, 'c102-cgone', IN_NEW);
      await appearsAfter('c102-cgone', before);
      await connectedTo('c102-cgone', HOST_B);
      await firstEntry(gone);
      seen.push([
        'deleted',
        await ownPathsOf(HOST_B, scope),
        await notifications('c102-cgone'),
        await notifications(from),
      ]);
      await closeIfOpen('c102-cgone');

      const historyBefore = await ownPathsOf(HOST_B, scope);
      const hostWindow = await nextEmptyWindow(() =>
        rowAction(from, VIEW, HOST_B, IN_NEW),
      );
      await connectedTo(hostWindow, HOST_B);
      seen.push([
        'host',
        (await windowState(hostWindow)).folders,
        await ownPathsOf(HOST_B, scope),
        historyBefore,
      ]);
      await closeIfOpen(hostWindow);

      before = activations('c102-c2');
      await rowAction(from, VIEW, 'c102-c2', CURRENT);
      await appearsAfter('c102-c2', before);
      await connectedTo('c102-c2', HOST_B);
      await firstEntry(second);
      seen.push(['current', await ownPathsOf(HOST_B, scope), isOpen(from)]);
      await closeIfOpen('c102-c2');
      from = '';
      deepStrictEqual(seen, [
        ['new', [first, gone, second], []],
        ['deleted', [gone, first, second], [], []],
        ['host', [], [gone, first, second], [gone, first, second]],
        ['current', [second, gone, first], false],
      ]);
    } finally {
      await closeIfOpen(from);
      await closeIfOpen('c102-c2');
    }
  });

  it('F-2503 AC-22, AC-27, AC-32 (other-windows): a folder another window opens is not in this view until Refresh and then is, and two windows that open folders a few seconds apart are both recorded', async () => {
    const first = `${HOME}/c102-o1`;
    const second = `${HOME}/c102-o2`;
    const third = `${HOME}/c102-o3`;
    const fourth = `${HOME}/c102-o4`;
    const scope = `${HOME}/c102-o`;
    await visit(HOST_B, 'c102-o1');
    await refreshed();
    await foldersSettled('local', HOST_B, [first], scope);
    await visit(HOST_B, 'c102-o2');
    await new Promise(resolve => setTimeout(resolve, 15_000));
    const unchanged = (await folderRowsOf('local', HOST_B))
      .map(entry => entry.description)
      .filter(description => description.startsWith(scope));
    await titleAction('local', VIEW, 'Refresh');
    await foldersSettled('local', HOST_B, [second, first], scope);
    // Two windows, a few seconds apart, on two hosts.
    await onHost('mkdir', '-p', third, fourth);
    const early = activations('c102-o3');
    await inWindow(
      'local',
      'acceptance.agent.openWindow',
      `vscode-remote://ssh-remote+${HOST_B}${third}`,
    );
    await new Promise(resolve => setTimeout(resolve, 3_000));
    const late = activations('c102-o4');
    await inWindow(
      'local',
      'acceptance.agent.openWindow',
      `vscode-remote://ssh-remote+${HOST_D}${fourth}`,
    );
    await appearsAfter('c102-o3', early);
    await appearsAfter('c102-o4', late);
    await waitFor(
      'both windows to be recorded',
      async () =>
        (await pathsOf(HOST_B)).includes(third) &&
        (await pathsOf(HOST_D)).includes(fourth),
      60_000,
    );
    await closeIfOpen('c102-o3');
    await closeIfOpen('c102-o4');
    deepStrictEqual(
      [
        unchanged,
        (await pathsOf(HOST_B)).includes(third),
        (await pathsOf(HOST_D)).includes(fourth),
      ],
      [[first], true, true],
    );
  });

  it('F-2503 AC-20, AC-25, AC-26 (keybindings): the four commands run by a keybinding with no argument open and reload nothing, write no setting or file, add no log line and leave the history and the window as they were', async () => {
    const keys = [
      ['j', 'getSshFoldersHistory'],
      ['k', 'deleteSshFolderFromHistory'],
      ['l', 'getActiveSshRemote'],
      ['m', 'openRemoteSshTarget'],
    ] as const;
    const storage = path.join(
      variable('HARNESS_USER_DATA'),
      'User/globalStorage/remote-oss.remote-ssh',
    );
    function filesOf(): string[] {
      try {
        return readdirSync(storage, {recursive: true}).map(String).sort();
      } catch {
        return [];
      }
    }
    const keybindingsFile = path.join(
      variable('HARNESS_USER_DATA'),
      'User/keybindings.json',
    );
    function stateOf(): unknown[] {
      return [
        windowNames().join(','),
        readFileSync(userSettingsFile(), 'utf8'),
        readFileSync(keybindingsFile, 'utf8'),
        readFileSync(variable('HARNESS_SSH_CONFIG'), 'utf8'),
        filesOf().join(','),
        connectionLog().length,
        activations('local'),
      ];
    }
    const remote = 'c102-k2';
    await visit(HOST_B, 'c102-k1');
    await openWindow(HOST_B, remote);
    const restore = await bindKeys(
      keys.map(([key, command]) => ({
        key: `ctrl+alt+${key}`,
        command: `remote-internal.${command}`,
      })),
    );
    try {
      await connectedTo(remote, HOST_B);
      const before = stateOf();
      const historyBefore = await historyOf();
      const toasts: unknown[] = [];
      // A local window and an SSH window.
      for (const window of ['local', remote]) {
        for (const [key] of keys) {
          await pressControlAlt(window, key);
          await new Promise(resolve => setTimeout(resolve, 3_000));
          toasts.push(await notifications(window));
        }
      }
      await inWindow('local', 'workbench.view.remote');
      deepStrictEqual(
        [stateOf(), await historyOf(), toasts],
        [before, historyBefore, Array.from({length: 8}, () => [])],
      );
    } finally {
      restore();
      await closeIfOpen(remote);
    }
  });

  it("F-2503 AC-11 (clear-recent): File: Clear Recently Opened... confirmed leaves the editor's list empty and the view with every folder row after Refresh", async () => {
    const folder = `${HOME}/c102-x1`;
    await visit(HOST_B, 'c102-x1');
    await refreshed();
    await foldersSettled('local', HOST_B, [folder], folder);
    // The command ends once its confirmation is answered, so it is started and not waited for.
    await startInWindow('local', 'workbench.action.clearRecentFiles');
    const dialog = await waitForDialog('local');
    await answerDialog(
      'local',
      dialog.buttons.find(label => !/cancel/i.test(label)) ?? '',
    );
    await waitFor(
      "the editor's Open Recent list to be empty",
      async () =>
        !(await recentlyOpenedIn('local')).some(entry =>
          decodeURIComponent(entry.uri).endsWith(folder),
        ),
      30_000,
    );
    await titleAction('local', VIEW, 'Refresh');
    await foldersSettled('local', HOST_B, [folder], folder);
    deepStrictEqual(await ownPathsOf(HOST_B, folder), [folder]);
  });

  it('F-2503 AC-15 (renamed-host): a host whose Host line is renamed has no children under its new name, and the history is shown again once the name is restored', async () => {
    const folder = `${HOME}/c102-n1`;
    const copy = path.join(
      variable('HARNESS_RUN_FOLDER'),
      'explorer-folders',
      'ssh_config',
    );
    mkdirSync(path.dirname(copy), {recursive: true});
    const original = readFileSync(variable('HARNESS_SSH_CONFIG'), 'utf8');
    const saved = readUserSettings();
    writeFileSync(copy, original);
    try {
      await userSettings({'remote.SSH.configFile': copy});
      await visit(HOST_B, 'c102-n1');
      await refreshed();
      await foldersSettled('local', HOST_B, [folder], folder);
      writeFileSync(
        copy,
        original.replace(/^Host harness$/m, 'Host harness-renamed'),
      );
      await titleAction('local', VIEW, 'Refresh');
      await foldersSettled('local', 'harness-renamed', []);
      const labels = ((await viewRows('local', VIEW)) ?? [])
        .filter(entry => entry.level === 2)
        .map(entry => entry.label);
      writeFileSync(copy, original);
      await titleAction('local', VIEW, 'Refresh');
      await foldersSettled('local', HOST_B, [folder], folder);
      deepStrictEqual(
        [labels.includes('harness-renamed'), labels.includes(HOST_B)],
        [true, false],
      );
    } finally {
      restoreUserSettings(saved);
      writeFileSync(copy, original);
    }
  });

  it('F-2503 AC-23 (restart): the history is the same after the editor is closed and started again', async () => {
    const folder = `${HOME}/c102-rs1`;
    await visit(HOST_B, 'c102-rs1');
    await relaunch('local', {environment: {}});
    await rememberPage('local');
    await refreshed();
    await foldersSettled('local', HOST_B, [folder], folder);
    deepStrictEqual(await ownPathsOf(HOST_B, folder), [folder]);
  });

  it('F-2503 AC-14 (typed-target): a window connected with a typed user@address that is no configured alias adds no row, marks no row connected and leaves the configured hosts histories as they were', async () => {
    const folder = `${HOME}/c102-typed`;
    const runFolder = variable('HARNESS_RUN_FOLDER');
    const copy = path.join(runFolder, 'explorer-folders', 'ssh_config-typed');
    mkdirSync(path.dirname(copy), {recursive: true});
    const original = readFileSync(variable('HARNESS_SSH_CONFIG'), 'utf8');
    const saved = readUserSettings();
    // A Match block names no host row, and reaches the host for the address the window is opened with.
    writeFileSync(
      copy,
      `${original}\nMatch originalhost 127.0.0.9\n  HostName 127.0.0.1\n  Port ${String(hostPort())}\n  User harness\n  IdentityFile ${path.join(runFolder, 'id_ed25519')}\n  IdentitiesOnly yes\n  IdentityAgent none\n  StrictHostKeyChecking accept-new\n  BatchMode yes\n  ConnectTimeout 10\n  UserKnownHostsFile ${path.join(runFolder, 'known_hosts')}\n`,
    );
    try {
      await userSettings({'remote.SSH.configFile': copy});
      await visit(HOST_B, 'c102-ty0');
      const historyBefore = await historyOf();
      await onHost('mkdir', '-p', folder);
      await inWindow(
        'local',
        'acceptance.agent.openWindow',
        `vscode-remote://ssh-remote+harness@127.0.0.9${folder}`,
      );
      await waitFor(
        'the typed window to open',
        () => windowNames().includes('c102-typed'),
        90_000,
      );
      await waitFor(
        'the typed window to be connected',
        async () =>
          (await windowState('c102-typed')).remoteName === 'ssh-remote',
        120_000,
      );
      await inWindow('c102-typed', 'workbench.view.remote');
      await new Promise(resolve => setTimeout(resolve, 5_000));
      const hosts = ((await viewRows('c102-typed', VIEW)) ?? []).filter(
        entry => entry.level === 2,
      );
      deepStrictEqual(
        [
          hosts.some(entry => entry.label.includes('127.0.0.9')),
          hosts
            .filter(entry => entry.description === 'connected')
            .map(entry => entry.label),
          await historyOf(),
        ],
        [
          false,
          [],
          // The typed target has a history of its own, under the key as typed (F-2503 BR-4); nothing else moves.
          {
            ...historyBefore,
            'harness@127.0.0.9': [{path: folder, kind: 'folder'}],
          },
        ],
      );
    } finally {
      await closeIfOpen('c102-typed');
      restoreUserSettings(saved);
      writeFileSync(copy, original);
    }
  });

  it('F-2503 AC-21 (many-folders): 122 different folders opened one after another on one host are all listed, most recent first, none dropped', async function () {
    this.timeout(2_400_000);
    const scope = `${HOME}/c102-m`;
    const names = [...Array(122).keys()].map(
      position => `c102-m${String(position).padStart(3, '0')}`,
    );
    for (const name of names) {
      await visit(HOST_B, name);
    }
    const stored = await ownPathsOf(HOST_B, scope);
    await refreshed();
    await foldersSettled('local', HOST_B, stored, scope);
    deepStrictEqual(
      [stored.length, stored.toReversed()],
      [122, names.map(name => `${HOME}/${name}`)],
    );
  });
});
