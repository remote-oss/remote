import {deepStrictEqual} from 'node:assert';
import {
  namedVolumeLabelsOf,
  namedVolumeInspectArguments,
  namedVolumeListArguments,
  namedVolumesOf,
  uniqueVolumeLabelsOf,
  volumeCreateArguments,
  volumeInspectArguments,
} from '../../src/volumes/clone-volume.ts';

const SOURCE = {
  repositoryPath: 'https://github.com/o/r/tree/main',
  urlToClone: 'https://github.com/o/r',
  repositoryName: 'r',
};

describe('the clone’s volume (card containers-151)', () => {
  it('F-0702: a unique volume is labelled with its repository and the unique mark, and its ref when it has one', () => {
    deepStrictEqual(
      [
        uniqueVolumeLabelsOf({...SOURCE, ref: 'main'}),
        uniqueVolumeLabelsOf(SOURCE),
      ],
      [
        [
          'vsch.local.repository=https://github.com/o/r/tree/main',
          'vsch.local.repository.unique=true',
          'vsch.local.repository.branch=main',
        ],
        [
          'vsch.local.repository=https://github.com/o/r/tree/main',
          'vsch.local.repository.unique=true',
        ],
      ],
    );
  });

  it('the volume is created with each label, and its name follows `--`', () => {
    deepStrictEqual(volumeCreateArguments('r-1', ['a=1', 'b=2']), [
      'volume',
      'create',
      '--label',
      'a=1',
      '--label',
      'b=2',
      '--',
      'r-1',
    ]);
  });

  it('the volume is looked up by its name after `--`', () => {
    deepStrictEqual(volumeInspectArguments('-x'), [
      'volume',
      'inspect',
      '--format',
      '{{.Name}}',
      '--',
      '-x',
    ]);
  });

  it('F-0702 AC-14, BR-8: a named volume is labelled with its repository, the named mark, and its branch or pull request when the URL named one', () => {
    deepStrictEqual(
      [
        namedVolumeLabelsOf({...SOURCE, ref: 'main'}),
        namedVolumeLabelsOf(SOURCE),
        namedVolumeLabelsOf({
          repositoryPath: 'https://github.com/o/r/pull/7',
          urlToClone: 'https://github.com/o/r',
          repositoryName: 'r',
          pullRequest: 7,
        }),
      ],
      [
        [
          'vsch.local.repository=https://github.com/o/r/tree/main',
          'vsch.local.repository.unique=false',
          'vsch.local.repository.branch=main',
        ],
        [
          'vsch.local.repository=https://github.com/o/r/tree/main',
          'vsch.local.repository.unique=false',
        ],
        [
          'vsch.local.repository=https://github.com/o/r/pull/7',
          'vsch.local.repository.unique=false',
          'vsch.local.repository.pullRequestId=7',
        ],
      ],
    );
  });

  it('F-0702 AC-4, BR-4: the pick lists the named volumes by their repository label and the named mark, the names only', () => {
    deepStrictEqual(namedVolumeListArguments(), [
      'volume',
      'ls',
      '-q',
      '--filter',
      'label=vsch.local.repository',
      '--filter',
      'label=vsch.local.repository.unique=false',
    ]);
  });

  it('F-0702 AC-4: the creation dates come from an inspect of the listed names, pipe-joined per line', () => {
    deepStrictEqual(namedVolumeInspectArguments(['a', 'b']), [
      'volume',
      'inspect',
      '--format',
      '{{.Name}}|{{.CreatedAt}}',
      'a',
      'b',
    ]);
  });

  it('F-0702 AC-4: the list’s lines are read as name and creation date, empty or pipe-less lines dropped, and a missing date left absent', () => {
    deepStrictEqual(
      [namedVolumesOf('a|2026-10-02T12:00:00Z\nb|'), namedVolumesOf('\nx\n|y')],
      [[{name: 'a', created: '2026-10-02T12:00:00Z'}, {name: 'b'}], []],
    );
  });
});
