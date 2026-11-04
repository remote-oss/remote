import {deepStrictEqual} from 'node:assert';
import {
  attachPicked,
  attachPickKeyOf,
  recordAttachPick,
} from '../../src/attach/pick-record.ts';
import {pickSetAdd, pickSetHas} from '../../src/state/pick-set.ts';

/** A memento over a map, recording what it was asked to write. */
function mementoOf(initial?: unknown): {
  get(key: string): unknown;
  update(key: string, value: unknown): Promise<void>;
  writes: unknown[];
} {
  const values = new Map<string, unknown>();
  const writes: unknown[] = [];
  return {
    get: key => (values.size === 0 ? initial : values.get(key)),
    update: (key, value) => {
      values.set(key, value);
      writes.push(value);
      return Promise.resolve();
    },
    writes,
  };
}

describe('the picked attach targets (card containers-163, ruling-2186-attach-gate)', () => {
  it('F-0601 AC-1 (c163-pick-key): the pick is the container’s name and the engine its payload pins, whatever the working folder', () => {
    deepStrictEqual(
      [
        attachPickKeyOf({containerName: '/web'}),
        attachPickKeyOf({containerName: '/web', cwd: '//wsl$/d'}),
        attachPickKeyOf({containerName: '/web', context: 'remote'}),
        attachPickKeyOf({containerName: '/web', host: 'ssh://h'}),
      ],
      [
        '["/web",{}]',
        '["/web",{}]',
        '["/web",{"settings":{"context":"remote"}}]',
        '["/web",{"settings":{"host":"ssh://h"}}]',
      ],
    );
  });

  it('F-0601 AC-1 (c163-pick-record): a recorded target is picked and another is not, and recording twice writes once', async () => {
    const memento = mementoOf();
    const key = attachPickKeyOf({containerName: '/web'});
    const before = attachPicked(memento, key);
    await recordAttachPick(memento, key);
    await recordAttachPick(memento, key);
    deepStrictEqual(
      [
        before,
        attachPicked(memento, key),
        attachPicked(memento, attachPickKeyOf({containerName: '/db'})),
        memento.writes,
      ],
      [false, true, false, [[key]]],
    );
  });

  it('F-0601 AC-1 (c163-pick-set): a stored value that is no list holds nothing, a list with other values keeps its names, and a name is added after the others', async () => {
    const stranger = mementoOf('web');
    const mixed = mementoOf(['a', 3, null]);
    await pickSetAdd(stranger, 'k', 'b');
    await pickSetAdd(mixed, 'k', 'c');
    deepStrictEqual(
      [
        pickSetHas(mementoOf('web'), 'k', 'web'),
        pickSetHas(mementoOf(['a', 3]), 'k', 'a'),
        stranger.writes,
        mixed.writes,
      ],
      [false, true, [['b']], [['a', 'c']]],
    );
  });
});
