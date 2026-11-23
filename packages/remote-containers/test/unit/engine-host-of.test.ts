import {deepStrictEqual} from 'node:assert';
import {
  type EngineWindow,
  type EngineWslSettings,
  engineHostOf,
  labelFolderOf,
} from '../../src/engine/engine-host-of.ts';

const LOCAL: EngineWindow = {remoteName: undefined, distro: undefined};
const WSL_WINDOW: EngineWindow = {remoteName: 'wsl', distro: 'Ubuntu'};
const SETTINGS_OFF: EngineWslSettings = {
  executeInWSL: false,
  executeInWSLDistro: '',
};
const SETTINGS_ON: EngineWslSettings = {
  executeInWSL: true,
  executeInWSLDistro: '',
};
const SETTINGS_NAMED: EngineWslSettings = {
  executeInWSL: true,
  executeInWSLDistro: 'Debian',
};

describe('the engine host of a command (card containers-203, F-0207 BR-18)', () => {
  it('F-0207 BR-19: a folder on a WSL share uses that distro whatever the settings say, even a distro the settings do not name', () => {
    const share = '\\\\wsl.localhost\\Ubuntu\\home\\me\\app';
    const expected = {
      kind: 'distro',
      distro: 'Ubuntu',
      folder: '/home/me/app',
      chosenBy: 'share',
    };
    deepStrictEqual(
      [
        engineHostOf(LOCAL, share, SETTINGS_OFF, 'win32'),
        engineHostOf(LOCAL, share, SETTINGS_NAMED, 'win32'),
        engineHostOf(
          LOCAL,
          '\\\\wsl$\\Ubuntu\\home\\me\\app',
          SETTINGS_ON,
          'win32',
        ),
      ],
      [expected, expected, expected],
    );
  });

  it('F-1301 BR-9: a wsl window’s distro-native folder uses its distro, and its /mnt/<drive>/ folder is handed off to the local host as the Windows folder', () => {
    deepStrictEqual(
      [
        engineHostOf(WSL_WINDOW, '/home/me/app', SETTINGS_NAMED, 'win32'),
        engineHostOf(
          WSL_WINDOW,
          '/mnt/c/Users/me/app',
          SETTINGS_NAMED,
          'win32',
        ),
      ],
      [
        {
          kind: 'distro',
          distro: 'Ubuntu',
          folder: '/home/me/app',
          chosenBy: 'window',
        },
        {kind: 'local', folder: 'c:\\Users\\me\\app'},
      ],
    );
  });

  it('F-0207 BR-3, BR-16: a local Windows window with executeInWSL on uses the configured distro, and an empty one asks for the default with no name', () => {
    deepStrictEqual(
      [
        engineHostOf(LOCAL, 'c:\\work\\app', SETTINGS_NAMED, 'win32'),
        engineHostOf(LOCAL, 'c:\\work\\app', SETTINGS_ON, 'win32'),
      ],
      [
        {
          kind: 'distro',
          distro: 'Debian',
          folder: 'c:\\work\\app',
          chosenBy: 'settings',
        },
        {
          kind: 'distro',
          distro: undefined,
          folder: 'c:\\work\\app',
          chosenBy: 'settings',
        },
      ],
    );
  });

  it('F-0207 BR-4, BR-18: with executeInWSL off, in another remote, and on Linux or macOS whatever the settings say, the host is the local one', () => {
    deepStrictEqual(
      [
        engineHostOf(LOCAL, 'c:\\work\\app', SETTINGS_OFF, 'win32'),
        engineHostOf(
          {remoteName: 'ssh-remote', distro: undefined},
          '/home/me/app',
          SETTINGS_NAMED,
          'win32',
        ),
        engineHostOf(WSL_WINDOW, '/home/me/app', SETTINGS_NAMED, 'linux'),
        engineHostOf(LOCAL, '/home/me/app', SETTINGS_NAMED, 'darwin'),
        engineHostOf(
          LOCAL,
          '\\\\wsl.localhost\\Ubuntu\\home\\me\\app',
          SETTINGS_NAMED,
          'linux',
        ),
        engineHostOf(
          {remoteName: 'wsl', distro: undefined},
          '/home/me/app',
          SETTINGS_NAMED,
          'win32',
        ),
      ],
      [
        {kind: 'local', folder: 'c:\\work\\app'},
        {kind: 'local', folder: '/home/me/app'},
        {kind: 'local', folder: '/home/me/app'},
        {kind: 'local', folder: '/home/me/app'},
        {kind: 'local', folder: '\\\\wsl.localhost\\Ubuntu\\home\\me\\app'},
        {kind: 'local', folder: '/home/me/app'},
      ],
    );
  });
});

describe('the folder label of a container in a distro (card containers-203, F-0207 BR-19)', () => {
  it('F-0207 BR-19: executeInWSL keeps the Windows folder, and a folder of the distro, by a share or a wsl window, is the wsl.localhost form', () => {
    const choices = [
      engineHostOf(LOCAL, 'c:\\work\\app', SETTINGS_ON, 'win32'),
      engineHostOf(
        LOCAL,
        '\\\\wsl$\\Ubuntu\\home\\me\\app',
        SETTINGS_OFF,
        'win32',
      ),
      engineHostOf(WSL_WINDOW, '/home/me/app', SETTINGS_OFF, 'win32'),
    ].flatMap(choice => (choice.kind === 'distro' ? [choice] : []));
    deepStrictEqual(
      choices.map(choice => labelFolderOf(choice, 'Ubuntu')),
      [
        'c:\\work\\app',
        '\\\\wsl.localhost\\Ubuntu\\home\\me\\app',
        '\\\\wsl.localhost\\Ubuntu\\home\\me\\app',
      ],
    );
  });
});
