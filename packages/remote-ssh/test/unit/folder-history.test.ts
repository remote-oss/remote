import {deepStrictEqual} from 'node:assert';
import {HISTORY_FOLDER, legacyOf, windowOn} from './history-files.fixture.ts';
import {MemoryFiles} from './event-files.fixture.ts';

/** The history entry of a folder. */
function folder(entryPath: string): {path: string; kind: 'folder'} {
  return {path: entryPath, kind: 'folder'};
}

/** Records each of `entries` under `hostKey` in `store`, one tick of the clock apart. */
async function inTurn(
  files: MemoryFiles,
  store: ReturnType<typeof windowOn>,
  hostKey: string,
  ...entries: ReadonlyArray<{path: string; kind: 'folder' | 'workspace'}>
): Promise<void> {
  for (const entry of entries) {
    await store.recordOpened(hostKey, entry);
    files.clock += 1;
  }
}

/** Records `/a` and `/c` on host-a and `/b` on host-b in `store`, `/a`, `/b` and `/c` in turn. */
async function openedOnTwoHosts(
  files: MemoryFiles,
  store: ReturnType<typeof windowOn>,
): Promise<void> {
  await inTurn(files, store, 'host-a', folder('/a'));
  await inTurn(files, store, 'host-b', folder('/b'));
  await inTurn(files, store, 'host-a', folder('/c'));
}

describe('the folder history store (card ssh-provider-02, card #3095)', () => {
  it('F-2503 BR-1, BR-2, AC-4: a path already in the list moves to the top, with no second copy', async () => {
    const files = new MemoryFiles();
    const store = windowOn(files, 'aaaa');
    await inTurn(
      files,
      store,
      'host-a',
      folder('/f1'),
      folder('/f2'),
      folder('/f1'),
    );
    deepStrictEqual(store.stored(), [
      {hostKey: 'host-a', entries: [folder('/f1'), folder('/f2')]},
    ]);
  });

  it('F-2503 BR-1, AC-5: a folder and a workspace file share one list, the latest first, with their kinds', async () => {
    const files = new MemoryFiles();
    const store = windowOn(files, 'aaaa');
    await inTurn(files, store, 'host-a', folder('/f1'), {
      path: '/w.code-workspace',
      kind: 'workspace',
    });
    deepStrictEqual(store.stored(), [
      {
        hostKey: 'host-a',
        entries: [
          {path: '/w.code-workspace', kind: 'workspace'},
          folder('/f1'),
        ],
      },
    ]);
  });

  it('F-2503 BR-4, AC-8, AC-29: each host keeps only its own entries, the hosts in the order of their oldest entry still listed', async () => {
    const files = new MemoryFiles();
    const store = windowOn(files, 'aaaa');
    await openedOnTwoHosts(files, store);
    deepStrictEqual(store.stored(), [
      {hostKey: 'host-a', entries: [folder('/c'), folder('/a')]},
      {hostKey: 'host-b', entries: [folder('/b')]},
    ]);
  });

  it('F-2503 BR-4: a host whose oldest entry was removed takes its place by the oldest entry that is left', async () => {
    const files = new MemoryFiles();
    const store = windowOn(files, 'aaaa');
    await openedOnTwoHosts(files, store);
    await store.removeOpened('host-a', '/a');
    deepStrictEqual(store.stored(), [
      {hostKey: 'host-b', entries: [folder('/b')]},
      {hostKey: 'host-a', entries: [folder('/c')]},
    ]);
  });

  it('F-2503 BR-6, AC-21: 122 records on one host are all kept, the latest first', async () => {
    const files = new MemoryFiles();
    const store = windowOn(files, 'aaaa');
    for (let index = 0; index < 122; index += 1) {
      files.clock += 1;
      await store.recordOpened('host-a', folder(`/f${String(index)}`));
    }
    const [host] = store.stored();
    deepStrictEqual(
      [host?.entries.length, host?.entries[0]?.path, host?.entries[121]?.path],
      [122, '/f121', '/f0'],
    );
  });

  it('F-2503 BR-7, AC-31: removing the only entry of a host drops the host, and says so', async () => {
    const files = new MemoryFiles();
    const store = windowOn(files, 'aaaa');
    await store.recordOpened('host-a', folder('/a'));
    await store.recordOpened('host-b', folder('/b'));
    files.clock += 1;
    const changed = await store.removeOpened('host-a', '/a');
    deepStrictEqual(
      [changed, store.stored()],
      [true, [{hostKey: 'host-b', entries: [folder('/b')]}]],
    );
  });

  it('F-2503 BR-7, 7.E1: removing a path that is not there says false and writes nothing', async () => {
    const files = new MemoryFiles();
    const store = windowOn(files, 'aaaa');
    await store.recordOpened('host-a', folder('/a'));
    const written = files.operations.length;
    const changed = await store.removeOpened('host-a', '/missing');
    deepStrictEqual([changed, files.operations.length], [false, written]);
  });

  it('a write that fails is a rejection of the record or the removal, not a throw', async () => {
    const files = new MemoryFiles();
    const store = windowOn(files, 'aaaa');
    await store.recordOpened('host-a', folder('/a'));
    files.failWrites = true;
    const reasons = await Promise.all(
      [
        store.recordOpened('host-a', folder('/b')),
        store.removeOpened('host-a', '/a'),
      ].map(pending =>
        pending.then(
          () => 'settled',
          (error: unknown) => (error as Error).message,
        ),
      ),
    );
    deepStrictEqual(reasons, ['the disk is full', 'the disk is full']);
  });
});

