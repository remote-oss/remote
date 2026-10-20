/**
 * @fileoverview The recorded gate rows 1–5 of explorer slice 1 (card coverage-25b, #645): the Remotes view's rows in
 * the local window, a connect in a new window and in the current one, the connected marker of the reloaded window,
 * and a host added to the run's ssh_config, seen on Refresh.
 */

import {deepStrictEqual} from 'node:assert';
import {readFileSync, writeFileSync} from 'node:fs';
import {
  closeWindow,
  hostAliases,
  inWindow,
  isOpen,
  onHost,
  variable,
  waitFor,
  windowEvents,
  windowState,
} from '../windows/harness.ts';
import {rowAction, titleAction} from '../windows/renderer.ts';
import {nothingFails, rowsOf, rowsSettled, VIEW} from './explorer-rows.ts';

/** The launch's first window and the windows the connects open, and the view and its actions. */
const LOCAL = 'local';
const NEW_WINDOW = 'empty-1';
const RELOADED_WINDOW = 'empty-2';
const IN_NEW = 'Connect in New Window...';
const CURRENT = 'Connect in Current Window...';
const REFRESH = 'Refresh';

/** The hosts of the run's ssh_config, read when this file's tests start. */
const HOSTS = hostAliases();

describe('the gate rows of explorer slice 1 in the explorer launch (card coverage-25b, rows 1–5)', function () {
  this.timeout(180_000);

  it('F-5101.AC-4, F-5102.AC-5: the Remotes view shows the SSH group with the run’s ssh_config hosts in file order', async () => {
    await inWindow(LOCAL, 'remoteTargets.focus');
    await rowsSettled(LOCAL, rowsOf(HOSTS, undefined));
    await nothingFails(LOCAL);
  });

  it('F-5103.AC-11: Connect in New Window on harness opens empty-1 on ssh-remote+harness, and the picking window stays local', async () => {
    await rowAction(LOCAL, VIEW, 'harness', IN_NEW);
    await waitFor(
      `window ${NEW_WINDOW} to activate its agent`,
      () => windowEvents(NEW_WINDOW).some(each => each.event === 'activated'),
      60_000,
    );
    try {
      await inWindow(
        NEW_WINDOW,
        'acceptance.agent.writeFile',
        'vscode-remote://ssh-remote+harness/home/harness/gate-probe',
        'x',
      );
      const [remoteName, probe, localName] = [
        (await windowState(NEW_WINDOW)).remoteName,
        await onHost('cat', '/home/harness/gate-probe'),
        (await windowState(LOCAL)).remoteName,
      ];
      deepStrictEqual(
        [remoteName, probe, localName],
        ['ssh-remote', 'x', null],
      );
    } finally {
      await onHost('rm', '-f', '/home/harness/gate-probe');
    }
    await nothingFails(LOCAL);
    await closeWindow(NEW_WINDOW);
  });

  it('F-5103.AC-11: Connect in Current Window deactivates local, and the reloaded window activates as empty-2 on ssh-remote+harness', async () => {
    await rowAction(LOCAL, VIEW, 'harness', CURRENT);
    await waitFor(
      `window ${RELOADED_WINDOW} to activate its agent`,
      () =>
        windowEvents(RELOADED_WINDOW).some(each => each.event === 'activated'),
      60_000,
    );
    await waitFor(
      `window ${LOCAL} to deactivate`,
      () => windowEvents(LOCAL).some(each => each.event === 'deactivated'),
      60_000,
    );
    try {
      await inWindow(
        RELOADED_WINDOW,
        'acceptance.agent.writeFile',
        'vscode-remote://ssh-remote+harness/home/harness/gate-probe-current',
        'x',
      );
      const [remoteName, probe, localOpen] = [
        (await windowState(RELOADED_WINDOW)).remoteName,
        await onHost('cat', '/home/harness/gate-probe-current'),
        isOpen(LOCAL),
      ];
      deepStrictEqual(
        [remoteName, probe, localOpen],
        ['ssh-remote', 'x', false],
      );
    } finally {
      await onHost('rm', '-f', '/home/harness/gate-probe-current');
    }
  });

  it('F-5103.AC-7, F-5902.AC-7: in empty-2 the harness row is marked connected, from the companion’s pull', async () => {
    await inWindow(RELOADED_WINDOW, 'remoteTargets.focus');
    await rowsSettled(RELOADED_WINDOW, rowsOf(HOSTS, 'harness'));
    await nothingFails(RELOADED_WINDOW);
  });

  it('F-5101.AC-9, F-5102.AC-5: a host added to the ssh_config appears last in file order after Refresh, and is gone after the restore', async () => {
    const config = variable('HARNESS_SSH_CONFIG');
    const bytes = readFileSync(config);
    try {
      writeFileSync(
        config,
        `${String(bytes)}Host gate-added\n  HostName 127.0.0.1\n`,
      );
      await titleAction(RELOADED_WINDOW, VIEW, REFRESH);
      await rowsSettled(
        RELOADED_WINDOW,
        rowsOf([...HOSTS, 'gate-added'], 'harness'),
      );
    } finally {
      writeFileSync(config, bytes);
    }
    await titleAction(RELOADED_WINDOW, VIEW, REFRESH);
    await rowsSettled(RELOADED_WINDOW, rowsOf(HOSTS, 'harness'));
    await nothingFails(RELOADED_WINDOW);
  });
});
