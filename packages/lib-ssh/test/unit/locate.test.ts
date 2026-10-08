import {deepStrictEqual, strictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import {
  candidates,
  judge,
  scpProgram,
  VERSION_ARGUMENTS,
} from '../../src/index.ts';
import type {ClientCandidate, ClientPlatform} from '../../src/index.ts';

/** The environment of a row: the search path and the Program Files folder, each empty when unset. */
function makeEnv(searchPath: string, programFilesFolder: string) {
  return {searchPath, programFilesFolder};
}

/** A candidate the row names. */
function makeCandidate(program: string, origin: ClientCandidate['origin']) {
  return {program, origin};
}

/** The text the worker's own ssh -V printed. */
function recordedBanner(): string {
  const fixture = JSON.parse(
    readFileSync(
      new URL('../fixtures/banners/recorded.json', import.meta.url),
      'utf8',
    ),
  ) as {source: string; text: string};
  return fixture.text;
}

describe('candidates (the programs to try, in order)', () => {
  it('F-2101.BR-1: an empty setting looks up the bare name on the path', () => {
    deepStrictEqual(candidates('', makeEnv('/usr/bin:/bin', ''), 'linux'), [
      {program: 'ssh', origin: 'path'},
    ]);
  });

  it('F-2101.BR-1: a setting leads, then the path lookup', () => {
    deepStrictEqual(
      candidates('/opt/ssh/bin/ssh', makeEnv('/usr/bin', ''), 'linux'),
      [
        {program: '/opt/ssh/bin/ssh', origin: 'setting'},
        {program: 'ssh', origin: 'path'},
      ],
    );
  });

  it('F-2101.BR-1: the bare name on macOS', () => {
    deepStrictEqual(candidates('', makeEnv('/usr/bin', ''), 'macOS'), [
      {program: 'ssh', origin: 'path'},
    ]);
  });

  it('F-2101.BR-1: the windows name and the Git for Windows place', () => {
    deepStrictEqual(
      candidates(
        '',
        makeEnv('C:\\Windows\\System32', 'C:\\Program Files'),
        'windows',
      ),
      [
        {program: 'ssh.exe', origin: 'path'},
        {
          program: 'C:\\Program Files\\Git\\usr\\bin\\ssh.exe',
          origin: 'gitForWindows',
        },
      ],
    );
  });

  it('F-2101.BR-1: a windows setting leads, then the two lookups', () => {
    const list = candidates(
      'C:\\x\\ssh.exe',
      makeEnv('C:\\Windows\\System32', 'C:\\Program Files'),
      'windows',
    );
    deepStrictEqual(
      list.map(candidate => candidate.origin),
      ['setting', 'path', 'gitForWindows'],
    );
    deepStrictEqual(list[0], {program: 'C:\\x\\ssh.exe', origin: 'setting'});
  });

  const SETTINGS = [
    '~/bin/ssh',
    '$HOME/ssh',
    'ssh-custom',
    'C:\\Program Files\\OpenSSH\\ssh.exe',
    '   ',
  ] as const;
  for (const setting of SETTINGS) {
    it(`F-2101.BR-2: a setting of ${setting} leads, as written`, () => {
      const list = candidates(setting, makeEnv('/usr/bin', ''), 'linux');
      deepStrictEqual(list[0], {program: setting, origin: 'setting'});
    });
  }

  it('F-2101.BR-1 (lead 2026-10-07): an empty environment gives no candidate', () => {
    deepStrictEqual(candidates('', makeEnv('', ''), 'linux'), []);
  });

  it('F-2101.BR-1 (lead 2026-10-07): a Program Files folder alone gives the Git place', () => {
    deepStrictEqual(candidates('', makeEnv('', 'D:\\Apps'), 'windows'), [
      {program: 'D:\\Apps\\Git\\usr\\bin\\ssh.exe', origin: 'gitForWindows'},
    ]);
  });

  it('F-2101.BR-1 (lead 2026-10-07): a windows search path alone gives the name', () => {
    deepStrictEqual(candidates('', makeEnv('C:\\Windows', ''), 'windows'), [
      {program: 'ssh.exe', origin: 'path'},
    ]);
  });
});

describe('VERSION_ARGUMENTS (the one check argument)', () => {
  it('F-2101.BR-3: the check runs -V', () => {
    deepStrictEqual([...VERSION_ARGUMENTS], ['-V']);
  });
});

describe('judge (whether a banner accepts a candidate)', () => {
  const BANNERS = [
    'OpenSSH_9.6p1 Ubuntu-3ubuntu13, OpenSSL 3.0.13 30 Jan 2024',
    'openssh_9.0p1',
    'OpenSSH_for_Windows_9.5p1, LibreSSL 3.8.2',
    'OpenSSH_6.5p1, OpenSSL 1.0.1 14 Mar 2012',
  ] as const;
  for (const banner of BANNERS) {
    it(`F-2101.BR-4: the banner ${banner.slice(0, 24)} is accepted`, () => {
      strictEqual(judge(0, banner), true);
    });
  }

  it('F-2101.BR-4: the recorded banner is accepted', () => {
    strictEqual(judge(0, recordedBanner()), true);
  });

  it('F-2101.Q2: an empty output is rejected', () => {
    strictEqual(judge(0, ''), false);
  });

  const STATUSES: Array<[string, number | undefined]> = [
    ['a non-zero exit', 1],
    ['a 255 exit', 255],
    ['an unstarted program', undefined],
    ['an unstarted program with empty output', undefined],
  ];
  for (const [label, status] of STATUSES) {
    it(`F-2101.BR-5: ${label} is rejected`, () => {
      strictEqual(judge(status, 'OpenSSH_9.6p1'), false);
    });
  }

  const NON_OPENSHELL_BANNERS: Array<[string, string]> = [
    ['Plink: Release 0.80', 'a plink banner'],
    ['ssh: command not found', 'a not-found line'],
    ['Open SSH 9', 'a spaced name'],
    [' \n', 'a single blank and line end'],
  ];
  for (const [banner, label] of NON_OPENSHELL_BANNERS) {
    it(`F-2101.BR-5: ${label} is rejected`, () => {
      strictEqual(judge(0, banner), false);
    });
  }
});

describe('scpProgram (the scp beside an accepted ssh)', () => {
  const NON_WINDOWS: Array<[string, ClientPlatform, string]> = [
    ['/opt/ssh/bin/ssh', 'linux', '/opt/ssh/bin/scp'],
    ['/opt/s/ssh', 'macOS', '/opt/s/scp'],
  ];
  for (const [program, platform, expected] of NON_WINDOWS) {
    it(`F-2405.BR-6: ${program} on ${platform} takes the scp beside it`, () => {
      strictEqual(
        scpProgram(makeCandidate(program, 'setting'), platform),
        expected,
      );
    });
  }

  const BARE_NAMES: Array<[string, ClientCandidate['origin']]> = [
    ['ssh', 'path'],
    ['ssh-custom', 'setting'],
  ];
  for (const [program, origin] of BARE_NAMES) {
    it(`F-2405.BR-6: the bare ${program} looks up scp on the path`, () => {
      strictEqual(scpProgram(makeCandidate(program, origin), 'linux'), 'scp');
    });
  }

  const WINDOWS: Array<[string, ClientCandidate['origin'], string]> = [
    ['C:\\Tools\\OpenSSH\\ssh.exe', 'setting', 'C:\\Tools\\OpenSSH\\scp.exe'],
    ['ssh', 'path', 'scp.exe'],
    [
      'C:\\Program Files\\Git\\usr\\bin\\ssh.exe',
      'gitForWindows',
      'C:\\Program Files\\Git\\usr\\bin\\scp.exe',
    ],
  ];
  for (const [program, origin, expected] of WINDOWS) {
    it(`F-2405.BR-6: ${program} on windows takes ${expected}`, () => {
      strictEqual(
        scpProgram(makeCandidate(program, origin), 'windows'),
        expected,
      );
    });
  }

  it('F-2405.BR-6: a bare ssh.exe on windows looks up scp.exe', () => {
    strictEqual(
      scpProgram(makeCandidate('ssh.exe', 'path'), 'windows'),
      'scp.exe',
    );
  });
});