describe('the folder history store, written by two windows at once (card #3095)', () => {
  it("#2757, #3095: a folder recorded by a window that never saw another window's record keeps both", async () => {
    const files = new MemoryFiles();
    const first = windowOn(files, 'aaaa');
    const second = windowOn(files, 'bbbb');
    await first.recordOpened('host-a', folder('/c1'));
    files.clock += 1;
    await second.recordOpened('host-a', folder('/c2'));
    deepStrictEqual(windowOn(files, 'cccc').stored(), [
      {hostKey: 'host-a', entries: [folder('/c2'), folder('/c1')]},
    ]);
  });

  it('a removal in one window wins over the older record of another, and a newer record wins over the removal', async () => {
    const files = new MemoryFiles();
    const first = windowOn(files, 'aaaa');
    const second = windowOn(files, 'bbbb');
    await first.recordOpened('host-a', folder('/x'));
    await first.recordOpened('host-a', folder('/y'));
    files.clock += 1;
    await second.removeOpened('host-a', '/x');
    const afterRemoval = windowOn(files, 'cccc').stored();
    files.clock += 1;
    await first.recordOpened('host-a', folder('/x'));
    deepStrictEqual(
      [afterRemoval, windowOn(files, 'cccc').stored()],
      [
        [{hostKey: 'host-a', entries: [folder('/y')]}],
        [{hostKey: 'host-a', entries: [folder('/x'), folder('/y')]}],
      ],
    );
  });

  it('two entries opened at the same time list the later session’s first', async () => {
    const files = new MemoryFiles();
    await windowOn(files, 'aaaa').recordOpened('host-a', folder('/from-a'));
    await windowOn(files, 'bbbb').recordOpened('host-a', folder('/from-b'));
    deepStrictEqual(windowOn(files, 'cccc').stored(), [
      {hostKey: 'host-a', entries: [folder('/from-b'), folder('/from-a')]},
    ]);
  });

  it('two events of one entry at the same time are ordered by their session', async () => {
    const files = new MemoryFiles();
    await windowOn(files, 'bbbb').recordOpened('host-a', folder('/x'));
    const earlier = windowOn(files, 'aaaa');
    await earlier.recordOpened('host-a', folder('/y'));
    const removed = windowOn(files, 'cccc');
    await removed.removeOpened('host-a', '/x');
    await earlier.recordOpened('host-a', folder('/x'));
    deepStrictEqual(removed.stored(), [
      {hostKey: 'host-a', entries: [folder('/y')]},
    ]);
  });
});

describe('the history an earlier version kept in the global state (card #3095)', () => {
  const EARLIER = {
    hosts: [
      {hostKey: 'host-a', entries: [folder('/a2'), folder('/a1')]},
      {hostKey: 'host-b', entries: [folder('/b1')]},
    ],
  };

  it('is read as the oldest layer: its order kept, its hosts first, a newer record above it', async () => {
    const files = new MemoryFiles();
    const store = windowOn(files, 'aaaa', legacyOf(EARLIER));
    await store.recordOpened('host-c', folder('/c1'));
    await store.recordOpened('host-a', folder('/a3'));
    deepStrictEqual(store.stored(), [
      {
        hostKey: 'host-a',
        entries: [folder('/a3'), folder('/a2'), folder('/a1')],
      },
      {hostKey: 'host-b', entries: [folder('/b1')]},
      {hostKey: 'host-c', entries: [folder('/c1')]},
    ]);
  });

  it('a removal of one of its entries holds, though the global state keeps the entry', async () => {
    const files = new MemoryFiles();
    const legacy = legacyOf(EARLIER);
    await windowOn(files, 'aaaa', legacy).removeOpened('host-b', '/b1');
    deepStrictEqual(windowOn(files, 'bbbb', legacy).stored(), [
      {hostKey: 'host-a', entries: [folder('/a2'), folder('/a1')]},
    ]);
  });

  it('F-2503 BR-10: a malformed value is no history, and a malformed host or entry is dropped', () => {
    const files = new MemoryFiles();
    function storedFrom(value: unknown): unknown {
      return windowOn(files, 'aaaa', legacyOf(value)).stored();
    }
    deepStrictEqual(
      [
        storedFrom(42),
        storedFrom({hosts: 'x'}),
        storedFrom(undefined),
        storedFrom({
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
      ],
      [[], [], [], [{hostKey: 'host-a', entries: [folder('/good')]}]],
    );
  });
});

describe('the files of other windows that hold no history', () => {
  it('a file whose events are no object, or have no host, no kind, no time or no entry that fits, adds nothing, and the good event stays', () => {
    const files = new MemoryFiles();
    const good = {
      host: 'host-a',
      entry: folder('/good'),
      kind: 'opened',
      time: 5,
    };
    files.files.set(`${HISTORY_FOLDER}/aaaa.json`, {
      text: JSON.stringify({
        events: [
          good,
          'text',
          {...good, kind: 'moved'},
          {...good, host: 7},
          {...good, time: 'later'},
          {...good, entry: {path: '/x', kind: 'file'}},
        ],
      }),
      modified: files.clock,
    });
    deepStrictEqual(windowOn(files, 'bbbb').stored(), [
      {hostKey: 'host-a', entries: [folder('/good')]},
    ]);
  });
});
