/**
 * @fileoverview The hosts of the user's and the system's SSH configuration files (card coverage-25c, part b): the
 * launch runs the editor with the run's own HOME, so each row writes `<home>/.ssh/config` itself, and with
 * `remote.SSH.configFile` cleared the group lists the user file's hosts and then the system file's.
 */

import {deepStrictEqual} from 'node:assert';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {VIEW} from '../windows/explorer-rows.ts';
import {
  appendScript,
  closeWindow,
  inWindow,
  readUserSettings,
  restoreUserSettings,
  userSettings,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {
  notifications,
  rowAction,
  titleAction,
  viewRows,
} from '../windows/renderer.ts';

/** The system configuration file a Linux client reads after the user's. */
const SYSTEM_FILE = '/etc/ssh/ssh_config';

/** The run's HOME, as the launch gives it to the editor. */
function home(): string {
  return path.join(variable('HARNESS_RUN_FOLDER'), 'home');
}

/** The user's `.ssh` folder, made when it is missing. */
function sshFolder(): string {
  const folder = path.join(home(), '.ssh');
  mkdirSync(folder, {recursive: true});
  return folder;
}

/** Writes `lines` to `relative` under the user's `.ssh` folder and gives its path. */
function sshFile(relative: string, lines: readonly string[]): string {
  const file = path.join(sshFolder(), relative);
  mkdirSync(path.dirname(file), {recursive: true});
  writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
}

/** The concrete aliases of the system file's `Host` lines, as the rows expect them after the user's. */
function systemHosts(): string[] {
  if (!existsSync(SYSTEM_FILE)) {
    return [];
  }
  return readFileSync(SYSTEM_FILE, 'utf8')
    .split('\n')
    .filter(line => /^\s*Host\s/i.test(line))
    .flatMap(line => line.trim().split(/\s+/).slice(1))
    .filter(word => !/[*?!]/.test(word));
}

/** The labels of the group's host rows in `window`, in order. */
async function hostLabels(window: string): Promise<string[]> {
  return ((await viewRows(window, VIEW)) ?? [])
    .filter(viewRow => viewRow.level === 2)
    .map(viewRow => viewRow.label);
}

/** Waits until `window` lists exactly `hosts`. */
async function listing(
  window: string,
  hosts: readonly string[],
): Promise<void> {
  await waitFor(
    `window ${window} to list ${hosts.join(', ')}`,
    async () =>
      JSON.stringify(await hostLabels(window)) === JSON.stringify(hosts),
    15_000,
  );
}

/** A new folder window named `name` that shows the Remote Explorer. */
async function viewWindow(name: string): Promise<string> {
  const folder = path.join(variable('HARNESS_RUN_FOLDER'), 'home-rows', name);
  mkdirSync(folder, {recursive: true});
  const window = await openFolderWindow(folder);
  await inWindow(window, 'workbench.view.remote');
  return window;
}

describe("the hosts of the user's and the system's files (card coverage-25c, part b)", function () {
  this.timeout(240_000);
  let savedSettings: string | undefined;

  beforeEach(async () => {
    savedSettings = readUserSettings();
    rmSync(sshFolder(), {recursive: true, force: true});
    await userSettings({'remote.SSH.configFile': ''});
  });

  afterEach(() => {
    restoreUserSettings(savedSettings);
    rmSync(sshFolder(), {recursive: true, force: true});
  });

  it("F-5102 AC-9 (user-then-system): with no configFile the user file's hosts come before the system file's, and a configFile lists only its own", async () => {
    sshFile('config', ['Host user-one', 'Host user-two']);
    const other = sshFile('other.conf', ['Host other-only']);
    const window = await viewWindow('home-order');
    try {
      await listing(window, ['user-one', 'user-two', ...systemHosts()]);
      await userSettings({'remote.SSH.configFile': other});
      await titleAction(window, VIEW, 'Refresh');
      await listing(window, ['other-only']);
    } finally {
      await closeWindow(window);
    }
  });

  it("F-5102 AC-38 (config-folder): a user config that is a folder leaves only the system file's hosts with no notification, and picking that path in the gear's picker writes nothing", async () => {
    const config = path.join(sshFolder(), 'config');
    mkdirSync(config, {recursive: true});
    const window = await viewWindow('home-folder');
    try {
      await listing(window, systemHosts());
      appendScript([
        {
          surface: 'filePick',
          match: 'Select SSH configuration file to update',
          answer: {label: config},
          window,
        },
      ]);
      await rowAction(window, VIEW, 'SSH', 'Open SSH Config File');
      await new Promise(resolve => setTimeout(resolve, 3_000));
      deepStrictEqual(
        [await notifications(window), readdirSync(config)],
        [[], []],
      );
    } finally {
      await closeWindow(window);
    }
  });

  it('F-5102 AC-42 (includes): the Include lines at the top of the user file add their hosts after its own, a glob in reverse name order, relative paths from the .ssh folder, nested top Includes in place, a missing file silently, and an absolute path too', async () => {
    sshFile('order.d/a.conf', ['Host glob-a']);
    sshFile('order.d/b.conf', ['Host glob-b']);
    sshFile('sub/second.inc', ['Host second-explicit']);
    sshFile('sub/first.inc', ['Host first-explicit']);
    sshFile('sub/tilde.inc', ['Host tilde-inc']);
    sshFile('sub/hasinclude.inc', [
      'Include sub/topnested.inc',
      'Host from-file-with-top-include',
    ]);
    sshFile('sub/topnested.inc', ['Host top-nested-a', 'Host top-nested-b']);
    sshFile('config', [
      'Include order.d/*.conf',
      'Include sub/second.inc',
      'Include sub/first.inc',
      'Include ~/.ssh/sub/tilde.inc',
      'Include sub/hasinclude.inc',
      'Include sub/missing.inc',
      'Host main-only',
    ]);
    const window = await viewWindow('home-includes');
    try {
      await listing(window, [
        'main-only',
        'glob-b',
        'glob-a',
        'second-explicit',
        'first-explicit',
        'tilde-inc',
        'from-file-with-top-include',
        'top-nested-a',
        'top-nested-b',
        ...systemHosts(),
      ]);
      const absolute = sshFile('absolute.inc', ['Host absolute-host']);
      sshFile('config', [`Include ${absolute}`, 'Host own-host']);
      await titleAction(window, VIEW, 'Refresh');
      await listing(window, ['own-host', 'absolute-host', ...systemHosts()]);
      deepStrictEqual(await notifications(window), []);
    } finally {
      await closeWindow(window);
    }
  });

  it("F-5102 AC-47 (broken-include): an included file that doesn't parse lists none of its hosts at the start, with the user's and the system's hosts and no notification, and once fixed Refresh lists its hosts after the user's", async () => {
    const included = sshFile('broken.inc', [
      'Host inc-valid',
      'Host "unterminated',
    ]);
    sshFile('config', [`Include ${included}`, 'Host user-host']);
    const window = await viewWindow('home-broken');
    try {
      await listing(window, ['user-host', ...systemHosts()]);
      const atStart = await notifications(window);
      sshFile('broken.inc', ['Host inc-valid', 'Host inc-fixed']);
      await titleAction(window, VIEW, 'Refresh');
      await listing(window, [
        'user-host',
        'inc-valid',
        'inc-fixed',
        ...systemHosts(),
      ]);
      deepStrictEqual(atStart, []);
    } finally {
      await closeWindow(window);
    }
  });
});
