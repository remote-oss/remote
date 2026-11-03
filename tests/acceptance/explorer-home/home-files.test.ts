/**
 * @fileoverview The hosts of the user's and the system's SSH configuration files (card coverage-25c, part b): the
 * launch runs the editor with the run's own HOME, so each row writes `<home>/.ssh/config` itself, and with
 * `remote.SSH.configFile` cleared the group lists the user file's hosts and then the system file's.
 */

import {deepStrictEqual} from 'node:assert';
import {mkdirSync, readdirSync, rmSync} from 'node:fs';
import path from 'node:path';
import {listing, VIEW} from '../windows/explorer-rows.ts';
import {
  sshFile,
  sshFolder,
  systemHosts,
  viewWindow,
} from '../windows/explorer-home.ts';
import {
  closeWindow,
  readUserSettings,
  restoreUserSettings,
  userSettings,
} from '../windows/harness.ts';
import {
  chooseQuickPickRow,
  notifications,
  rowAction,
  titleAction,
} from '../windows/renderer.ts';

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
      await rowAction(window, VIEW, 'SSH', 'Open SSH Config File');
      await chooseQuickPickRow(window, config);
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
