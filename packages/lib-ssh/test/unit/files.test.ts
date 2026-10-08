import {deepStrictEqual, strictEqual} from 'node:assert';
import {filesInEffect} from '../../src/index.ts';
import {pathsFor} from '../../src/config/files.ts';
import {memoryReader} from './memory-reader.fixture.ts';
import type {ConfigFileReader} from '../../src/index.ts';

const USER_FILE = '/home/dev/.ssh/config';
const SYSTEM_FILE = '/etc/ssh/ssh_config';
const USER_TEXT = 'Host example\n  HostName example.local\n';
const SYSTEM_TEXT = 'Host example\n  User example\n';
const LINUX = {homeFolder: '/home/dev', platform: 'linux'} as const;

/** The user and system files through the port; the user file is present, empty, or missing per its text. */
function userAndSystem(userText: string | undefined): ConfigFileReader {
  const texts = new Map<string, string>();
  if (userText !== undefined) {
    texts.set(USER_FILE, userText);
  }
  texts.set(SYSTEM_FILE, SYSTEM_TEXT);
  return memoryReader(texts);
}

/** The user and system files, each with its text in the port. */
const EXPECTED_FILES = [
  {
    file: USER_FILE,
    role: 'user',
    includeBase: '/home/dev/.ssh',
    exists: true,
  },
  {
    file: SYSTEM_FILE,
    role: 'system',
    includeBase: '/etc/ssh',
    exists: true,
  },
] as const;

