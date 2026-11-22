import {deepStrictEqual} from 'node:assert';
import type {ListedContainer} from '../../src/explorer/listed-containers.ts';
import type {ListedVolume} from '../../src/explorer/listed-volumes.ts';
import {
  containersMounting,
  isListedVolume,
  volumeRowsOf,
  type VolumeRow,
} from '../../src/explorer/volumes-model.ts';

const CLOCK = Date.UTC(2026, 10, 22, 12, 0, 0);
const MINUTE = 60 * 1000;
const HEX64 = 'a'.repeat(64);
const UNIQUE = 'vsch.local.repository.unique';
const REPOSITORY = 'vsch.local.repository';

function volume(
  name: string,
  labels: Record<string, string> = {},
  createdAt: number | null = CLOCK - 5 * MINUTE,
): ListedVolume {
  return {name, labels, ...(createdAt === null ? {} : {createdAt})};
}

function container(
  name: string,
  volumes: string[],
  createdAt = CLOCK - MINUTE,
): ListedContainer {
  return {
    id: name,
    name,
    image: 'image',
    state: 'running',
    createdAt,
    startedAt: undefined,
    finishedAt: undefined,
    labels: {},
    binds: [],
    volumes,
  };
}

function rows(
  volumes: ListedVolume[],
  containers: ListedContainer[] = [],
): VolumeRow[] {
  return volumeRowsOf({
    volumes,
    containers,
    now: CLOCK,
    translate: template => template,
  });
}

function unique(repository: string, more: Record<string, string> = {}) {
  return volume('some-volume', {
    [UNIQUE]: 'true',
    [REPOSITORY]: repository,
    ...more,
  });
}

