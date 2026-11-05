/**
 * @fileoverview The recent folders under a host row (card coverage-102, part 1): F-2503's history store as the view
 * shows it, in the rows that clear the editor's list, rename a host, restart the editor and type a target. The history of a run outlives a row, so each row
 * names its folders with a prefix of its own and counts only the entries that start with it.
 */

import {deepStrictEqual} from 'node:assert';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {
  hostPort,
  inWindow,
  onHost,
  readUserSettings,
  recentlyOpenedIn,
  relaunch,
  restoreUserSettings,
  startInWindow,
  userSettings,
  variable,
  waitFor,
  windowNames,
  windowState,
} from '../windows/harness.ts';
import {
  answerDialog,
  rememberPage,
  titleAction,
  viewRows,
  waitForDialog,
} from '../windows/renderer.ts';
import {VIEW} from '../windows/explorer-rows.ts';
import {
  closeIfOpen,
  foldersSettled,
  historyOf,
  HOME,
  ownPathsOf,
  visit,
} from '../windows/explorer-folders.ts';
import {HOST_B, refreshed} from './folders-support.ts';

describe('the recent folders under a host (card coverage-102, part 1)', function () {
  this.timeout(600_000);

  // The history of a run outlives a row, and other files of the launch visit folders of their own: each row counts only
  // the entries that start with its own prefix.
  before(() => rememberPage('local'));

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
});
