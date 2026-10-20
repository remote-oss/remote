import {deepStrictEqual} from 'node:assert';
import {
  FOLDER_HISTORY_KEY,
  type HistoryMemento,
  recordOpened,
  removeOpened,
  storedHistory,
} from '../../src/companion/folder-history.ts';

/** A memento that keeps a JSON copy of what it was given, and counts its writes. */
function memoryMemento(initial?: unknown): HistoryMemento & {writes: number} {
  let stored: string | undefined =
    initial === undefined ? undefined : JSON.stringify(initial);
  const memento = {
    writes: 0,
    get: (key: string): unknown => {
      return key === FOLDER_HISTORY_KEY && stored !== undefined
        ? (JSON.parse(stored) as unknown)
        : undefined;
    },
    update: (key: string, value: unknown) => {
      if (key === FOLDER_HISTORY_KEY) {
        memento.writes += 1;
        stored = JSON.stringify(value);
      }
      return Promise.resolve();
    },
  };
  return memento;
}

/** The history entry of a folder. */
function folder(path: string): {path: string; kind: 'folder'} {
  return {path, kind: 'folder'};
}

describe('the folder history store (card ssh-provider-02)', () => {
  it('F-2503 BR-1, BR-2, AC-4: a path already in the list moves to the top, with no second copy', async () => {
    const memento = memoryMemento({
      hosts: [{hostKey: 'host-a', entries: [folder('/f2'), folder('/f1')]}],
    });
    await recordOpened(memento, 'host-a', folder('/f1'));
    deepStrictEqual(storedHistory(memento), [
      {hostKey: 'host-a', entries: [folder('/f1'), folder('/f2')]},
    ]);
  });

  it('F-2503 BR-1, AC-5: a folder and a workspace file share one list, the latest first, with their kinds', async () => {
    const memento = memoryMemento();
    await recordOpened(memento, 'host-a', folder('/f1'));
    await recordOpened(memento, 'host-a', {
      path: '/w.code-workspace',
      kind: 'workspace',
    });
    deepStrictEqual(storedHistory(memento), [
      {
        hostKey: 'host-a',
        entries: [
          {path: '/w.code-workspace', kind: 'workspace'},
          folder('/f1'),
        ],
      },
    ]);
  });

  it('F-2503 BR-4, AC-8, AC-29: each host keeps only its own entries', async () => {
    const memento = memoryMemento();
    await recordOpened(memento, 'host-a', folder('/a'));
    await recordOpened(memento, 'host-b', folder('/b'));
    await recordOpened(memento, 'host-a', folder('/c'));
    deepStrictEqual(storedHistory(memento), [
      {hostKey: 'host-a', entries: [folder('/c'), folder('/a')]},
      {hostKey: 'host-b', entries: [folder('/b')]},
    ]);
  });

  it('F-2503 BR-6, AC-21: 122 records on one host are all kept, the latest first', async () => {
    const memento = memoryMemento();
    for (let index = 0; index < 122; index += 1) {
      await recordOpened(memento, 'host-a', folder(`/f${String(index)}`));
    }
    const [host] = storedHistory(memento);
    deepStrictEqual(
      [host?.entries.length, host?.entries[0]?.path, host?.entries[121]?.path],
      [122, '/f121', '/f0'],
    );
  });

  it('F-2503 BR-7, AC-31: removing the only entry of a host drops the host', async () => {
    const memento = memoryMemento({
      hosts: [
        {hostKey: 'host-a', entries: [folder('/a')]},
        {hostKey: 'host-b', entries: [folder('/b')]},
      ],
    });
    const changed = await removeOpened(memento, 'host-a', '/a');
    deepStrictEqual(
      [changed, memento.get(FOLDER_HISTORY_KEY)],
      [true, {hosts: [{hostKey: 'host-b', entries: [folder('/b')]}]}],
    );
  });

  it('F-2503 BR-7: removing a path that is not there says false and writes nothing', async () => {
    const memento = memoryMemento({
      hosts: [{hostKey: 'host-a', entries: [folder('/a')]}],
    });
    const changed = await removeOpened(memento, 'host-a', '/missing');
    deepStrictEqual([changed, memento.writes], [false, 0]);
  });

  it('F-2503 BR-15, AC-32: two recorders on one memento keep both entries', async () => {
    const memento = memoryMemento();
    await recordOpened(memento, 'host-a', folder('/first'));
    await recordOpened(memento, 'host-a', folder('/second'));
    deepStrictEqual(storedHistory(memento), [
      {hostKey: 'host-a', entries: [folder('/second'), folder('/first')]},
    ]);
  });

  it('F-2503 BR-10: a malformed value is no history, and a malformed host or entry is dropped', () => {
    deepStrictEqual(
      [
        storedHistory(memoryMemento(42)),
        storedHistory(memoryMemento({hosts: 'x'})),
        storedHistory(memoryMemento()),
        storedHistory(
          memoryMemento({
            hosts: [
              {
                hostKey: 'host-a',
                entries: [
                  folder('/good'),
                  {path: 7, kind: 'folder'},
                  {path: '/bad-kind', kind: 'file'},
                  'text',
                ],
              },
              {hostKey: 'host-b', entries: [{path: 7}]},
              {hostKey: 3, entries: [folder('/x')]},
              {hostKey: 'host-c', entries: 'x'},
              null,
            ],
          }),
        ),
      ],
      [[], [], [], [{hostKey: 'host-a', entries: [folder('/good')]}]],
    );
  });
});
