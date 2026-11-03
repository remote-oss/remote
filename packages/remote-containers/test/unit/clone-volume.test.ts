import {deepStrictEqual} from 'node:assert';
import {
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
});
