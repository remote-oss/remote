import {deepStrictEqual} from 'node:assert';
import {
  acceptanceCriteriaOf,
  SLICE_ONE_FEATURES,
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
  it('#142, D-86: there are twenty-six, F-3901, F-3903 and the six of D-86 among them', () => {
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
        ].every(feature => SLICE_ONE_FEATURES.includes(feature)),
      ],
      [26, true],
    );
  });
});