describe('the Dev Volumes rows (card containers-167)', () => {
  it('F-0904 AC-1, AC-33, AC-40, BR-1: the shared volume and the names of exactly 64 hexadecimal digits in any case are no rows, and 63 or 65 digits, 64 other characters, a prefix before 64 digits and a normal name with the anonymous label are', () => {
    const names = [
      'vscode',
      HEX64,
      'A'.repeat(64),
      'aB'.repeat(32),
      'a'.repeat(63),
      'a'.repeat(65),
      'z'.repeat(64),
      `g${'a'.repeat(63)}`,
      `repo-${HEX64}`,
      'normal',
      'vscode2',
    ];
    deepStrictEqual(
      [
        names.map(isListedVolume),
        rows([volume(HEX64, {[UNIQUE]: 'true', [REPOSITORY]: 'x'})]),
        rows([volume('normal', {'com.docker.volume.anonymous': ''})]).map(
          entry => entry.name,
        ),
      ],
      [
        [false, false, false, false, true, true, true, true, true, true, true],
        [],
        ['normal'],
      ],
    );
  });

  it('F-0904 AC-3, AC-4, BR-2: only the label exactly true makes a uniqueDevVolume, and the absent label, false, TRUE, 1 and empty make a devVolume', () => {
    deepStrictEqual(
      [undefined, 'true', 'false', 'TRUE', '1', ''].map(value => {
        const entry = rows([
          volume('v', value === undefined ? {} : {[UNIQUE]: value}),
        ])[0];
        return [entry?.kind, entry?.viewItem, entry?.icon];
      }),
      [
        ['devVolume', 'devVolume', 'file-symlink-directory'],
        ['uniqueDevVolume', 'uniqueDevVolume', 'file-symlink-directory'],
        ['devVolume', 'devVolume', 'file-symlink-directory'],
        ['devVolume', 'devVolume', 'file-symlink-directory'],
        ['devVolume', 'devVolume', 'file-symlink-directory'],
        ['devVolume', 'devVolume', 'file-symlink-directory'],
      ],
    );
  });

  it('F-0904 AC-5, AC-6, AC-2, BR-3: a unique volume with a GitHub shape is labelled owner/repo in the value’s case, and an owner-only URL, another host, a look-alike host, a non-URL and a devVolume keep the raw name', () => {
    const shapes = [
      'https://github.com/Octocat/Linguist',
      'https://github.com/Octocat/Linguist.git',
      'https://github.com/Octocat/Linguist/',
      'http://github.com/Octocat/Linguist',
      'https://www.github.com/Octocat/Linguist',
      'https://GitHub.com/Octocat/Linguist',
      'https://github.com/Octocat/Linguist/tree/main',
      'git@github.com:Octocat/Linguist.git',
      'ssh://git@github.com/Octocat/Linguist.git',
    ];
    const kept = [
      'https://github.com/Octocat',
      'https://github.example.com/Octocat/Linguist',
      'https://github.com.example.org/Octocat/Linguist',
      'git://host/x.git',
      'not a url',
    ];
    deepStrictEqual(
      [
        shapes.map(value => rows([unique(value)])[0]?.label),
        kept.map(value => rows([unique(value)])[0]?.label),
        rows([volume('plain', {[REPOSITORY]: 'https://github.com/o/r'})])[0]
          ?.label,
      ],
      [
        shapes.map(() => 'Octocat/Linguist'),
        kept.map(() => 'some-volume'),
        'plain',
      ],
    );
  });

  it('F-0904 AC-23, AC-31, BR-3: the description is #n from the pull-request label, else the branch, on a GitHub unique entry only', () => {
    const github = 'https://github.com/o/r/pull/7';
    deepStrictEqual(
      [
        rows([unique(github, {'vsch.local.repository.pullRequestId': '9'})])[0]
          ?.description,
        rows([unique(github)])[0]?.description,
        rows([unique(github, {'vsch.local.repository.branch': 'test'})])[0]
          ?.description,
        rows([
          unique(github, {
            'vsch.local.repository.branch': 'test',
            'vsch.local.repository.pullRequestId': '9',
          }),
        ])[0]?.description,
        rows([
          unique('git://h/x.git', {'vsch.local.repository.branch': 'b'}),
        ])[0]?.description,
        rows([
          volume('d', {
            'vsch.local.repository.branch': 'b',
            [REPOSITORY]: github,
          }),
        ])[0]?.description,
      ],
      ['#9', '', 'test', '#9', '', ''],
    );
  });

  it('F-0904 AC-7, AC-23, AC-27, AC-31, AC-37, BR-4: the tooltip lists the source, the branch, the pull request, the time and the mounting containers newest first, None when none mounts, and a container that only names the volume is no mount', () => {
    const github = unique('https://github.com/o/r/tree/main/x.git', {
      'vsch.local.repository.branch': 'main',
      'vsch.local.repository.pullRequestId': '12',
    });
    const [entry] = rows(
      [github],
      [
        container('first', ['some-volume'], CLOCK - 3 * MINUTE),
        container('other', ['elsewhere'], CLOCK - MINUTE),
        container('last', ['some-volume'], CLOCK - 1000),
      ],
    );
    const [none] = rows([unique('https://github.com/o/r')]);
    deepStrictEqual(
      [entry?.tooltip, none?.tooltip.at(-1)],
      [
        [
          {
            icon: 'github',
            text: 'https://github.com/o/r',
            link: 'https://github.com/o/r',
          },
          {icon: 'git-branch', text: 'main'},
          {
            icon: 'git-pull-request',
            text: '#12',
            link: 'https://github.com/o/r/pull/12',
          },
          {icon: 'history', text: '5 minutes ago'},
          {icon: 'vm', text: 'last, first'},
        ],
        {icon: 'vm', text: 'None'},
      ],
    );
  });

  it('F-0904 AC-7, BR-4: another web source is its address without .git as a link, a git:// source or a non-URL is plain text ending in a parenthesis with .git kept, and a devVolume names its raw volume', () => {
    deepStrictEqual(
      [
        rows([unique('https://example.org/a/b.git')])[0]?.tooltip[0],
        rows([unique('git://host/name.git')])[0]?.tooltip[0],
        rows([unique('not a url')])[0]?.tooltip[0],
        rows([volume('plain', {[REPOSITORY]: 'https://github.com/o/r'})])[0]
          ?.tooltip[0],
        rows([volume('some-volume', {[UNIQUE]: 'true'})])[0]?.tooltip[0],
      ],
      [
        {
          icon: 'source-control',
          text: 'https://example.org/a/b',
          link: 'https://example.org/a/b',
        },
        {icon: 'source-control', text: 'git://host/name.git)'},
        {icon: 'source-control', text: 'not a url)'},
        {icon: 'file-symlink-directory', text: 'plain'},
        {icon: 'file-symlink-directory', text: 'some-volume'},
      ],
    );
  });

  it('F-0904 BR-4, reading-2027-tooltip-text: a GitHub name holding a parenthesis, a bracket, a space or a newline gets its text without a link, and another web address has them escaped so that none ends a link early', () => {
    const oddity = ['a)b', 'a]b', 'a b', 'a\nb'];
    deepStrictEqual(
      [
        oddity.map(owner => {
          const line = rows([unique(`https://github.com/${owner}/r`)])[0]
            ?.tooltip[0];
          return [line?.icon, line?.link];
        }),
        rows([unique('https://example.org/a)b](c d)\ne')])[0]?.tooltip[0]?.link,
        rows([unique('https://example.org/a b')])[0]?.tooltip[0]?.link,
      ],
      [
        oddity.map(() => ['github', undefined]),
        'https://example.org/a%29b%5D%28c%20d%29e',
        'https://example.org/a%20b',
      ],
    );
  });

  it('F-0904 AC-15, BR-6: the rows are newest first, one second’s volumes are in ascending raw name whatever their labels, and a volume with no creation time is last with no time line', () => {
    const second = CLOCK - 10 * MINUTE;
    const ordered = rows([
      volume(
        'tie-c',
        {[UNIQUE]: 'true', [REPOSITORY]: 'https://github.com/a/z'},
        second,
      ),
      volume('old', {}, CLOCK - 60 * MINUTE),
      volume(
        'tie-a',
        {[UNIQUE]: 'true', [REPOSITORY]: 'https://github.com/a/y'},
        second,
      ),
      volume('timeless', {}, null),
      volume('tie-b', {}, second),
      volume('new', {}, CLOCK - MINUTE),
    ]);
    deepStrictEqual(
      [
        ordered.map(entry => entry.name),
        ordered.at(-1)?.tooltip.map(line => line.icon),
      ],
      [
        ['new', 'tie-a', 'tie-b', 'tie-c', 'old', 'timeless'],
        ['file-symlink-directory', 'vm'],
      ],
    );
  });

  it('F-0904 BR-4: a time in the future reads as negative seconds, and a pull-request label that is not a number is text without a link', () => {
    const [future] = rows([volume('v', {}, CLOCK + 7199 * 1000)]);
    const [oddity] = rows([
      unique('https://github.com/o/r', {
        'vsch.local.repository.pullRequestId': 'x',
      }),
    ]);
    deepStrictEqual(
      [future?.tooltip[1], oddity?.tooltip[1], oddity?.description],
      [
        {icon: 'history', text: '-7199 seconds ago'},
        {icon: 'git-pull-request', text: '#x'},
        '#x',
      ],
    );
  });

  it('F-0904 7.E6 (inferred): a unique volume with no repository label is a entry named by its raw name, with the raw name as its source line and no description', () => {
    const [entry] = rows([volume('by-hand', {[UNIQUE]: 'true'})]);
    deepStrictEqual(
      [entry?.kind, entry?.label, entry?.description, entry?.tooltip[0]],
      [
        'uniqueDevVolume',
        'by-hand',
        '',
        {icon: 'file-symlink-directory', text: 'by-hand'},
      ],
    );
  });

  it('F-0904 BR-5, BR-8: the containers mounting a volume are those that list it among their volumes, in any state, newest first', () => {
    deepStrictEqual(
      containersMounting('v', [
        container('a', ['v'], 1),
        container('b', ['w'], 2),
        container('c', ['v', 'w'], 3),
      ]).map(each => each.name),
      ['c', 'a'],
    );
  });
});