describe('filesInEffect (the configuration files in reading order)', () => {
  it('F-2201.BR-1 / AC-1: the user and the system file when the setting is empty', () => {
    const reader = userAndSystem(USER_TEXT);
    deepStrictEqual(filesInEffect('', {...LINUX}, reader), EXPECTED_FILES);
  });

  it('F-2201.AC-3: a user file held as empty text still exists', () => {
    const reader = userAndSystem('');
    deepStrictEqual(filesInEffect('', {...LINUX}, reader), EXPECTED_FILES);
  });

  it('F-2201.AC-3: the user file missing keeps the same two entries', () => {
    const reader = userAndSystem(undefined);
    deepStrictEqual(filesInEffect('', {...LINUX}, reader), [
      {
        file: USER_FILE,
        role: 'user',
        includeBase: '/home/dev/.ssh',
        exists: false,
      },
      {
        file: SYSTEM_FILE,
        role: 'system',
        includeBase: '/etc/ssh',
        exists: true,
      },
    ]);
  });

  it('F-2201.BR-2: a configured file present is the only entry', () => {
    const reader = memoryReader(new Map([['/srv/ssh/custom', USER_TEXT]]));
    deepStrictEqual(filesInEffect('/srv/ssh/custom', {...LINUX}, reader), [
      {
        file: '/srv/ssh/custom',
        role: 'configured',
        includeBase: '/srv/ssh',
        exists: true,
      },
    ]);
  });

  it('F-2201.BR-2: a configured file missing is the only entry and does not exist', () => {
    deepStrictEqual(
      filesInEffect('/srv/ssh/custom', {...LINUX}, memoryReader(new Map())),
      [
        {
          file: '/srv/ssh/custom',
          role: 'configured',
          includeBase: '/srv/ssh',
          exists: false,
        },
      ],
    );
  });

  it('F-2201.BR-3: a configured ~/alt expands against the home folder', () => {
    const reader = memoryReader(new Map([['/home/dev/alt', USER_TEXT]]));
    deepStrictEqual(filesInEffect('~/alt', {...LINUX}, reader), [
      {
        file: '/home/dev/alt',
        role: 'configured',
        includeBase: '/home/dev',
        exists: true,
      },
    ]);
  });

  it('F-2201.BR-3: a configured ~ is the home folder itself', () => {
    deepStrictEqual(filesInEffect('~', {...LINUX}, memoryReader(new Map())), [
      {
        file: '/home/dev',
        role: 'configured',
        includeBase: '/home',
        exists: false,
      },
    ]);
  });

  const AS_WRITTEN = [
    ['rel/config', 'rel'],
    ['$HOME/x', '$HOME'],
    ['${env:HOME}/x', '${env:HOME}'],
  ] as const;
  for (const [setting, includeBase] of AS_WRITTEN) {
    it(`F-2201.BR-3: a configured ${setting} is used as written`, () => {
      deepStrictEqual(
        filesInEffect(setting, {...LINUX}, memoryReader(new Map())),
        [
          {
            file: setting,
            role: 'configured',
            includeBase,
            exists: false,
          },
        ],
      );
    });
  }

  it('F-2201.BR-2: a configured setting of spaces is used as written', () => {
    deepStrictEqual(filesInEffect('   ', {...LINUX}, memoryReader(new Map())), [
      {
        file: '   ',
        role: 'configured',
        includeBase: '.',
        exists: false,
      },
    ]);
  });

  it('F-2201.BR-6: a call reads the port again, so a changed file shows', () => {
    const contents = new Map([['/srv/ssh/custom', USER_TEXT]]);
    const reader = memoryReader(contents);
    const first = filesInEffect('/srv/ssh/custom', {...LINUX}, reader);
    contents.delete('/srv/ssh/custom');
    const second = filesInEffect('/srv/ssh/custom', {...LINUX}, reader);
    deepStrictEqual(
      [first, second].map(list => list.map(entry => entry.exists)),
      [[true], [false]],
    );
  });

  it('F-2201.12 (Windows): the user file under the home folder and the system file under ProgramData', () => {
    const reader = memoryReader(
      new Map([
        ['C:\\Users\\dev\\.ssh\\config', USER_TEXT],
        ['C:\\ProgramData\\ssh\\ssh_config', SYSTEM_TEXT],
      ]),
    );
    const locations = {
      homeFolder: 'C:\\Users\\dev',
      platform: 'windows',
      programDataFolder: 'C:\\ProgramData',
    } as const;
    deepStrictEqual(filesInEffect('', locations, reader), [
      {
        file: 'C:\\Users\\dev\\.ssh\\config',
        role: 'user',
        includeBase: 'C:\\Users\\dev\\.ssh',
        exists: true,
      },
      {
        file: 'C:\\ProgramData\\ssh\\ssh_config',
        role: 'system',
        includeBase: 'C:\\ProgramData\\ssh',
        exists: true,
      },
    ]);
  });

  it('F-2201.12 (Windows): a configured file takes the directory as its base', () => {
    const reader = memoryReader(new Map([['C:\\cfg\\mine', USER_TEXT]]));
    const locations = {
      homeFolder: 'C:\\Users\\dev',
      platform: 'windows',
      programDataFolder: 'C:\\ProgramData',
    } as const;
    deepStrictEqual(filesInEffect('C:\\cfg\\mine', locations, reader), [
      {
        file: 'C:\\cfg\\mine',
        role: 'configured',
        includeBase: 'C:\\cfg',
        exists: true,
      },
    ]);
  });

  const Q4_SETTINGS = [
    ['~\\cfg', 'C:\\Users\\dev\\cfg', 'C:\\Users\\dev'],
    ['~/cfg', 'C:\\Users\\dev\\cfg', 'C:\\Users\\dev'],
    ['C:/cfg/mine', 'C:/cfg/mine', 'C:/cfg'],
  ] as const;
  for (const [setting, file, includeBase] of Q4_SETTINGS) {
    it(`F-2201.Q4 (lead 2026-10-07): a configured ${setting} on Windows`, () => {
      const locations = {
        homeFolder: 'C:\\Users\\dev',
        platform: 'windows',
        programDataFolder: 'C:\\ProgramData',
      } as const;
      deepStrictEqual(
        filesInEffect(setting, locations, memoryReader(new Map())),
        [
          {
            file,
            role: 'configured',
            includeBase,

            exists: false,
          },
        ],
      );
    });
  }

  it('F-2201.12 (provisional): a macOS client reads the user file and the system file', () => {
    const reader = memoryReader(
      new Map([
        ['/Users/dev/.ssh/config', USER_TEXT],
        [SYSTEM_FILE, SYSTEM_TEXT],
      ]),
    );
    deepStrictEqual(
      filesInEffect('', {homeFolder: '/Users/dev', platform: 'macOS'}, reader),
      [
        {
          file: '/Users/dev/.ssh/config',
          role: 'user',
          includeBase: '/Users/dev/.ssh',
          exists: true,
        },
        {
          file: SYSTEM_FILE,
          role: 'system',
          includeBase: '/etc/ssh',
          exists: true,
        },
      ],
    );
  });

  it('F-2202.12 (provisional): a Windows client without a program-data folder falls back to C:\\ProgramData', () => {
    const reader = memoryReader(
      new Map([
        ['C:\\Users\\dev\\.ssh\\config', USER_TEXT],
        ['C:\\ProgramData\\ssh\\ssh_config', SYSTEM_TEXT],
      ]),
    );
    deepStrictEqual(
      filesInEffect(
        '',
        {homeFolder: 'C:\\Users\\dev', platform: 'windows'},
        reader,
      ),
      [
        {
          file: 'C:\\Users\\dev\\.ssh\\config',
          role: 'user',
          includeBase: 'C:\\Users\\dev\\.ssh',
          exists: true,
        },
        {
          file: 'C:\\ProgramData\\ssh\\ssh_config',
          role: 'system',
          includeBase: 'C:\\ProgramData\\ssh',
          exists: true,
        },
      ],
    );
  });
});

const SEPARATORS = [
  ['windows', '\\'],
  ['linux', '/'],
  ['macOS', '/'],
] as const;

describe('pathsFor (the path functions of a platform)', () => {
  for (const [platform, separator] of SEPARATORS) {
    it(`S4 contract: the separator of ${platform}`, () => {
      strictEqual(pathsFor(platform).sep, separator);
    });
  }
});
