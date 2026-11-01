import {deepStrictEqual} from 'node:assert';
import {
  KNOWN_NAMES_KEY,
  KNOWN_NAMES_LIMIT,
  knownName,
  recordKnownName,
} from '../../src/connect/known-names.ts';

/** A memento that keeps what it is given. */
function mementoOf(initial?: unknown) {
  const kept: Record<string, unknown> =
    initial === undefined ? {} : {[KNOWN_NAMES_KEY]: initial};
  return {
    kept,
    get: (key: string): unknown => kept[key],
    update: (key: string, value: unknown): PromiseLike<void> => {
      kept[key] = value;
      return Promise.resolve();
    },
  };
}

describe('the names this profile has connected (card containers-117)', () => {
  it('F-0409 BR-9: a recorded folder reads back with its name and context, and one never recorded reads none', async () => {
    const memento = mementoOf();
    await recordKnownName(
      memento,
      '/w/a',
      '/w/a/.devcontainer/devcontainer.json',
      {
        name: 'A',
        context: 'ctx',
      },
    );
    deepStrictEqual(
      [
        knownName(memento, '/w/a', '/w/a/.devcontainer/devcontainer.json'),
        knownName(memento, '/w/b', '/w/a/.devcontainer/devcontainer.json'),
      ],
      [{name: 'A', context: 'ctx'}, undefined],
    );
  });

  it('F-0409 BR-9: the folder and the configuration file are one key, so two configurations of a folder keep their own names, and a name with none is kept as none', async () => {
    const memento = mementoOf();
    await recordKnownName(memento, '/w/a', '/w/a/one.json', {
      name: 'One',
      context: undefined,
    });
    await recordKnownName(memento, '/w/a', '/w/a/two.json', {
      name: undefined,
      context: undefined,
    });
    deepStrictEqual(
      [
        knownName(memento, '/w/a', '/w/a/one.json'),
        knownName(memento, '/w/a', '/w/a/two.json'),
      ],
      [
        {name: 'One', context: undefined},
        {name: undefined, context: undefined},
      ],
    );
  });

  it('F-0409 BR-9: past the limit the oldest entry goes, and a folder connected again is the newest', async () => {
    const memento = mementoOf();
    for (let index = 0; index < KNOWN_NAMES_LIMIT; index += 1) {
      await recordKnownName(memento, `/w/${String(index)}`, 'c', {
        name: String(index),
        context: undefined,
      });
    }
    await recordKnownName(memento, '/w/0', 'c', {
      name: 'again',
      context: undefined,
    });
    await recordKnownName(memento, '/w/new', 'c', {
      name: 'new',
      context: undefined,
    });
    deepStrictEqual(
      [
        knownName(memento, '/w/0', 'c')?.name,
        knownName(memento, '/w/1', 'c'),
        knownName(memento, '/w/2', 'c')?.name,
        knownName(memento, '/w/new', 'c')?.name,
        Object.keys(memento.kept[KNOWN_NAMES_KEY] as object).length,
      ],
      ['again', undefined, '2', 'new', KNOWN_NAMES_LIMIT],
    );
  });

  it('F-0409 BR-9: a stored value that is no map, or an entry that is no identity, reads as nothing, and a name that is no string is none', () => {
    deepStrictEqual(
      [
        knownName(mementoOf('text'), '/w/a', 'c'),
        knownName(mementoOf(['x']), '/w/a', 'c'),
        knownName(mementoOf({'/w/a#c': null}), '/w/a', 'c'),
        knownName(mementoOf({'/w/a#c': {name: 3, context: 4}}), '/w/a', 'c'),
      ],
      [undefined, undefined, undefined, {name: undefined, context: undefined}],
    );
  });
});
