import {deepStrictEqual} from 'node:assert';
import {appendExtensionIds} from '../../src/index.ts';

describe('appendExtensionIds', () => {
  it('appends the ids that are not there, in order', () => {
    deepStrictEqual(appendExtensionIds(['a.b'], ['c.d', 'e.f']), [
      'a.b',
      'c.d',
      'e.f',
    ]);
  });

  it('keeps the spelling of the ids that were there, and adds an id that differs by case only once', () => {
    deepStrictEqual(appendExtensionIds(['a.b'], ['A.B', 'c.d', 'C.D']), [
      'a.b',
      'c.d',
    ]);
  });

  it('counts a value that is no list as empty, and skips items that are no text', () => {
    deepStrictEqual(
      [
        appendExtensionIds('x', ['A', 3]),
        appendExtensionIds(['P', 4], undefined),
        appendExtensionIds(undefined, []),
      ],
      [['A'], ['P'], []],
    );
  });
});
