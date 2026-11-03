import {deepStrictEqual} from 'node:assert';
import {namedVolumeRowsOf} from '../../src/volumes/named-volume-pick.ts';

/** A translation that marks the text it was given. */
function marked(template: string): string {
  return `«${template}»`;
}

describe('the rows of the volume pick (card containers-152)', () => {
  it('F-0702 AC-3: with no eligible volume the pick holds only the create row, first and focused by default', () => {
    deepStrictEqual(namedVolumeRowsOf([], marked), [
      {
        label: '«$(plus) Create a new volume...»',
        description: '«Use this volume to store several cloned repositories.»',
        volume: undefined,
      },
    ]);
  });

  it('F-0702 AC-4, BR-4: the volumes follow the create row, sorted by name in character-code order, each with its creation date in the process’s time zone', () => {
    deepStrictEqual(
      namedVolumeRowsOf(
        [
          {name: 'a-x', created: new Date(Date.UTC(2026, 9, 2, 12, 0, 0))},
          {name: 'B-x', created: undefined},
          {name: '1-x', created: new Date(Date.UTC(2026, 9, 2, 12, 0, 0))},
        ],
        marked,
      ),
      [
        {
          label: '«$(plus) Create a new volume...»',
          description:
            '«Use this volume to store several cloned repositories.»',
          volume: undefined,
        },
        {
          label: '$(folder) 1-x',
          description: '«created at Fri Oct 02 2026»',
          volume: '1-x',
        },
        {label: '$(folder) B-x', description: '', volume: 'B-x'},
        {
          label: '$(folder) a-x',
          description: '«created at Fri Oct 02 2026»',
          volume: 'a-x',
        },
      ],
    );
  });
});
