import {deepStrictEqual} from 'node:assert';
import {
  acceptanceCriteriaOf,
  CONTAINERS_RELEASE_ONE_FEATURES,
  CONTAINERS_RELEASE_ONE_SCOPE,
  COVERAGE_SCOPES,
  EXPLORER_SLICE_ONE_FEATURES,
  EXPLORER_SLICE_ONE_SCOPE,
  EXTENSIONPACK_RELEASE_ONE_FEATURES,
  EXTENSIONPACK_RELEASE_ONE_SCOPE,
  SLICE_ONE_FEATURES,
  SLICE_ONE_SCOPE,
} from './spec-acceptance-criteria.ts';

const BODY = [
  '## Acceptance criteria',
  '- **F-2601.AC-1** Given a host, when it connects, then it works.',
  '- **F-2601.AC-2** Given another, then it fails.',
  '- **F-2602.AC-1** Given a host of another feature.',
  'See F-2601.AC-1 for the first.',
  '- **F-2601.AC-1** A repeated line.',
  '- see **F-2601.AC-3** quoted in a list',
].join('\n');

describe('acceptanceCriteriaOf', () => {
  it('#142: gives the ids of the lines that start with the feature, in order, each once', () => {
    deepStrictEqual(acceptanceCriteriaOf(BODY, 'F-2601'), [
      'F-2601.AC-1',
      'F-2601.AC-2',
    ]);
  });

  it('#142: gives nothing for a feature the body has no criteria of', () => {
    deepStrictEqual(acceptanceCriteriaOf(BODY, 'F-2001'), []);
  });

  it('#142: does not take a feature whose id only starts like the asked one', () => {
    deepStrictEqual(acceptanceCriteriaOf(BODY, 'F-260'), []);
  });
});

describe('acceptanceCriteriaOf, a removed criterion', () => {
  /** The criteria of a body whose second line is `line`. */
  function removed(line: string): string[] {
    return acceptanceCriteriaOf(
      [
        '- **F-2304.AC-1** Given a host.',
        line,
        '- **F-2304.AC-3** Given another.',
      ].join('\n'),
      'F-2304',
    );
  }

  it('#142: a line that starts with Removed after the id is skipped', () => {
    deepStrictEqual(removed('- **F-2304.AC-2** Removed: not known.'), [
      'F-2304.AC-1',
      'F-2304.AC-3',
    ]);
  });

  it('#142: a line with two spaces before Removed is skipped', () => {
    deepStrictEqual(removed('- **F-2304.AC-2**  Removed: not known.'), [
      'F-2304.AC-1',
      'F-2304.AC-3',
    ]);
  });

  it('#142: a line that says removed later is kept', () => {
    deepStrictEqual(removed('- **F-2304.AC-2** Given a host, then removed.'), [
      'F-2304.AC-1',
      'F-2304.AC-2',
      'F-2304.AC-3',
    ]);
  });
});

describe('the features of slice 1', () => {
  it('#142, D-86, coverage-44, coverage-47: there are thirty-eight, F-3901, F-3903, the six of D-86, the nine of coverage-44 and the three of coverage-47 among them', () => {
    deepStrictEqual(
      [
        SLICE_ONE_FEATURES.length,
        [
          'F-3901',
          'F-3903',
          'F-2204',
          'F-2302',
          'F-2303',
          'F-2411',
          'F-2412',
          'F-2605',
          'F-2104',
          'F-2106',
          'F-2308',
          'F-2312',
          'F-2405',
          'F-2410',
          'F-2507',
          'F-2508',
          'F-2604',
          'F-2108',
          'F-2509',
          'F-2704',
        ].every(feature => SLICE_ONE_FEATURES.includes(feature)),
      ],
      [38, true],
    );
  });
});

describe('acceptanceCriteriaOf, the forms of Remote - Containers', () => {
  const containersBody = [
    '- **F-0101.AC-3** Given a window.',
    '- **F-0101.AC-3b** Given a second window.',
    '- **F-0101.AC-35 (reimplementation only, F-1402)** Given a setting.',
    '- **F-0101.AC-36 (reimplementation only)** Removed: merged into AC-35.',
    '- **F-0101.AC-3B** An upper-case letter is not a form.',
    '- **F-0101.AC-37** Merged into AC-35: its check is there.',
  ].join('\n');

  it('containers release 1: takes a letter after the number and a note after the id, and skips a removed or merged one', () => {
    deepStrictEqual(acceptanceCriteriaOf(containersBody, 'F-0101'), [
      'F-0101.AC-3',
      'F-0101.AC-3b',
      'F-0101.AC-35',
    ]);
  });

  it('containers release 1: AC-35 is not read as AC-3', () => {
    deepStrictEqual(
      acceptanceCriteriaOf(
        '- **F-0101.AC-35 (note)** Given a setting.',
        'F-0101',
      ),
      ['F-0101.AC-35'],
    );
  });
});

describe('the coverage files', () => {
  it('coverage-25a: the first slice, containers release 1, the explorer slice and the pack, each with its features and repository', () => {
    deepStrictEqual(
      COVERAGE_SCOPES.map(scope => [
        scope.file,
        scope.features.length,
        scope.repository,
      ]),
      [
        [SLICE_ONE_SCOPE.file, SLICE_ONE_FEATURES.length, 'remote-ssh'],
        [
          CONTAINERS_RELEASE_ONE_SCOPE.file,
          CONTAINERS_RELEASE_ONE_FEATURES.length,
          'remote-containers',
        ],
        [
          EXPLORER_SLICE_ONE_SCOPE.file,
          EXPLORER_SLICE_ONE_FEATURES.length,
          'remote-explorer',
        ],
        [
          EXTENSIONPACK_RELEASE_ONE_SCOPE.file,
          EXTENSIONPACK_RELEASE_ONE_FEATURES.length,
          'remote-extensionpack',
        ],
      ],
    );
  });

  it('containers release 1: thirty-four features, F-0416, F-0419, F-0106 and the four views features of #960 among them', () => {
    deepStrictEqual(
      [
        CONTAINERS_RELEASE_ONE_FEATURES.length,
        [
          'F-0416',
          'F-0419',
          'F-0106',
          'F-0901',
          'F-0902',
          'F-0903',
          'F-0906',
        ].every(feature => CONTAINERS_RELEASE_ONE_FEATURES.includes(feature)),
      ],
      [34, true],
    );
  });
});
