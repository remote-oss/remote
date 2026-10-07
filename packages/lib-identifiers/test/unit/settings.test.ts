import {strictEqual} from 'node:assert';
import {
  readSetting,
  type SettingEntry,
  type SettingHost,
  type SettingInspection,
} from '../../src/index.ts';

const DOCKER_PATH: SettingEntry = {
  id: 'dev.containers.dockerPath',
  scope: 'machine',
  legacyId: 'remote.containers.dockerPath',
  legacyScope: 'machine',
  winner: 'current',
};

const DOTFILES_REPOSITORY: SettingEntry = {
  id: 'dotfiles.repository',
  scope: 'machine',
  legacyId: 'remote.containers.dotfiles.repository',
  legacyScope: 'machine',
  winner: 'legacy',
};

const LOG_LEVEL: SettingEntry = {id: 'remote.X.logLevel', scope: 'window'};

function hostWith(inspections: Record<string, SettingInspection>): SettingHost {
  return {inspectSetting: settingId => inspections[settingId] ?? {}};
}

describe('readSetting', () => {
  describe('a setting without a legacy twin', () => {
    it('yields the declared default when nothing is set', () => {
      const host = hostWith({'remote.X.logLevel': {defaultValue: 'info'}});
      strictEqual(readSetting(host, LOG_LEVEL), 'info');
    });

    it('yields the user value', () => {
      const host = hostWith({
        'remote.X.logLevel': {defaultValue: 'info', globalValue: 'trace'},
      });
      strictEqual(readSetting(host, LOG_LEVEL), 'trace');
    });

    it('prefers the workspace folder value for a window-scoped setting', () => {
      const host = hostWith({
        'remote.X.logLevel': {
          globalValue: 'trace',
          workspaceValue: 'debug',
          workspaceFolderValue: 'error',
        },
      });
      strictEqual(readSetting(host, LOG_LEVEL), 'error');
    });

    it('prefers the workspace value over the user value for a window-scoped setting', () => {
      const host = hostWith({
        'remote.X.logLevel': {globalValue: 'trace', workspaceValue: 'debug'},
      });
      strictEqual(readSetting(host, LOG_LEVEL), 'debug');
    });

    it('ignores workspace values of a machine-scoped setting (F-0102 BR-12)', () => {
      const host = hostWith({
        'dev.containers.dockerPath': {
          defaultValue: 'docker',
          workspaceValue: '/missing/docker',
        },
      });
      strictEqual(readSetting(host, DOCKER_PATH), 'docker');
    });

    it('counts null as a value the user set', () => {
      const host = hostWith({
        'remote.X.logLevel': {defaultValue: 'info', globalValue: null},
      });
      strictEqual(readSetting(host, LOG_LEVEL), null);
    });
  });

  describe('a pair whose current key wins (F-0102 BR-4)', () => {
    it('takes the current value when both hold one (F-0102 AC-8)', () => {
      const host = hostWith({
        'dev.containers.dockerPath': {globalValue: 'docker'},
        'remote.containers.dockerPath': {globalValue: '/missing/docker'},
      });
      strictEqual(readSetting(host, DOCKER_PATH), 'docker');
    });

    it('takes the current value when it equals the default (F-0102 AC-8)', () => {
      const host = hostWith({
        'dev.containers.dockerPath': {
          defaultValue: 'docker',
          globalValue: 'docker',
        },
        'remote.containers.dockerPath': {globalValue: '/usr/local/bin/docker'},
      });
      strictEqual(readSetting(host, DOCKER_PATH), 'docker');
    });

    it('takes the legacy value when only it holds one (F-0102 AC-31)', () => {
      const host = hostWith({
        'dev.containers.dockerPath': {defaultValue: 'docker'},
        'remote.containers.dockerPath': {globalValue: '/usr/local/bin/docker'},
      });
      strictEqual(readSetting(host, DOCKER_PATH), '/usr/local/bin/docker');
    });

    it('counts an empty legacy value as held', () => {
      const host = hostWith({
        'dev.containers.dockerPath': {defaultValue: 'docker'},
        'remote.containers.dockerPath': {globalValue: ''},
      });
      strictEqual(readSetting(host, DOCKER_PATH), '');
    });

    it('yields the current default when neither holds a value', () => {
      const host = hostWith({
        'dev.containers.dockerPath': {defaultValue: 'docker'},
      });
      strictEqual(readSetting(host, DOCKER_PATH), 'docker');
    });

    it('ignores a legacy value in workspace settings (F-0102 BR-12)', () => {
      const host = hostWith({
        'dev.containers.dockerPath': {defaultValue: 'docker'},
        'remote.containers.dockerPath': {workspaceValue: '/missing/docker'},
      });
      strictEqual(readSetting(host, DOCKER_PATH), 'docker');
    });
  });

  describe('a pair whose legacy key wins (F-0102 BR-4, the dotfiles pairs)', () => {
    it('takes the legacy value when both hold one (F-0102 AC-8)', () => {
      const host = hostWith({
        'dotfiles.repository': {globalValue: 'owner/new'},
        'remote.containers.dotfiles.repository': {globalValue: 'owner/old'},
      });
      strictEqual(readSetting(host, DOTFILES_REPOSITORY), 'owner/old');
    });

    it('takes the current value when the legacy value is empty (F-0102 AC-26)', () => {
      const host = hostWith({
        'dotfiles.repository': {globalValue: 'owner/new'},
        'remote.containers.dotfiles.repository': {globalValue: ''},
      });
      strictEqual(readSetting(host, DOTFILES_REPOSITORY), 'owner/new');
    });

    it('takes the current value when the legacy value is null (F-0102 AC-26)', () => {
      const host = hostWith({
        'dotfiles.repository': {globalValue: 'owner/new'},
        'remote.containers.dotfiles.repository': {globalValue: null},
      });
      strictEqual(readSetting(host, DOTFILES_REPOSITORY), 'owner/new');
    });

    it('takes the current value when the legacy key holds none', () => {
      const host = hostWith({
        'dotfiles.repository': {globalValue: 'owner/new'},
      });
      strictEqual(readSetting(host, DOTFILES_REPOSITORY), 'owner/new');
    });

    it('yields the current default when the legacy value is empty and the current key holds none', () => {
      const host = hostWith({
        'dotfiles.repository': {defaultValue: '~/dotfiles'},
        'remote.containers.dotfiles.repository': {globalValue: ''},
      });
      strictEqual(readSetting(host, DOTFILES_REPOSITORY), '~/dotfiles');
    });
  });

  it('reads a legacy twin without a declared scope as window-scoped', () => {
    const host = hostWith({
      'remote.X.logLevel': {defaultValue: 'info'},
      'remote.X.legacyLogLevel': {workspaceValue: 'trace'},
    });
    strictEqual(
      readSetting(host, {...LOG_LEVEL, legacyId: 'remote.X.legacyLogLevel'}),
      'trace',
    );
  });
});
