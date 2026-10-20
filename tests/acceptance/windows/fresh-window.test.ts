/**
 * @fileoverview A remote-internal command in a fresh window (card coverage-32): the keybinding's
 * remote-internal command activates the extension in a window where it is not active yet, and nothing of the
 * run's state changes.
 */

import {deepStrictEqual} from 'node:assert';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import {userInfo} from 'node:os';
import path from 'node:path';
import {
  closeWindow,
  inWindow,
  remoteSshActive,
  variable,
  windowEvents,
  windowState,
} from './harness.ts';

/** How long a wait for the fresh window lasts, in milliseconds. */
const WAIT_MILLISECONDS = 60_000;

/** The entries under `folder`, recursively as [relative path, size]; 'missing' when the folder is not there. */
function keptEntries(folder: string): 'missing' | Array<[string, number]> {
  if (!existsSync(folder)) {
    return 'missing';
  }
  const entries: Array<[string, number]> = [];
  function walk(subFolder: string, prefix: string): void {
    for (const entry of readdirSync(subFolder, {withFileTypes: true})) {
      const fullPath = path.join(subFolder, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, `${prefix}${entry.name}/`);
      } else {
        entries.push([`${prefix}${entry.name}`, statSync(fullPath).size]);
      }
    }
  }
  walk(folder, '');
  return entries;
}

/** The account's own ssh config by its name, size and mtime, never its contents; 'missing' when it is not there. */
function accountConfig():
  {name: string; size: number; mtimeMs: number} | 'missing' {
  const config = path.join(userInfo().homedir, '.ssh', 'config');
  return existsSync(config)
    ? {
        name: 'config',
        size: statSync(config).size,
        mtimeMs: statSync(config).mtimeMs,
      }
    : 'missing';
}

/** Waits for window `name` to activate its agent, for up to a minute. */
async function agentActivated(name: string): Promise<void> {
  const deadline = Date.now() + WAIT_MILLISECONDS;
  while (!windowEvents(name).some(each => each.event === 'activated')) {
    if (Date.now() > deadline) {
      throw new Error(`window ${name} did not activate its agent`);
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}

describe('a remote-internal command in a fresh window (F-2202)', function () {
  this.timeout(180000);

  it("F-2202 AC-24: a keybinding's remote-internal.getConfiguredHostnames activates the extension in a fresh window and changes nothing", async () => {
    const runFolder = variable('HARNESS_RUN_FOLDER');
    const sshConfig = variable('HARNESS_SSH_CONFIG');
    const userData = variable('HARNESS_USER_DATA');
    const settingsPath = path.join(userData, 'User', 'settings.json');
    const storagePath = path.join(
      userData,
      'User',
      'globalStorage',
      'remote-oss.remote-ssh',
    );
    const sshBytes = readFileSync(sshConfig);
    const settingsBytes = readFileSync(settingsPath);
    const storage = keptEntries(storagePath);
    const account = accountConfig();

    const folder = path.join(runFolder, 'fr1');
    mkdirSync(folder, {recursive: true});
    await inWindow('local', 'acceptance.agent.openWindow', `file://${folder}`);
    await agentActivated('fr1');

    const before = await windowState('fr1');
    const activeBefore = await remoteSshActive('fr1');
    await inWindow('fr1', 'remote-internal.getConfiguredHostnames');
    await windowState('fr1');
    const activeAfter = await remoteSshActive('fr1');
    await inWindow('fr1', 'acceptance.agent.writeFile', 'usable.txt', 'usable');

    deepStrictEqual(
      [
        [before.remoteName, activeBefore],
        activeAfter,
        [
          readFileSync(sshConfig),
          readFileSync(settingsPath),
          keptEntries(storagePath),
          accountConfig(),
        ],
        readFileSync(path.join(folder, 'usable.txt'), 'utf8'),
      ],
      [
        [null, false],
        true,
        [sshBytes, settingsBytes, storage, account],
        'usable',
      ],
    );

    await closeWindow('fr1');
  });
});
