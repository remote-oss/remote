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

describe('the features of slice 1', () => {
  it('#142: there are twenty, F-3901 and F-3903 among them', () => {
    deepStrictEqual(
      [
        SLICE_ONE_FEATURES.length,
        SLICE_ONE_FEATURES.includes('F-3901'),
        SLICE_ONE_FEATURES.includes('F-3903'),
      ],
      [20, true, true],
    );
  });
});
